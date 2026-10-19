// @vitest-environment jsdom
import { act, type CSSProperties } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentMessage } from "@/lib/types";
import {
  HTML_VIZ_HEIGHT_MESSAGE,
  MOBILE_VIZ_STREAM_THROTTLE_MS,
} from "@/lib/htmlVisualization";
import { resetBackHandlers } from "@/mobile/backHandler";
import MobileHtmlVisualization from "./MobileHtmlVisualization";
import {
  MessageViewCacheContext,
  MessageViewIdContext,
  type MessageViewCache,
} from "./messageViewState";

const NO_SCROLL_RULE = "html, body { overflow: hidden; }";

let host: HTMLDivElement;
let root: Root;

function vizMessage(overrides: Partial<AgentMessage> = {}): AgentMessage {
  return {
    id: "m1",
    role: "tool",
    content: "",
    timestamp: "",
    toolResult: {
      toolName: "render_html",
      summary: "",
      result: "",
      success: true,
      blocked: false,
      arguments: { title: "利率对比", fragment: "<div id='x'>chart</div>" },
      toolCallId: "call-1",
    },
    ...overrides,
  };
}

async function render(message: AgentMessage = vizMessage()) {
  await act(async () =>
    root.render(<MobileHtmlVisualization message={message} />),
  );
}

function inlineFrame() {
  return host.querySelector<HTMLIFrameElement>("iframe")!;
}

async function reportHeight(height: number) {
  const frame = inlineFrame();
  await act(async () => {
    window.dispatchEvent(
      new MessageEvent("message", {
        data: { type: HTML_VIZ_HEIGHT_MESSAGE, token: "call-1", height },
        source: frame.contentWindow,
      }),
    );
  });
}

function button(name: string, scope: ParentNode = host) {
  return scope.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`);
}

function fullscreenText(): HTMLButtonElement | undefined {
  return [...host.querySelectorAll("button")].find((b) =>
    b.textContent?.includes("全屏查看"),
  );
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  // 390×844 的竖屏手机：高度上限 round(844 × 0.65) = 549。
  vi.stubGlobal("innerWidth", 390);
  vi.stubGlobal("innerHeight", 844);
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
  // 桌面面板 / 底部面板的底色（globals.css 的默认值）。
  document.documentElement.style.setProperty("--marcel-viz-background", "#18181b");
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  document.documentElement.style.removeProperty("--marcel-viz-background");
  resetBackHandlers();
  vi.unstubAllGlobals();
});

describe("MobileHtmlVisualization", () => {
  it("inline document cannot scroll, so a swipe on it moves the conversation", async () => {
    await render();
    expect(inlineFrame().srcdoc).toContain(NO_SCROLL_RULE);
  });

  it("shows short content in full, with no crop and no fade", async () => {
    await render();
    await reportHeight(300);
    expect(inlineFrame().style.height).toBe("300px");
    expect(fullscreenText()).toBeUndefined();
    // 标题行的图标入口仍在：生成完成后随时可以放大看。
    expect(button("全屏查看")).not.toBeNull();
  });

  it("caps tall content to about one screen and offers fullscreen at the crop", async () => {
    await render();
    await reportHeight(1400);
    expect(inlineFrame().style.height).toBe("549px");
    expect(fullscreenText()).toBeDefined();
  });

  it("does not crop content that only just exceeds the cap", async () => {
    await render();
    await reportHeight(549 + 20);
    expect(inlineFrame().style.height).toBe("569px");
    expect(fullscreenText()).toBeUndefined();
  });

  it("keeps a landscape phone usable instead of a sliver", async () => {
    vi.stubGlobal("innerWidth", 844);
    vi.stubGlobal("innerHeight", 390);
    await render();
    await reportHeight(1400);
    // 390 × 0.65 = 254，低于横屏下限 280。
    expect(inlineFrame().style.height).toBe("280px");
  });

  it("follows rotation without a new report from the frame", async () => {
    await render();
    await reportHeight(1400);
    expect(inlineFrame().style.height).toBe("549px");
    vi.stubGlobal("innerWidth", 844);
    vi.stubGlobal("innerHeight", 390);
    await act(async () => {
      window.dispatchEvent(new Event("resize"));
    });
    expect(inlineFrame().style.height).toBe("280px");
  });

  it("offers no fullscreen entry while the visualization is still being built", async () => {
    await render(vizMessage({ isExecuting: true }));
    await reportHeight(1400);
    expect(inlineFrame().style.height).toBe("549px");
    expect(button("全屏查看")).toBeNull();
    expect(fullscreenText()).toBeUndefined();
  });

  it("opens a scrollable fullscreen instance and closes it with the back gesture", async () => {
    await render();
    await reportHeight(1400);
    await act(async () => fullscreenText()!.click());

    const viewer = document.querySelector<HTMLElement>(
      '[data-region="mobile-html-viz-viewer"]',
    )!;
    expect(viewer).not.toBeNull();
    const viewerFrame = viewer.querySelector("iframe")!;
    expect(viewerFrame.srcdoc).toContain("chart");
    expect(viewerFrame.srcdoc).not.toContain(NO_SCROLL_RULE);
    // 新实例：与对话里那份是两个 iframe。
    expect(viewerFrame).not.toBe(inlineFrame());

    // 退出动画在 jsdom 里不会触发 animationend，走查看器自带的兜底定时器。
    vi.useFakeTimers();
    try {
      await act(async () => {
        expect(window.__marcelHandleBack?.()).toBe(true);
      });
      await act(async () => vi.advanceTimersByTime(450));
    } finally {
      vi.useRealTimers();
    }
    expect(
      document.querySelector('[data-region="mobile-html-viz-viewer"]'),
    ).toBeNull();
  });

  it("title-row icon opens the same viewer", async () => {
    await render();
    await act(async () => button("全屏查看")!.click());
    expect(
      document.querySelector('[data-region="mobile-html-viz-viewer"]'),
    ).not.toBeNull();
  });

  it("ignores a zero height, which only means the page was hidden", async () => {
    await render();
    await reportHeight(300);
    // 切到别的 tab：agent 页 display:none，iframe 内容区量出 0。
    await reportHeight(0);
    expect(inlineFrame().style.height).toBe("300px");
    await reportHeight(-5);
    expect(inlineFrame().style.height).toBe("300px");
    // 切回来后真实高度照常生效。
    await reportHeight(420);
    expect(inlineFrame().style.height).toBe("420px");
  });

  it("starts a rebuilt frame at the height the list remembers", async () => {
    const cache: MessageViewCache = new Map();
    const withCache = (message: AgentMessage | null) => (
      <MessageViewCacheContext.Provider value={cache}>
        <MessageViewIdContext.Provider value="m1">
          {message && <MobileHtmlVisualization message={message} />}
        </MessageViewIdContext.Provider>
      </MessageViewCacheContext.Provider>
    );
    await act(async () => root.render(withCache(vizMessage())));
    await reportHeight(420);
    // 虚拟列表把这一行卸载，再滚回来重建。
    await act(async () => root.render(withCache(null)));
    expect(host.querySelector("iframe")).toBeNull();
    await act(async () => root.render(withCache(vizMessage())));
    expect(inlineFrame().style.height).toBe("420px");
  });

  it("installs the keyboard bridge in the inline document", async () => {
    await render();
    expect(inlineFrame().srcdoc).toContain("wantsKeyboard");
  });

  describe("while streaming", () => {
    const streaming = (fragment: string) =>
      vizMessage({
        isExecuting: true,
        toolResult: {
          ...vizMessage().toolResult!,
          arguments: { title: "利率对比", fragment },
        },
      });
    const posted = (spy: ReturnType<typeof vi.spyOn>) =>
      spy.mock.calls.map(([data]) => (data as { fragment: string }).fragment);

    afterEach(() => vi.useRealTimers());

    it("pushes at most one fragment per interval and always ends on the latest", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(1_000_000);
      // 先挂空片段的 iframe 并等它 load，再装监听、送入第一版内容。
      await render(streaming(""));
      const frame = inlineFrame();
      await act(async () => {
        frame.dispatchEvent(new Event("load"));
      });
      const post = vi.spyOn(frame.contentWindow!, "postMessage");
      await render(streaming("<p>a</p>"));
      // 首次立即推：没有上一次推送在等。
      expect(posted(post)).toEqual(["<p>a</p>"]);

      // 模型逐 token 吐字：120ms 内来了三版。
      for (const text of ["<p>ab</p>", "<p>abc</p>", "<p>abcd</p>"]) {
        await act(async () => vi.advanceTimersByTime(20));
        await render(streaming(text));
      }
      expect(posted(post)).toEqual(["<p>a</p>"]);

      await act(async () => vi.advanceTimersByTime(MOBILE_VIZ_STREAM_THROTTLE_MS));
      expect(posted(post)).toEqual(["<p>a</p>", "<p>abcd</p>"]);

      // 间隔满之后来的新片段又是立即推。
      await act(async () => vi.advanceTimersByTime(MOBILE_VIZ_STREAM_THROTTLE_MS));
      await render(streaming("<p>abcde</p>"));
      expect(posted(post)).toEqual(["<p>a</p>", "<p>abcd</p>", "<p>abcde</p>"]);
    });
  });

  describe("surface color", () => {
    // 手机对话页比桌面面板更深：`.marcel-viz-surface-page` 在那一层覆盖底色变量。
    const onPage = (message: AgentMessage = vizMessage()) => (
      <div style={{ "--marcel-viz-background": "#09090b" } as CSSProperties}>
        <MobileHtmlVisualization message={message} />
      </div>
    );

    it("paints the frame in the color of the surface it sits on", async () => {
      await act(async () => root.render(onPage()));
      expect(inlineFrame().style.backgroundColor).toBe("rgb(9, 9, 11)");
      expect(inlineFrame().srcdoc).toContain("--marcel-viz-background: #09090b");
    });

    it("keeps the default color on a surface that does not override it", async () => {
      await render();
      expect(inlineFrame().style.backgroundColor).toBe("rgb(24, 24, 27)");
      expect(inlineFrame().srcdoc).toContain("--marcel-viz-background: #18181b");
    });

    it("builds the document once, with the surface's color from the start", async () => {
      const srcdocs: string[] = [];
      const setAttribute = Element.prototype.setAttribute;
      const spy = vi
        .spyOn(Element.prototype, "setAttribute")
        .mockImplementation(function (this: Element, name, value) {
          // React 18 以 `srcDoc` 的大小写写属性，DOM 里不区分。
          if (name.toLowerCase() === "srcdoc") srcdocs.push(value);
          return setAttribute.call(this, name, value);
        });
      try {
        await act(async () => root.render(onPage()));
      } finally {
        spy.mockRestore();
      }
      // 不能先用 :root 的颜色建一次、解析完宿主再换一次：同一个 iframe 会白白加载两遍。
      expect(srcdocs).toHaveLength(1);
      expect(srcdocs[0]).toContain("--marcel-viz-background: #09090b");
    });

    it("fades the cropped bottom into the same color", async () => {
      await act(async () => root.render(onPage()));
      await reportHeight(1400);
      const fade = host.querySelector<HTMLElement>('[aria-hidden="true"].pointer-events-none');
      expect(fade?.style.background).toContain("rgb(9, 9, 11)");
    });

    it("gives the fullscreen viewer the same color, so page and frame read as one", async () => {
      await act(async () => root.render(onPage()));
      await act(async () => button("全屏查看")!.click());
      const viewer = document.querySelector<HTMLElement>(
        '[data-region="mobile-html-viz-viewer"]',
      )!;
      expect(viewer.style.backgroundColor).toBe("rgb(9, 9, 11)");
      expect(viewer.querySelector("iframe")!.style.backgroundColor).toBe(
        "rgb(9, 9, 11)",
      );
    });
  });

  it("shows failures as a line of text instead of a frame", async () => {
    await render(
      vizMessage({
        toolResult: {
          ...vizMessage().toolResult!,
          success: false,
          summary: "render_html: 只接受 HTML fragment",
        },
      }),
    );
    expect(host.textContent).toContain("只接受 HTML fragment");
    expect(host.querySelector("iframe")).toBeNull();
  });
});
