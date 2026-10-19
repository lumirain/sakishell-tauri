import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PanelTransition, PANEL_TRANSITION_MS } from './terminalPanelTransition';
import type { TerminalInstance } from './TerminalInstanceManager';

const CELL = 20;

interface FakeBuffer {
  type: 'normal' | 'alternate';
  cursorY: number;
  baseY: number;
  viewportY: number;
}

function makeInstance(
  rows: number,
  buffer: FakeBuffer,
  onResize?: (rows: number) => void,
  regionHeight = 400,
) {
  const animations: Array<{ keyframes: Keyframe[]; cancel: ReturnType<typeof vi.fn>; onfinish: (() => void) | null }> = [];
  const terminal = {
    rows,
    cols: 80,
    buffer: { active: buffer },
    element: {
      querySelector: () => ({ getBoundingClientRect: () => ({ height: terminal.rows * CELL }) }),
    },
    resize: vi.fn((_cols: number, next: number) => {
      terminal.rows = next;
      onResize?.(next);
    }),
  };
  const fit = vi.fn();
  const container = {
    style: { bottom: '' },
    animate: vi.fn((keyframes: Keyframe[]) => {
      const animation = { keyframes, cancel: vi.fn(), onfinish: null as (() => void) | null };
      animations.push(animation);
      return animation;
    }),
  };
  const instance = {
    id: 's1',
    terminal,
    fitAddon: {
      fit,
      // 与真实 FitAddon 一致：只看容器此刻的高度（regionHeight 减去被挪走的 bottom）
      proposeDimensions: vi.fn(() => ({
        cols: 80,
        rows: Math.floor((regionHeight - (parseFloat(container.style.bottom) || 0)) / CELL),
      })),
    },
    container,
  } as unknown as TerminalInstance;
  return { instance, terminal, fit, container, animations };
}

describe('PanelTransition', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('展开且满屏：推迟缩行，位移到 -scroll*cell，收尾 fit 一次', () => {
    // 20 行满屏，光标在最后一行；面板展开 100px → 终端区 400→300 → 15 行，上滚 5 行
    const { instance, terminal, fit, container, animations } = makeInstance(20, {
      type: 'normal', cursorY: 19, baseY: 30, viewportY: 30,
    });
    const onSettled = vi.fn();
    const t = new PanelTransition();

    expect(t.run({ instance, delta: 100, onSettled })).toBe(true);
    expect(t.active).toBe(true);
    expect(terminal.resize).not.toHaveBeenCalled(); // 过渡期间行数不动
    expect(container.animate).toHaveBeenCalledTimes(1);
    expect(animations[0].keyframes).toEqual([
      { transform: 'translateY(0px)' },
      { transform: `translateY(${-5 * CELL}px)` },
    ]);

    animations[0].onfinish?.();
    expect(t.active).toBe(false);
    expect(animations[0].cancel).toHaveBeenCalled();
    expect(fit).toHaveBeenCalledTimes(1);
    expect(onSettled).toHaveBeenCalledTimes(1);
  });

  it('展开但内容没满屏：不做位移，等面板过渡走完后 fit 一次', () => {
    const { instance, terminal, fit, container } = makeInstance(20, {
      type: 'normal', cursorY: 3, baseY: 0, viewportY: 0,
    });
    const t = new PanelTransition();

    expect(t.run({ instance, delta: 100, onSettled: vi.fn() })).toBe(true);
    expect(container.animate).not.toHaveBeenCalled();
    expect(terminal.resize).not.toHaveBeenCalled();
    expect(fit).not.toHaveBeenCalled();

    vi.advanceTimersByTime(PANEL_TRANSITION_MS + 40);
    expect(t.active).toBe(false);
    expect(fit).toHaveBeenCalledTimes(1);
  });

  it('收起且从回滚里拉回历史行：立即扩行，用量出来的位移反向补回', () => {
    // 15 行，光标在最后一行，回滚里有 30 行；面板收起 100px → 终端区 300→400 → 20 行
    const buffer: FakeBuffer = { type: 'normal', cursorY: 14, baseY: 30, viewportY: 30 };
    const { instance, terminal, container, animations } = makeInstance(
      15,
      buffer,
      () => {
        buffer.viewportY -= 5; // xterm 拉回了 5 行历史
      },
      300,
    );
    const onSettled = vi.fn();
    const t = new PanelTransition();

    expect(t.run({ instance, delta: -100, onSettled })).toBe(true);
    expect(terminal.resize).toHaveBeenCalledWith(80, 20);
    expect(onSettled).toHaveBeenCalledTimes(1); // 远端行数一开始就通知
    expect(container.animate).toHaveBeenCalledTimes(1);
    expect(animations[0].keyframes).toEqual([
      { transform: `translateY(${-5 * CELL}px)` },
      { transform: 'translateY(0px)' },
    ]);
  });

  it('最终行数交给 FitAddon 在目标尺寸下自己算，算完立刻还原容器 bottom', () => {
    const { instance, container } = makeInstance(20, {
      type: 'normal', cursorY: 19, baseY: 30, viewportY: 30,
    });
    const propose = instance.fitAddon!.proposeDimensions as unknown as ReturnType<typeof vi.fn>;
    let bottomSeen = '';
    propose.mockImplementationOnce(() => {
      bottomSeen = container.style.bottom;
      return { cols: 80, rows: 15 };
    });
    const t = new PanelTransition();

    t.run({ instance, delta: 100, onSettled: vi.fn() });
    expect(bottomSeen).toBe('100px'); // 量的时候容器已挪到最终尺寸
    expect(container.style.bottom).toBe(''); // 量完就还原，不会画出中间状态
  });

  it('备用屏幕：立即缩行一次，不做位移', () => {
    const { instance, terminal, container } = makeInstance(20, {
      type: 'alternate', cursorY: 19, baseY: 0, viewportY: 0,
    });
    const t = new PanelTransition();

    expect(t.run({ instance, delta: 100, onSettled: vi.fn() })).toBe(true);
    expect(terminal.resize).toHaveBeenCalledWith(80, 15);
    expect(container.animate).not.toHaveBeenCalled();
  });

  it('行数不会变时不接管，交还给 ResizeObserver', () => {
    const { instance } = makeInstance(20, { type: 'normal', cursorY: 19, baseY: 0, viewportY: 0 }, undefined, 410);
    const t = new PanelTransition();
    // 终端区 410px 有余量：缩 5px 后仍是 20 行
    expect(t.run({ instance, delta: 5, onSettled: vi.fn() })).toBe(false);
    expect(t.active).toBe(false);
  });

  it('休眠中的终端（terminal 为 null）不接管', () => {
    const { instance } = makeInstance(20, { type: 'normal', cursorY: 19, baseY: 0, viewportY: 0 });
    (instance as { terminal: unknown }).terminal = null;
    const t = new PanelTransition();
    expect(t.run({ instance, delta: 100, onSettled: vi.fn() })).toBe(false);
  });

  it('过渡中重新开始：先收尾上一次（fit 一次、撤位移），再接管新的', () => {
    const first = makeInstance(20, { type: 'normal', cursorY: 19, baseY: 30, viewportY: 30 });
    const t = new PanelTransition();
    t.run({ instance: first.instance, delta: 100, onSettled: vi.fn() });

    const second = makeInstance(20, { type: 'normal', cursorY: 19, baseY: 30, viewportY: 30 });
    t.run({ instance: second.instance, delta: 100, onSettled: vi.fn() });

    expect(first.animations[0].cancel).toHaveBeenCalled();
    expect(first.fit).toHaveBeenCalledTimes(1);
    expect(t.instanceId).toBe('s1');
  });

  it('settleUnless：切到别的会话时立即收尾，仍是同一会话则保持', () => {
    const { instance, fit } = makeInstance(20, { type: 'normal', cursorY: 19, baseY: 30, viewportY: 30 });
    const t = new PanelTransition();
    t.run({ instance, delta: 100, onSettled: vi.fn() });

    t.settleUnless('s1');
    expect(t.active).toBe(true);
    t.settleUnless('s2');
    expect(t.active).toBe(false);
    expect(fit).toHaveBeenCalledTimes(1);
  });

  it('settle 可重复调用，不会多 fit', () => {
    const { instance, fit } = makeInstance(20, { type: 'normal', cursorY: 19, baseY: 30, viewportY: 30 });
    const t = new PanelTransition();
    t.run({ instance, delta: 100, onSettled: vi.fn() });
    t.settle();
    t.settle();
    vi.advanceTimersByTime(1000);
    expect(fit).toHaveBeenCalledTimes(1);
  });
});
