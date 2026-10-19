import { useCallback, useEffect, useRef } from "react";

/**
 * 连点序列计数：相邻两次点击间隔 < `intervalMs` 才算「连续」，凑够 `required` 次触发 `onComplete`
 * 并清零。返回的 `tap()` 每次调用都会推进计数，并返回**本轮连点里这是第几下**（凑够那一下返回
 * `required`，之后下一轮重新从 1 开始）——调用方可以拿它做渐强反馈，而不必自己再数一遍。
 *
 * 隐藏调试入口（版本号连点）与关于页图标彩蛋共用这一份计数规则，别各写一套。
 */
export function useTapSequence(
  required: number,
  intervalMs: number,
  onComplete: () => void,
): () => number {
  const tapsRef = useRef({ count: 0, lastTap: null as number | null });
  // 回调走 ref：调用方常传内联闭包，不能因为它每次渲染都变就重建 tap
  const completeRef = useRef(onComplete);
  useEffect(() => {
    completeRef.current = onComplete;
  }, [onComplete]);

  return useCallback(() => {
    const taps = tapsRef.current;
    const now = Date.now();
    taps.count =
      taps.lastTap == null || now - taps.lastTap >= intervalMs ? 1 : taps.count + 1;
    taps.lastTap = now;
    const reached = taps.count;
    if (reached < required) return reached;

    taps.count = 0;
    taps.lastTap = null;
    completeRef.current();
    return reached;
  }, [required, intervalMs]);
}
