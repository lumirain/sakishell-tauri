import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { AgentMessage } from "@/lib/types";
import { useMessageViewState } from "@/components/agent/messageViewState";
import {
  buildSettledVisualizationDoc,
  buildStreamingVisualizationDoc,
  HTML_VIZ_HEIGHT_MESSAGE,
  HTML_VIZ_STREAM_MESSAGE,
  resolveVisualizationTheme,
  sameVisualizationTheme,
  trimIncompleteStreamingScript,
  visualizationPresentation,
  type HtmlVisualizationTheme,
  type VisualizationDocOptions,
} from "@/lib/htmlVisualization";

export const VISUALIZATION_MIN_HEIGHT = 48;

/**
 * 宿主主题（含深浅色切换）变化时重新解析，iframe 文档随之重建。
 *
 * `host`：undefined = 只看 `:root`（桌面）；元素 = 按它在 DOM 里的位置取色（手机，
 * 所在的面可能比 `:root` 默认的更深）；null = 宿主元素还没挂上。`ready` 在宿主的
 * 颜色解析完之前为 false，调用方此前不要渲染 iframe——否则会先用 `:root` 的颜色
 * 建一次文档，解析完又换一次，一个 iframe 白白加载两遍。
 */
export function useVisualizationTheme(host?: Element | null): {
  theme: HtmlVisualizationTheme;
  ready: boolean;
} {
  const [theme, setTheme] = useState(() => resolveVisualizationTheme());
  const [resolvedHost, setResolvedHost] = useState<Element | null>(null);
  const refresh = useCallback(
    () =>
      setTheme((prev) => {
        const next = resolveVisualizationTheme(host);
        return sameVisualizationTheme(prev, next) ? prev : next;
      }),
    [host],
  );
  // 布局阶段解析：在绘制之前完成，用户看不到换色。
  useLayoutEffect(() => {
    if (!host) return;
    refresh();
    setResolvedHost(host);
  }, [host, refresh]);
  useEffect(() => {
    const observer = new MutationObserver(refresh);
    observer.observe(document.documentElement, { attributes: true });
    observer.observe(document.body, { attributes: true });
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    media.addEventListener("change", refresh);
    return () => {
      observer.disconnect();
      media.removeEventListener("change", refresh);
    };
  }, [refresh]);
  return {
    theme,
    ready: host === undefined || (host !== null && host === resolvedHost),
  };
}

interface Options extends VisualizationDocOptions {
  /**
   * 流式阶段向 iframe 推送新片段的最小间隔（毫秒）。0 = 来一次推一次（桌面）。
   * 手机端取 120 左右：每次推送 iframe 都要重新解析并比对整段 DOM，
   * 模型逐 token 吐字时没必要每个 token 都做一遍。
   */
  streamThrottleMs?: number;
  /**
   * 可视化容器的 DOM 元素，用来按所在的面取底色，取值含义见 `useVisualizationTheme`。
   * 桌面不传。
   */
  host?: Element | null;
}

/**
 * 对话内可视化 iframe 的共用逻辑：展示数据、主题、流式 / 定稿文档、高度上报与
 * 流式推送。两端容器（桌面 `HtmlVisualization`、手机 `MobileHtmlVisualization`）
 * 只负责外框、高度上限与各自的入口，不重复这一套。
 *
 * `contentHeight` 是 iframe 里内容的真实高度（只保证不小于最小值），**不含上限**：
 * 上限因端而异（桌面按 `mode`，手机按屏高），由容器自己取。
 */
export function useHtmlVisualization(
  message: AgentMessage,
  { streamThrottleMs = 0, host, ...docOptions }: Options = {},
) {
  const presentation = visualizationPresentation(message);
  const { title, fragment } = presentation;
  const token = message.toolResult?.toolCallId ?? message.id;
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [loaded, setLoaded] = useState(false);
  // 记在列表的 view 缓存里：虚拟列表卸载 / 重建这一行后 iframe 从上次的高度起步，
  // 不会先缩成 48px 再弹回去，滚动位置也就不被带偏。
  const [contentHeight, setContentHeight] = useMessageViewState(
    "viz-content-height",
    VISUALIZATION_MIN_HEIGHT,
  );
  const { theme, ready } = useVisualizationTheme(host);
  const { scrollable, focus } = docOptions;

  // iframe 不渲染期间没有文档可言；之后新挂的 iframe 要重新等它自己的 load。
  useEffect(() => {
    if (!ready) setLoaded(false);
  }, [ready]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== frameRef.current?.contentWindow) return;
      const data = event.data as {
        type?: unknown;
        token?: unknown;
        height?: unknown;
      } | null;
      if (data?.type !== HTML_VIZ_HEIGHT_MESSAGE || data.token !== token)
        return;
      if (typeof data.height !== "number" || !Number.isFinite(data.height))
        return;
      // 0 不是内容高度：页面被 display:none（手机切到别的 tab）、iframe 还没排版时
      // 内容区会量出 0。照单全收会缩成最小高度，切回来再弹开。
      if (data.height <= 0) return;
      setContentHeight(
        Math.max(VISUALIZATION_MIN_HEIGHT, Math.ceil(data.height)),
      );
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [token, setContentHeight]);

  const streamingDoc = useMemo(
    () => buildStreamingVisualizationDoc(theme, token, { scrollable, focus }),
    [theme, token, scrollable, focus],
  );
  const settledDoc = useMemo(
    () =>
      buildSettledVisualizationDoc(fragment, title, theme, token, {
        scrollable,
        focus,
      }),
    [fragment, title, theme, token, scrollable, focus],
  );
  const doc = message.isExecuting ? streamingDoc : settledDoc;

  const lastStreamPost = useRef(0);
  useEffect(() => {
    if (!message.isExecuting || !loaded || !fragment.trim()) return;
    const post = () => {
      lastStreamPost.current = Date.now();
      frameRef.current?.contentWindow?.postMessage(
        {
          type: HTML_VIZ_STREAM_MESSAGE,
          token,
          fragment: trimIncompleteStreamingScript(fragment),
        },
        "*",
      );
    };
    // 节流：距上次推送不足间隔就等到间隔满再推最新的片段。片段再变会清掉这个
    // 定时器重新算，所以最后一版内容一定会推出去；流式结束时 iframe 换成定稿文档，
    // 没推出去的那一次本来也就不再需要。
    const wait = streamThrottleMs - (Date.now() - lastStreamPost.current);
    if (wait <= 0) {
      post();
      return;
    }
    const timer = setTimeout(post, wait);
    return () => clearTimeout(timer);
  }, [fragment, loaded, message.isExecuting, token, streamThrottleMs]);

  return {
    ...presentation,
    token,
    frameRef,
    theme,
    ready,
    doc,
    contentHeight,
    onLoad: () => setLoaded(true),
  };
}
