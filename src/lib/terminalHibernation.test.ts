import { describe, expect, it } from 'vitest';
import {
  HIBERNATE_AFTER_MS,
  PendingOutput,
  packSnapshot,
  shouldHibernate,
  unpackSnapshot,
} from './terminalHibernation';

describe('shouldHibernate', () => {
  const base = {
    visible: false,
    awake: true,
    hiddenSince: 1_000,
    lastActivityAt: 1_000,
    now: 1_000 + HIBERNATE_AFTER_MS,
  };

  it('隐藏且静默满阈值就休眠', () => {
    expect(shouldHibernate(base)).toBe(true);
  });

  it('差一毫秒都不休眠，短时间来回切标签不会触发', () => {
    expect(shouldHibernate({ ...base, now: base.now - 1 })).toBe(false);
  });

  it('正在显示的不休眠', () => {
    expect(shouldHibernate({ ...base, visible: true })).toBe(false);
  });

  it('已经在休眠或休眠流程中的不重复休眠', () => {
    expect(shouldHibernate({ ...base, awake: false })).toBe(false);
  });

  it('后台还在出输出的标签不休眠，以最近一次输出起算', () => {
    expect(shouldHibernate({ ...base, lastActivityAt: base.now - 1 })).toBe(false);
    expect(
      shouldHibernate({ ...base, lastActivityAt: base.now - HIBERNATE_AFTER_MS }),
    ).toBe(true);
  });

  it('刚被切走的标签从切走那刻起算，不看更早的输出', () => {
    expect(shouldHibernate({ ...base, hiddenSince: base.now - 1 })).toBe(false);
  });
});

describe('PendingOutput', () => {
  it('按到达顺序取出并清空，字符数同步归零', () => {
    const pending = new PendingOutput();
    pending.push('ab');
    pending.push('中文');
    expect(pending.chars).toBe(4);
    expect(pending.take()).toEqual(['ab', '中文']);
    expect(pending.chars).toBe(0);
    expect(pending.isEmpty).toBe(true);
    expect(pending.take()).toEqual([]);
  });

  it('空串不入队', () => {
    const pending = new PendingOutput();
    pending.push('');
    expect(pending.isEmpty).toBe(true);
  });
});

describe('snapshot pack / unpack', () => {
  // 终端快照：带 SGR 颜色、CJK、emoji（代理对）和换行。
  const sample =
    '\x1b[32m[ok]\x1b[0m 构建完成 🚀 /var/log/app.log\r\n'.repeat(500) + '\x1b[38;5;196mERR\x1b[0m';

  it('往返无损（含 CJK 与代理对）', async () => {
    const packed = await packSnapshot(sample);
    expect(await unpackSnapshot(packed)).toBe(sample);
  });

  it('重复度高的终端文本确实被压小', async () => {
    const packed = await packSnapshot(sample);
    expect(packed.kind).toBe('gzip');
    expect(packed.bytes.length).toBeLessThan(sample.length / 10);
  });

  it('空快照往返得到空串', async () => {
    expect(await unpackSnapshot(await packSnapshot(''))).toBe('');
  });

  it('没有 CompressionStream 的环境退回未压缩字节，仍然无损', async () => {
    const original = globalThis.CompressionStream;
    // @ts-expect-error 模拟旧运行时
    delete globalThis.CompressionStream;
    try {
      const packed = await packSnapshot(sample);
      expect(packed.kind).toBe('raw');
      expect(await unpackSnapshot(packed)).toBe(sample);
    } finally {
      globalThis.CompressionStream = original;
    }
  });
});
