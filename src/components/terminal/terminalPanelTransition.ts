import { predictShrinkScroll, readRowShiftState } from '@/lib/terminalRowShift';
import { isUsableFitSize } from '@/lib/terminalFitGuard';
import type { TerminalInstance } from './TerminalInstanceManager';

/** 与底栏 max-height 过渡（Terminal.tsx）保持一致，改一处必须同步另一处。 */
export const PANEL_TRANSITION_MS = 200;
export const PANEL_TRANSITION_EASING = 'cubic-bezier(0.16, 1, 0.3, 1)';

/** 动画没按时收尾（页面被挂起、定时器被节流）时的兜底余量。 */
const SETTLE_GRACE_MS = 120;
/** 无位移动画时多等约两帧，确保面板的 CSS 过渡已走完。 */
const SETTLE_FRAME_MS = 34;

/**
 * 终端区缩小 `delta` 像素（负数 = 变高）后，FitAddon 会给出多少行。
 *
 * 不自己复刻 FitAddon 的公式——它取父容器的计算高度（含我们给容器加的内边距）、
 * 只扣 `.xterm` 元素自己的内边距、字符格高度读渲染器内部尺寸，任何一处对不齐，
 * 预测的行数就会和收尾那次 `fit()` 差一行，文字在动画结束时整行跳一下。
 * 做法是把容器（`absolute inset-0`）的 bottom 临时挪 `delta`，让 FitAddon 在最终
 * 尺寸下自己算一遍，再还原。同步读布局，不会画出这个中间状态。
 */
function proposeRowsAfterShrink(
  container: HTMLElement,
  fitAddon: NonNullable<TerminalInstance['fitAddon']>,
  delta: number,
): number | null {
  const previous = container.style.bottom;
  container.style.bottom = `${delta}px`;
  try {
    const proposed = fitAddon.proposeDimensions();
    return proposed && Number.isFinite(proposed.rows) ? proposed.rows : null;
  } finally {
    container.style.bottom = previous;
  }
}

export interface PanelTransitionRequest {
  instance: TerminalInstance;
  /** 面板高度的变化量（像素）：展开为正，收起为负。 */
  delta: number;
  /** 行数真正落定后通知远端 PTY（实现里只在行列数变了才发）。 */
  onSettled: (instance: TerminalInstance) => void;
}

/**
 * 底栏面板展开 / 收起期间的终端协调器（manager：同时协调面板动画、xterm 行数、远端 PTY）。
 *
 * 为什么需要：面板用 max-height 做 200ms 过渡，终端区跟着逐帧变矮；如果每一帧都 fit，
 * xterm 行数连续变化，WebGL 画布被反复重设尺寸（清空→重画）而闪烁，远端还会收到十几次
 * SIGWINCH。这里把整个过渡期的 fit 收敛成**一次**，并让文字的视觉位移保持平滑：
 *
 * - 展开（行数变少）：期间 xterm 保持原行数，用 transform 把容器往上推，推多少由
 *   `predictShrinkScroll` 按 xterm 的真实缩行规则算出（内容没满屏时为 0，文字原地不动），
 *   动画结束再 fit 一次并撤掉位移，两帧画面逐像素一致。
 * - 收起（行数变多）：一开始就 resize 到最终行数，由 xterm 决定要不要从回滚里拉回历史行，
 *   然后**量出**实际移动了几行，用反向位移让画面先停在原处、再滑到新位置。
 * - 备用屏幕 / 用户正翻看历史 / 读不到字符格高度：不做位移，只保证全程至多 fit 一次。
 *
 * 过渡期间 `active` 为真，Terminal 的 ResizeObserver 据此不再逐帧 fit。
 */
export class PanelTransition {
  private state: {
    instance: TerminalInstance;
    animation: Animation | null;
    fallbackTimer: ReturnType<typeof setTimeout>;
    onSettled: (instance: TerminalInstance) => void;
  } | null = null;

  get active(): boolean {
    return this.state !== null;
  }

  /** 正在为哪个终端做过渡；没有则 null。 */
  get instanceId(): string | null {
    return this.state?.instance.id ?? null;
  }

  /**
   * 开始一次过渡。返回 false = 不适合做过渡动画（调用方照常走 ResizeObserver 的 fit）。
   */
  run(request: PanelTransitionRequest): boolean {
    this.settle();

    const { instance, delta, onSettled } = request;
    const terminal = instance.terminal;
    const container = instance.container;
    const fitAddon = instance.fitAddon;
    if (!terminal || !fitAddon || delta === 0) return false;
    if (typeof container.animate !== 'function') return false;

    const screen = terminal.element?.querySelector<HTMLElement>('.xterm-screen');
    // 用带小数的实际高度：clientHeight 会取整，非整数 DPR 下乘上滚行数会差出半行。
    const cellHeight = screen && terminal.rows > 0 ? screen.getBoundingClientRect().height / terminal.rows : 0;
    if (!(cellHeight > 0)) return false;

    const finalRows = proposeRowsAfterShrink(container, fitAddon, delta);
    const currentRows = terminal.rows;
    if (finalRows === null || finalRows < 1 || finalRows === currentRows) return false;

    let from = 0;
    let to = 0;
    if (finalRows < currentRows) {
      // 展开：延后到动画结束再缩行；期间把内容顶上去 scroll 行。
      const scroll = predictShrinkScroll(readRowShiftState(terminal), finalRows);
      if (scroll === null) {
        // 备用屏幕 / 翻看历史：没法预测，立刻缩行（只发生一次），不做位移。
        this.resizeNow(instance, finalRows, onSettled);
      } else {
        to = -scroll * cellHeight;
      }
    } else {
      // 收起：先扩到最终行数，量出内容实际下移了几行，再用反向位移补回去。
      const before = readRowShiftState(terminal);
      this.resizeNow(instance, finalRows, onSettled);
      if (!before.isAlternate && before.viewportY === before.baseY) {
        const moved = terminal.buffer.active.viewportY - before.viewportY;
        // moved < 0：从回滚里拉回了历史行，内容整体下移；起点上移同样的量。
        from = moved * cellHeight;
      }
    }

    const animation =
      from !== to
        ? container.animate(
            [{ transform: `translateY(${from}px)` }, { transform: `translateY(${to}px)` }],
            { duration: PANEL_TRANSITION_MS, easing: PANEL_TRANSITION_EASING, fill: 'forwards' },
          )
        : null;
    if (animation) animation.onfinish = () => this.settle();

    // 有位移动画时由它的 onfinish 收尾，定时器只是兜底；没有动画（内容没满屏、位移为 0）
    // 也要等面板的 max-height 过渡走完再 fit，否则量到的不是最终高度。
    const timerDelay = PANEL_TRANSITION_MS + (animation ? SETTLE_GRACE_MS : SETTLE_FRAME_MS);
    this.state = {
      instance,
      animation,
      fallbackTimer: setTimeout(() => this.settle(), timerDelay),
      onSettled,
    };
    return true;
  }

  /** 立即收尾：撤掉位移，按此刻的真实容器尺寸 fit 一次，通知远端。可重复调用。 */
  settle(): void {
    const state = this.state;
    if (!state) return;
    this.state = null;
    clearTimeout(state.fallbackTimer);
    if (state.animation) {
      state.animation.onfinish = null;
      state.animation.cancel();
    }
    const { instance } = state;
    // 休眠或已销毁的终端没有 xterm 可 fit，唤醒 / 重建时会自己 fit。
    if (instance.terminal && instance.fitAddon) {
      // 塌缩（窗口最小化）时不 fit，见 terminalFitGuard。
      if (isUsableFitSize(instance.fitAddon.proposeDimensions())) instance.fitAddon.fit();
      state.onSettled(instance);
    }
  }

  /** 过渡的对象不是 `instanceId`（切会话、会话被关）就立刻收尾。 */
  settleUnless(instanceId: string | null): void {
    if (this.state && this.state.instance.id !== instanceId) this.settle();
  }

  private resizeNow(
    instance: TerminalInstance,
    rows: number,
    onSettled: (instance: TerminalInstance) => void,
  ) {
    const terminal = instance.terminal;
    if (!terminal) return;
    terminal.resize(terminal.cols, rows);
    onSettled(instance);
  }
}
