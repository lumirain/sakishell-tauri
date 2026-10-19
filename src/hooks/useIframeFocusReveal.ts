import { useEffect, type RefObject } from "react";
import { HTML_VIZ_FOCUS_MESSAGE } from "@/lib/htmlVisualization";
import { nearestScroller, revealDelta } from "@/lib/revealInView";

/**
 * 软键盘弹起、对话区被挤矮的过程要持续多久：键盘动画加上原生推送 `--ime-bottom`
 * 的延迟，约 300~500ms，留足余量。
 */
const REVEAL_WINDOW_MS = 1500;

/**
 * 手机端：iframe 里的输入控件拿到焦点后，把对话列表滚到能看见它。
 *
 * iframe 里的文档不滚动，控件在跨进程的 iframe 里，宿主没法对它 `scrollIntoView`，
 * 只能由 iframe 报来控件相对 iframe 顶部的位置（`HTML_VIZ_FOCUS_MESSAGE`），
 * 宿主换算成视口坐标再滚自己的列表。键盘弹起、列表被挤矮是在焦点之后才发生的，
 * 所以报告到达后的一小段时间里，列表每次变矮都重新对齐一次。
 */
export function useIframeFocusReveal(
  frameRef: RefObject<HTMLIFrameElement | null>,
  token: string,
) {
  useEffect(() => {
    let stopFollowing: (() => void) | null = null;

    const follow = (frame: HTMLIFrameElement, top: number, bottom: number) => {
      const scroller = nearestScroller(frame);
      const viewport = scroller === document.scrollingElement
        || scroller === document.documentElement;
      const reveal = () => {
        if (!frame.isConnected) return;
        const box = frame.getBoundingClientRect();
        const view = viewport
          ? { top: 0, bottom: window.innerHeight }
          : scroller.getBoundingClientRect();
        // 键盘盖住的是可视视口的下半截：容器没被挤矮时（原生不推 `--ime-bottom`）
        // 靠它兜底。
        const visual = window.visualViewport;
        const visibleBottom = visual
          ? Math.min(view.bottom, visual.offsetTop + visual.height)
          : view.bottom;
        const delta = revealDelta(
          { top: box.top + top, bottom: box.top + bottom },
          { top: view.top, bottom: visibleBottom },
        );
        if (Math.abs(delta) >= 1) scroller.scrollBy({ top: delta });
      };
      reveal();

      let frameId = 0;
      // 放到下一帧：和对话列表自己的「贴底」ResizeObserver 同帧触发时，我们要排在
      // 它后面，否则它刚把列表贴回底部就把这次对齐顶掉。
      const observer = typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(() => {
            cancelAnimationFrame(frameId);
            frameId = requestAnimationFrame(reveal);
          });
      observer?.observe(scroller);
      const timer = setTimeout(stop, REVEAL_WINDOW_MS);
      function stop() {
        clearTimeout(timer);
        cancelAnimationFrame(frameId);
        observer?.disconnect();
        if (stopFollowing === stop) stopFollowing = null;
      }
      return stop;
    };

    const onMessage = (event: MessageEvent) => {
      const frame = frameRef.current;
      if (!frame || event.source !== frame.contentWindow) return;
      const data = event.data as {
        type?: unknown;
        token?: unknown;
        top?: unknown;
        bottom?: unknown;
      } | null;
      if (data?.type !== HTML_VIZ_FOCUS_MESSAGE || data.token !== token) return;
      if (
        typeof data.top !== "number" || !Number.isFinite(data.top)
        || typeof data.bottom !== "number" || !Number.isFinite(data.bottom)
      ) return;
      stopFollowing?.();
      stopFollowing = follow(frame, data.top, data.bottom);
    };

    window.addEventListener("message", onMessage);
    return () => {
      window.removeEventListener("message", onMessage);
      stopFollowing?.();
    };
  }, [frameRef, token]);
}
