// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { Terminal } from '@xterm/xterm';
import { predictShrinkScroll, readRowShiftState } from './terminalRowShift';

function write(term: Terminal, data: string): Promise<void> {
  return new Promise((resolve) => term.write(data, resolve));
}

function lines(n: number): string {
  return Array.from({ length: n }, (_, i) => `line${i}`).join('\r\n');
}

/** 真实 xterm 缩小后视口实际上滚了几行。 */
function actualScroll(term: Terminal, newRows: number): number {
  const before = term.buffer.active.viewportY;
  term.resize(term.cols, newRows);
  return term.buffer.active.viewportY - before;
}

async function scenario(setup: (term: Terminal) => Promise<void>) {
  const term = new Terminal({ rows: 20, cols: 40, scrollback: 100, allowProposedApi: true });
  await setup(term);
  return term;
}

describe('predictShrinkScroll 与真实 xterm 一致', () => {
  const cases: Array<[string, (t: Terminal) => Promise<void>]> = [
    ['满屏、光标在最后一行', (t) => write(t, lines(50))],
    ['刚好写满一屏', (t) => write(t, lines(20))],
    ['只写了几行（光标在上半屏）', (t) => write(t, lines(4))],
    ['空终端', async () => {}],
    ['写到一半屏', (t) => write(t, lines(11))],
    ['满屏但光标被移到中间（下方有内容）', async (t) => {
      await write(t, lines(50));
      await write(t, '\x1b[6A');
    }],
    ['满屏但光标回到首行', async (t) => {
      await write(t, lines(50));
      await write(t, '\x1b[H');
    }],
  ];

  for (const [name, setup] of cases) {
    for (const newRows of [19, 14, 10, 5, 1]) {
      it(`${name} → ${newRows} 行`, async () => {
        const term = await scenario(setup);
        const predicted = predictShrinkScroll(readRowShiftState(term), newRows);
        expect(predicted).not.toBeNull();
        expect(actualScroll(term, newRows)).toBe(predicted);
      });
    }
  }
});

describe('predictShrinkScroll 放弃预测的场景', () => {
  it('备用屏幕返回 null', async () => {
    const term = await scenario(async (t) => {
      await write(t, lines(30));
      await write(t, '\x1b[?1049h');
    });
    expect(predictShrinkScroll(readRowShiftState(term), 10)).toBeNull();
  });

  it('用户滚在历史中间返回 null', async () => {
    // 未挂载到 DOM 的 xterm 不响应 scrollLines，这里手工造"视口落后于底部"的状态。
    const term = await scenario((t) => write(t, lines(60)));
    const state = { ...readRowShiftState(term), viewportY: term.buffer.active.baseY - 5 };
    expect(predictShrinkScroll(state, 10)).toBeNull();
  });

  it('不是缩小返回 null', async () => {
    const term = await scenario((t) => write(t, lines(30)));
    expect(predictShrinkScroll(readRowShiftState(term), 20)).toBeNull();
    expect(predictShrinkScroll(readRowShiftState(term), 25)).toBeNull();
  });
});
