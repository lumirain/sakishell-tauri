import { describe, expect, it } from 'vitest';
import v8 from 'node:v8';
import vm from 'node:vm';
import {
  advanceSegments,
  emptySegments,
  SEGMENT_CHARS,
  type LiveSegments,
} from './liveOutputSegments';

/** 分段后拼回去必须与输入逐字符相同——数据一个字符都不能少。 */
function joined(s: LiveSegments): string {
  return s.sealed.join('') + s.tail;
}

const SMALL = 16; // 测试用的小段长，方便造边界

describe('advanceSegments', () => {
  it('空文本保持空状态', () => {
    const s = advanceSegments(emptySegments(), '');
    expect(s.sealed).toEqual([]);
    expect(s.tail).toBe('');
    expect(s.consumed).toBe(0);
  });

  it('短于段长的输出全部留在尾段，不封口', () => {
    const s = advanceSegments(emptySegments(), 'line 1\nline 2\n', SMALL * 4);
    expect(s.sealed).toEqual([]);
    expect(joined(s)).toBe('line 1\nline 2\n');
  });

  it('封口只发生在换行之后：每个封口段都以换行结尾，不把一行劈开', () => {
    const text = Array.from({ length: 40 }, (_, i) => `row-${i}`).join('\n') + '\n';
    const s = advanceSegments(emptySegments(), text, SMALL);
    expect(s.sealed.length).toBeGreaterThan(3);
    for (const seg of s.sealed) {
      expect(seg.endsWith('\n')).toBe(true);
      expect(seg.length).toBeGreaterThanOrEqual(SMALL);
    }
    expect(joined(s)).toBe(text);
  });

  it('一行长过段长（没有换行可切）时不强行切，该段继续长，内容不丢', () => {
    const longLine = 'x'.repeat(SMALL * 5);
    const s = advanceSegments(emptySegments(), `${longLine}\nnext\n`, SMALL);
    expect(joined(s)).toBe(`${longLine}\nnext\n`);
    // 超长行结束后才有换行可切：第一段就是整行（含换行）
    expect(s.sealed[0]).toBe(`${longLine}\n`);
  });

  it('逐块追加与一次性给全量得到相同的拼回结果', () => {
    const text = Array.from({ length: 200 }, (_, i) => `日志 ${i} — ${'ab'.repeat(i % 7)}`).join('\n');
    let s = emptySegments();
    for (let end = 0; end < text.length; end += 37) {
      s = advanceSegments(s, text.slice(0, end), SMALL);
      expect(joined(s)).toBe(text.slice(0, end));
    }
    s = advanceSegments(s, text, SMALL);
    expect(joined(s)).toBe(text);
    expect(joined(advanceSegments(emptySegments(), text, SMALL))).toBe(text);
  });

  it('已封口的段在后续追加里保持同一个字符串（调用方据此 memo）', () => {
    const first = Array.from({ length: 30 }, (_, i) => `row-${i}`).join('\n') + '\n';
    const a = advanceSegments(emptySegments(), first, SMALL);
    const b = advanceSegments(a, `${first}more\n`, SMALL);
    expect(b.sealed.length).toBeGreaterThanOrEqual(a.sealed.length);
    a.sealed.forEach((seg, i) => expect(b.sealed[i]).toBe(seg));
  });

  it('文本没变化时原样返回同一个状态对象', () => {
    const a = advanceSegments(emptySegments(), 'abc\ndef\n', SMALL);
    expect(advanceSegments(a, 'abc\ndef\n', SMALL)).toBe(a);
  });

  it('没有新封口时不重建封口数组', () => {
    const a = advanceSegments(emptySegments(), 'a\n', 1024);
    const b = advanceSegments(a, 'a\nb\n', 1024);
    expect(b.sealed).toBe(a.sealed);
  });

  it('输入变短（不是追加）时整体重建，显示新内容', () => {
    const long = Array.from({ length: 50 }, (_, i) => `row-${i}`).join('\n') + '\n';
    const a = advanceSegments(emptySegments(), long, SMALL);
    const b = advanceSegments(a, 'fresh\n', SMALL);
    expect(joined(b)).toBe('fresh\n');
    expect(b.sealed).toEqual([]);
  });

  it('同样长度但内容不同（不是续写）时整体重建', () => {
    const a = advanceSegments(emptySegments(), 'aaaaaaaa\nbbbbbbbb\n', SMALL);
    const b = advanceSegments(a, 'cccccccc\ndddddddd\n', SMALL);
    expect(joined(b)).toBe('cccccccc\ndddddddd\n');
  });

  it('更长但开头已经不是之前的内容时整体重建', () => {
    const a = advanceSegments(emptySegments(), 'old output\nline\n', SMALL);
    const replaced = 'brand new output that is longer\nthan before\n';
    const b = advanceSegments(a, replaced, SMALL);
    expect(joined(b)).toBe(replaced);
  });

  it('中文与代理对（emoji）不会被劈开', () => {
    const text = Array.from({ length: 60 }, (_, i) => `第${i}行 😀 输出`).join('\n') + '\n';
    const s = advanceSegments(emptySegments(), text, SMALL);
    expect(joined(s)).toBe(text);
    for (const seg of s.sealed) {
      // 封口点在 \n 之后，所以每段的首尾都不会落在代理对中间
      expect(seg.endsWith('\n')).toBe(true);
    }
  });

  /**
   * 回归：V8 的 `slice()` 结果会把整个原字符串钉在内存里。每帧的 `text` 都是
   * 「截至当前的全部输出」的一份新整串，封口段若直接引用它，第 k 个封口段就钉住第 k
   * 帧的整串，总占用成了输出量的平方级。去掉 `detach` 时，同样 8MB 输出会常驻
   * 约 127MB（16 倍）；现在约 2 倍。阈值取 7 倍，两边都留足余量。
   */
  it('常驻内存与输出量同量级，不会因切片钉住每一帧的整串而膨胀', () => {
    v8.setFlagsFromString('--expose-gc');
    const gc = vm.runInNewContext('gc') as (() => void) | undefined;
    if (typeof gc !== 'function') return; // 这个运行环境拿不到 gc：跳过，不假绿也不误红

    const line = 'drwxr-xr-x  2 root root  4096 Oct 17 12:00 /var/lib/some/path/file_0001234.log\n';
    const chunk = line.repeat(Math.ceil(4096 / line.length)).slice(0, 4096);
    const frames = 2048; // 8MB，每帧 4KB：帧多才能放大「每帧钉一份整串」的代价

    gc();
    gc();
    const before = process.memoryUsage().heapUsed;
    let text = '';
    let state = emptySegments();
    for (let i = 0; i < frames; i++) {
      text = text + chunk;
      state = advanceSegments(state, text);
    }
    gc();
    gc();
    const retained = process.memoryUsage().heapUsed - before;
    const outputBytes = text.length;
    expect(joined(state)).toBe(text); // 同时保证状态在测量之后仍被引用
    expect(retained).toBeLessThan(outputBytes * 7);
  });

  it('默认段长 64KB：几 MB 输出被切成数十段，拼回逐字符相同', () => {
    const line = 'drwxr-xr-x  2 root root  4096 Oct 17 12:00 /var/lib/some/path/file_0001234.log\n';
    const text = line.repeat(Math.ceil((4 * 1024 * 1024) / line.length));
    const s = advanceSegments(emptySegments(), text);
    expect(s.sealed.length).toBeGreaterThan(40);
    expect(s.sealed.every((seg) => seg.length >= SEGMENT_CHARS)).toBe(true);
    expect(joined(s)).toBe(text);
  });
});
