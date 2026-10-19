import type { Terminal as XTerm } from '@xterm/xterm';

/**
 * xterm 缩小行数时，屏幕内容会不会往上滚、滚几行——纯函数，不碰 DOM。
 *
 * 底栏面板展开的动画里，终端要保持原行数、用位移把内容顶上去，动画结束再一次性 fit；
 * 位移量必须和 xterm 最终的真实行为一致，否则收尾那一刻文字会多跳一下。
 * 规则取自 xterm 的 `Buffer.resize`：每删掉一行，若光标下方还有行就直接丢掉那一行
 * （不论空不空），否则光标行被顶出屏幕、整体上滚一行。所以
 *   上滚行数 = max(0, 删掉的行数 − 光标下方的行数)
 * `terminalRowShift.test.ts` 用真实 xterm 逐场景钉住这条规则；升级 xterm 后若变红，
 * 先看 `Buffer.resize` 有没有改。
 */
export interface RowShiftState {
  rows: number;
  /** 光标在可视区内的行号（0 起）。 */
  cursorY: number;
  /** 缓冲底部对应的视口顶行号（xterm 的 `baseY`）。 */
  baseY: number;
  /** 当前视口顶行号。 */
  viewportY: number;
  isAlternate: boolean;
}

export function readRowShiftState(terminal: XTerm): RowShiftState {
  const buffer = terminal.buffer.active;
  return {
    rows: terminal.rows,
    cursorY: buffer.cursorY,
    baseY: buffer.baseY,
    viewportY: buffer.viewportY,
    isAlternate: buffer.type === 'alternate',
  };
}

/**
 * 缩小到 `newRows` 行时内容上滚的行数（0 = 内容原地不动，只是底部被裁掉）。
 * 返回 `null` = 没法可靠预测（备用屏幕、用户正翻看历史、并非缩小），调用方应放弃位移动画。
 */
export function predictShrinkScroll(state: RowShiftState, newRows: number): number | null {
  if (state.isAlternate) return null;
  if (state.viewportY !== state.baseY) return null;
  if (newRows >= state.rows || newRows < 1) return null;
  const removed = state.rows - newRows;
  const belowCursor = state.rows - 1 - state.cursorY;
  return Math.max(0, removed - belowCursor);
}
