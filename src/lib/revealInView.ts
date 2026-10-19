export interface VerticalSpan {
  top: number;
  bottom: number;
}

/** 目标上下各留的空隙：贴着容器边缘的输入框看着像被切掉。 */
export const REVEAL_MARGIN = 16;

/**
 * 要让 `target` 完整落进 `view`（上下各留 `margin`），滚动容器还得再滚多少。
 * 正数 = 内容往上走（容器往下滚），负数相反，0 = 已经看得见。
 *
 * 两者用同一个坐标系（一般是视口坐标）。目标比可视区还高时对齐顶边，
 * 保证输入框的开头能看到。
 */
export function revealDelta(
  target: VerticalSpan,
  view: VerticalSpan,
  margin = REVEAL_MARGIN,
): number {
  const topLimit = view.top + margin;
  const bottomLimit = view.bottom - margin;
  if (target.bottom - target.top > bottomLimit - topLimit) {
    return target.top - topLimit;
  }
  if (target.bottom > bottomLimit) return target.bottom - bottomLimit;
  if (target.top < topLimit) return target.top - topLimit;
  return 0;
}

/** 离 `el` 最近的、纵向可滚动的祖先；找不到就是整个文档。 */
export function nearestScroller(el: Element): Element {
  for (let node = el.parentElement; node; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node);
    if (overflowY === "auto" || overflowY === "scroll" || overflowY === "overlay") {
      return node;
    }
  }
  return document.scrollingElement ?? document.documentElement;
}
