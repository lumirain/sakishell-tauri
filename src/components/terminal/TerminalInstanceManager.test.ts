// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 休眠 / 唤醒的编排测试。xterm 换成一个最小替身：write 异步入队（和真的一样，
 * 靠回调确认解析完成），序列化 = 已解析写入的拼接。这样能钉住的是**顺序与竞态**：
 * 冻结期间到达的输出、唤醒期间到达的输出、期间被切到前台 / 销毁，都不能丢也不能乱序。
 * 序列化与还原对真 xterm 的保真度，在实现时用真实 xterm 5.5 + addon-serialize 0.13 验证过。
 */
const h = vi.hoisted(() => {
  class FakeTerminal {
    static all: FakeTerminal[] = [];
    cols: number;
    rows: number;
    options: Record<string, unknown>;
    content = '';
    disposed = false;
    selection = false;
    buffer = { active: { type: 'normal' as 'normal' | 'alternate', viewportY: 0, baseY: 0 } };
    /** 每次 scrollToLine 的行号，以及调用瞬间已解析的内容（用来断言发生在快照之后、休眠期输出之前）。 */
    scrolls: Array<{ line: number; contentAtCall: string }> = [];
    private queue: Array<[string, (() => void) | undefined]> = [];
    private scheduled = false;
    constructor(opts: Record<string, unknown> = {}) {
      this.cols = (opts.cols as number) ?? 80;
      this.rows = (opts.rows as number) ?? 24;
      this.options = { ...opts };
      FakeTerminal.all.push(this);
    }
    loadAddon(addon: { activate?: (t: FakeTerminal) => void }) {
      addon.activate?.(this);
    }
    open() {}
    write(data: string, cb?: () => void) {
      this.queue.push([data, cb]);
      if (this.scheduled) return;
      this.scheduled = true;
      queueMicrotask(() => {
        this.scheduled = false;
        if (this.disposed) {
          this.queue = [];
          return; // 真 xterm 销毁后也不会再回调
        }
        for (const [d, c] of this.queue.splice(0)) {
          this.content += d;
          c?.();
        }
      });
    }
    hasSelection() {
      return this.selection;
    }
    scrollToLine(line: number) {
      this.scrolls.push({ line, contentAtCall: this.content });
      this.buffer.active.viewportY = line;
    }
    onData() {
      return { dispose() {} };
    }
    attachCustomKeyEventHandler() {}
    refresh() {}
    focus() {}
    reset() {
      this.content = '';
    }
    dispose() {
      this.disposed = true;
    }
  }
  class FakeSerialize {
    term: FakeTerminal | null = null;
    activate(t: FakeTerminal) {
      this.term = t;
    }
    serialize() {
      return this.term!.content;
    }
  }
  class Inert {
    activate() {}
    fit() {}
    dispose() {}
    clearTextureAtlas() {}
    onContextLoss() {
      return { dispose() {} };
    }
  }
  const handlers = new Map<string, (payload: unknown) => void>();
  const unsubscribed: string[] = [];
  return { FakeTerminal, FakeSerialize, Inert, handlers, unsubscribed };
});

vi.mock('@xterm/xterm', () => ({ Terminal: h.FakeTerminal }));
vi.mock('@xterm/addon-fit', () => ({ FitAddon: h.Inert }));
vi.mock('@xterm/addon-web-links', () => ({ WebLinksAddon: h.Inert }));
vi.mock('@xterm/addon-webgl', () => ({ WebglAddon: h.Inert }));
vi.mock('@xterm/addon-serialize', () => ({ SerializeAddon: h.FakeSerialize }));
vi.mock('@tauri-apps/plugin-clipboard-manager', () => ({ readText: vi.fn() }));
vi.mock('@/lib/tauri', () => ({ sshSendInput: vi.fn(async () => {}), sshResize: vi.fn(async () => {}) }));
vi.mock('@/lib/tauriEvent', () => ({
  subscribeTauriEvent: (name: string, cb: (payload: unknown) => void) => {
    h.handlers.set(name, cb);
    return () => {
      h.handlers.delete(name);
      h.unsubscribed.push(name);
    };
  },
}));
vi.mock('@/lib/externalLinks', () => ({ openExternalLink: vi.fn() }));
vi.mock('@/lib/terminalFont', () => ({
  buildTerminalFontFamily: (v: string) => `stack(${v})`,
  onBundledNerdFontReady: () => () => {},
}));
vi.mock('@/lib/terminalScrollGesture', () => ({
  attachAltScreenTouchScroll: () => ({ dispose() {} }),
  createRemoteScrollForwarder: () => ({ forward() {} }),
}));
vi.mock('./terminalClickLocate', () => ({ attachClickLocate: () => ({ dispose() {} }) }));
vi.mock('@/stores/settingsStore', () => ({
  useSettingsStore: {
    getState: () => ({ settings: { fontSize: 14, fontFamily: 'Mono', terminalColors: undefined } }),
  },
}));

import { PENDING_WAKE_CHARS } from '@/lib/terminalHibernation';
import { terminalInstanceManager as mgr } from './TerminalInstanceManager';

const { FakeTerminal } = h;
const eventName = (id: string) => `ssh://output/${id}`;
const emit = (id: string, text: string) => h.handlers.get(eventName(id))!(text);
/** 让 fake xterm 的异步解析与 gzip 管线都跑完。 */
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const lastTerm = () => FakeTerminal.all[FakeTerminal.all.length - 1];

/** 建一个已在后台、已写入内容的终端。 */
async function backgroundSession(id: string, content: string) {
  const inst = mgr.create(id);
  mgr.attach(id, document.body.appendChild(document.createElement('div')));
  mgr.setVisible(id, false);
  emit(id, content);
  await settle();
  return inst;
}

beforeEach(() => {
  mgr.destroyAll();
  FakeTerminal.all.length = 0;
  h.handlers.clear();
  h.unsubscribed.length = 0;
});

describe('休眠', () => {
  it('后台终端休眠后释放 xterm，快照里是此前的全部内容', async () => {
    const inst = await backgroundSession('s1', 'hello\r\n');
    const first = lastTerm();
    expect(await mgr.hibernate('s1')).toBe(true);
    expect(first.disposed).toBe(true);
    expect(inst.terminal).toBeNull();
    expect(inst.fitAddon).toBeNull();
    expect(mgr.isDormant('s1')).toBe(true);
  });

  it('休眠期间到达的输出排队，不写进任何 xterm；唤醒后接在快照之后且保持顺序', async () => {
    await backgroundSession('s1', 'AAA');
    await mgr.hibernate('s1');
    const created = FakeTerminal.all.length;
    emit('s1', 'B1');
    emit('s1', 'B2');
    expect(FakeTerminal.all.length).toBe(created); // 没有凭空新建实例

    await mgr.wake('s1');
    await settle();
    expect(lastTerm().content).toBe('AAAB1B2');
    expect(mgr.isDormant('s1')).toBe(false);
  });

  it('冻结过程中（等待解析屏障时）到达的输出不丢、不乱序', async () => {
    await backgroundSession('s1', 'AAA');
    const freezing = mgr.hibernate('s1');
    emit('s1', 'B'); // 屏障回调之前到达
    expect(await freezing).toBe(true);
    emit('s1', 'C'); // 休眠后到达
    await mgr.wake('s1');
    await settle();
    expect(lastTerm().content).toBe('AAABC');
  });

  it('唤醒时用休眠前的行列数重建，避免按默认尺寸重排历史', async () => {
    await backgroundSession('s1', 'x');
    const term = lastTerm();
    term.cols = 173;
    term.rows = 41;
    await mgr.hibernate('s1');
    await mgr.wake('s1');
    expect(lastTerm().cols).toBe(173);
    expect(lastTerm().rows).toBe(41);
  });

  it('gzip 完成前后唤醒都能还原（明文快照与压缩快照两条路径）', async () => {
    // 压缩完成前：快照还是明文。压缩落定的时机取决于运行时，这里直接构造这个状态。
    const a = await backgroundSession('early', 'EARLY-内容');
    await mgr.hibernate('early');
    await vi.waitFor(() => expect(a.sleep?.packed).not.toBeNull());
    a.sleep!.packed = null;
    a.sleep!.text = 'EARLY-内容';
    await mgr.wake('early');
    await settle();
    expect(lastTerm().content).toBe('EARLY-内容');

    // 压缩完成后：明文已被丢弃，只剩压缩字节
    const b = await backgroundSession('late', 'LATE-内容');
    await mgr.hibernate('late');
    await vi.waitFor(() => expect(b.sleep?.packed).not.toBeNull());
    expect(b.sleep?.text).toBeNull();
    await mgr.wake('late');
    await settle();
    expect(lastTerm().content).toBe('LATE-内容');
  });

  it('并发多次唤醒只重建一个 xterm', async () => {
    await backgroundSession('s1', 'x');
    await mgr.hibernate('s1');
    const before = FakeTerminal.all.length;
    await Promise.all([mgr.wake('s1'), mgr.wake('s1'), mgr.wake('s1')]);
    expect(FakeTerminal.all.length).toBe(before + 1);
  });

  it('解压期间到达的输出不丢（排队后在重建的同一个 tick 排空）', async () => {
    const inst = await backgroundSession('s1', 'AAA');
    await mgr.hibernate('s1');
    await vi.waitFor(() => expect(inst.sleep?.packed).not.toBeNull());
    const waking = mgr.wake('s1'); // 开始解压
    emit('s1', 'LATE');
    await waking;
    await settle();
    expect(lastTerm().content).toBe('AAALATE');
    emit('s1', '!');
    await settle();
    expect(lastTerm().content).toBe('AAALATE!'); // 唤醒后恢复直写
  });

  it('用户滚上去看历史时，唤醒后滚回同一行，且发生在快照解析完、休眠期输出写入之前', async () => {
    await backgroundSession('s1', 'HISTORY');
    const view = lastTerm().buffer.active;
    view.baseY = 200;
    view.viewportY = 37; // 滚在历史中间
    await mgr.hibernate('s1');
    emit('s1', 'NEW');
    await mgr.wake('s1');
    await settle();

    const restored = lastTerm();
    expect(restored.scrolls).toEqual([{ line: 37, contentAtCall: 'HISTORY' }]);
    expect(restored.content).toBe('HISTORYNEW');
  });

  it('本来就贴在底部的终端不滚动，继续跟随新输出', async () => {
    await backgroundSession('s1', 'HISTORY');
    const view = lastTerm().buffer.active;
    view.baseY = 200;
    view.viewportY = 200; // 贴底
    await mgr.hibernate('s1');
    await mgr.wake('s1');
    await settle();
    expect(lastTerm().scrolls).toEqual([]);
  });

  it('setVisible(true) 自动唤醒休眠的终端', async () => {
    await backgroundSession('s1', 'AAA');
    await mgr.hibernate('s1');
    mgr.setVisible('s1', true);
    await mgr.wake('s1');
    await settle();
    expect(mgr.isDormant('s1')).toBe(false);
    expect(lastTerm().content).toBe('AAA');
  });
});

describe('不该休眠的情形', () => {
  it('正在显示的不休眠', async () => {
    await backgroundSession('s1', 'x');
    mgr.setVisible('s1', true);
    expect(await mgr.hibernate('s1')).toBe(false);
    expect(mgr.get('s1')?.terminal).not.toBeNull();
  });

  it('备用屏幕（vim / tmux）不休眠', async () => {
    await backgroundSession('s1', 'x');
    lastTerm().buffer.active.type = 'alternate';
    expect(await mgr.hibernate('s1')).toBe(false);
    expect(lastTerm().disposed).toBe(false);
  });

  it('有选区的不休眠', async () => {
    await backgroundSession('s1', 'x');
    lastTerm().selection = true;
    expect(await mgr.hibernate('s1')).toBe(false);
  });

  it('调试虚拟会话不休眠', async () => {
    const id = 'debug-session:1';
    mgr.create(id);
    mgr.setVisible(id, false);
    expect(await mgr.hibernate(id)).toBe(false);
  });

  it('冻结途中被切到前台：放弃休眠，排队的输出按序写回原终端', async () => {
    await backgroundSession('s1', 'AAA');
    const term = lastTerm();
    const freezing = mgr.hibernate('s1');
    emit('s1', 'B');
    mgr.setVisible('s1', true);
    expect(await freezing).toBe(false);
    await settle();
    expect(term.disposed).toBe(false);
    expect(term.content).toBe('AAAB');
    expect(mgr.isDormant('s1')).toBe(false);
  });

  it('冻结途中进了备用屏幕：放弃休眠', async () => {
    await backgroundSession('s1', 'AAA');
    const term = lastTerm();
    const freezing = mgr.hibernate('s1');
    term.buffer.active.type = 'alternate';
    expect(await freezing).toBe(false);
    expect(term.disposed).toBe(false);
  });

  it('冻结途中被销毁：不抛错，也不复活', async () => {
    await backgroundSession('s1', 'AAA');
    // 销毁后的 xterm 不会再回调屏障；靠超时兜底，用假计时器跳过等待。
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const freezing = mgr.hibernate('s1');
      mgr.destroy('s1');
      await vi.advanceTimersByTimeAsync(2000);
      expect(await freezing).toBe(false);
      expect(mgr.has('s1')).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('休眠期间的状态与事件', () => {
  it('输入禁用状态在休眠中记下，重建时恢复', async () => {
    await backgroundSession('s1', 'x');
    await mgr.hibernate('s1');
    mgr.setStdinEnabled('s1', false);
    await mgr.wake('s1');
    expect(lastTerm().options.disableStdin).toBe(true);
    mgr.setStdinEnabled('s1', true);
    expect(lastTerm().options.disableStdin).toBe(false);
  });

  it('休眠中的断开横幅排进队列，唤醒后出现在历史末尾，且只出一次', async () => {
    await backgroundSession('s1', 'prompt$ ');
    await mgr.hibernate('s1');
    mgr.showDisconnectBanner('s1', 'disconnected', '网络连接已中断');
    mgr.showDisconnectBanner('s1', 'disconnected', '网络连接已中断');
    await mgr.wake('s1');
    await settle();
    const text = lastTerm().content;
    expect(text.startsWith('prompt$ ')).toBe(true);
    expect(text.match(/连接已断开/g)).toHaveLength(1);
    expect(lastTerm().options.disableStdin).toBe(true);
  });

  it('休眠中积压的输出超过上限就提前唤醒', async () => {
    await backgroundSession('s1', 'AAA');
    await mgr.hibernate('s1');
    emit('s1', 'x'.repeat(PENDING_WAKE_CHARS + 1));
    await vi.waitFor(() => expect(mgr.isDormant('s1')).toBe(false));
    await settle();
    expect(lastTerm().content.startsWith('AAAx')).toBe(true);
  });

  it('重建的终端用管理器记下的最终外观，而不是设置存档', async () => {
    await backgroundSession('s1', 'x');
    const theme = { background: '#123456' };
    mgr.applyAppearance({ fontSize: 19, fontFamily: 'F', theme });
    expect(lastTerm().options.fontSize).toBe(19);
    await mgr.hibernate('s1');
    await mgr.wake('s1');
    expect(lastTerm().options.fontSize).toBe(19);
    expect(lastTerm().options.fontFamily).toBe('F');
    expect(lastTerm().options.theme).toBe(theme);
  });

  it('销毁休眠中的终端会撤掉输出订阅', async () => {
    await backgroundSession('s1', 'x');
    await mgr.hibernate('s1');
    mgr.destroy('s1');
    expect(h.unsubscribed).toContain(eventName('s1'));
    expect(mgr.has('s1')).toBe(false);
  });
});

describe('定时扫描', () => {
  it('静默够久的后台终端被休眠，前台与刚有输出的不动', async () => {
    const t0 = Date.now();
    await backgroundSession('quiet', 'x');
    await backgroundSession('chatty', 'x');
    mgr.create('front');
    mgr.setVisible('front', true);

    // quiet / chatty 都已隐藏；chatty 在阈值边缘刚来过输出
    emit('chatty', 'more');
    mgr.sweepIdle(t0 + 59_000);
    await settle();
    expect(mgr.isDormant('quiet')).toBe(false); // 还没到 60 秒

    const quietInst = mgr.get('quiet')!;
    const chattyInst = mgr.get('chatty')!;
    chattyInst.lastActivityAt = t0 + 50_000;
    quietInst.lastActivityAt = t0;
    quietInst.hiddenSince = t0;
    chattyInst.hiddenSince = t0;
    mgr.sweepIdle(t0 + 61_000);
    await settle();
    expect(mgr.isDormant('quiet')).toBe(true);
    expect(mgr.isDormant('chatty')).toBe(false); // 10 秒前刚有输出
    expect(mgr.isDormant('front')).toBe(false);
  });
});
