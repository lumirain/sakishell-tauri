// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import type { AgentMessage } from "./types";
import {
  buildSettledVisualizationDoc,
  buildStreamingVisualizationDoc,
  HTML_VIZ_CSP,
  HTML_VIZ_STREAM_MESSAGE,
  mobileVisualizationCap,
  mobileVisualizationFrame,
  resolveVisualizationTheme,
  sameVisualizationTheme,
  trimIncompleteStreamingScript,
  visualizationNotice,
  type HtmlVisualizationTheme,
} from "./htmlVisualization";

const theme: HtmlVisualizationTheme = {
  background: "#18181b",
  surface: "#27272a",
  text: "#f4f4f5",
  muted: "#a1a1aa",
  border: "#52525b",
  accent: "#818cf8",
  accentText: "#ffffff",
  colorScheme: "dark",
};

describe("htmlVisualization shell", () => {
  it("settled document supplies CSP, theme and fragment", () => {
    const doc = buildSettledVisualizationDoc(
      "<section>hello</section>",
      "Demo",
      theme,
      "call-1",
    );
    expect(doc).toContain("Content-Security-Policy");
    expect(doc).toContain("<section>hello</section>");
    expect(doc).toContain("--marcel-viz-accent: #818cf8");
    expect(doc).toContain("--viz-series-1: var(--primary)");
    expect(doc).toContain(".viz-controls");
    expect(doc).toContain(".form-control");
    expect(doc).toContain("--marcel-viz-background: #18181b");
    expect(doc).toContain("background: var(--background) !important");
    expect(doc).toContain("background-color: var(--background) !important");
    expect(doc).toContain("var height = body ? body.scrollHeight : 0");
    expect(doc).not.toContain("Math.max(document.documentElement.scrollHeight");
    expect(doc).toContain("call-1");
  });

  it("installs height reporting before fragment scripts during replay", () => {
    const fragment =
      '<section>visible</section><script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.js"></script>';
    const doc = buildSettledVisualizationDoc(
      fragment,
      "Replay",
      theme,
      "replay-1",
    );
    const reporterAt = doc.indexOf("marcel-html-viz:height");
    const externalScriptAt = doc.indexOf("chart.js@4.4.1");
    expect(reporterAt).toBeGreaterThan(-1);
    expect(externalScriptAt).toBeGreaterThan(reporterAt);
  });

  it("CSP blocks active network APIs, forms and nested frames", () => {
    expect(HTML_VIZ_CSP).toContain("default-src 'none'");
    expect(HTML_VIZ_CSP).toContain("connect-src blob: data:");
    expect(HTML_VIZ_CSP).toContain("frame-src 'none'");
    expect(HTML_VIZ_CSP).toContain("form-action 'none'");
    expect(HTML_VIZ_CSP).toContain("https://cdn.jsdelivr.net");
    expect(HTML_VIZ_CSP).not.toContain("connect-src https:");
  });

  it("streaming document is fragment-independent and contains reconcile runtime", () => {
    const doc = buildStreamingVisualizationDoc(theme, "stream-1");
    expect(doc).toContain("marcel-viz-stream-root");
    expect(doc).toContain(HTML_VIZ_STREAM_MESSAGE);
    expect(doc).toContain("current.appendChild(added)");
    expect(doc).toContain("sync(root, next)");
  });

  it("drops only a trailing incomplete script", () => {
    expect(
      trimIncompleteStreamingScript("<div>ready</div><script>const x ="),
    ).toBe("<div>ready</div>");
    expect(
      trimIncompleteStreamingScript("<div>ready</div><script>ok()</script>"),
    ).toBe("<div>ready</div><script>ok()</script>");
    expect(
      trimIncompleteStreamingScript("<style>.x{color:red}</style><div>x"),
    ).toBe("<style>.x{color:red}</style><div>x");
  });

  it("lets only the phone's inline document opt out of scrolling", () => {
    const rule = "html, body { overflow: hidden; }";
    const args = ["<p>x</p>", "x", theme, "t"] as const;
    expect(buildSettledVisualizationDoc(...args)).not.toContain(rule);
    expect(
      buildSettledVisualizationDoc(...args, { scrollable: true }),
    ).not.toContain(rule);
    expect(
      buildSettledVisualizationDoc(...args, { scrollable: false }),
    ).toContain(rule);
    expect(buildStreamingVisualizationDoc(theme, "t")).not.toContain(rule);
    expect(
      buildStreamingVisualizationDoc(theme, "t", { scrollable: false }),
    ).toContain(rule);
  });

  it("scopes touch sizing to coarse pointers so desktop stays unchanged", () => {
    const doc = buildSettledVisualizationDoc("<p>x</p>", "x", theme, "t");
    const start = doc.indexOf("@media (pointer: coarse)");
    expect(start).toBeGreaterThan(-1);
    const block = doc.slice(start, doc.indexOf("</style>", start));
    expect(block).toContain("-webkit-tap-highlight-color: transparent");
    expect(block).toContain("-webkit-text-size-adjust: 100%");
    expect(block).toMatch(
      /\.btn, \.form-control, \.form-select, \.form-check \{ min-height: 40px; \}/,
    );
    expect(block).toContain("input[type='checkbox']");
    expect(block).toContain(".viz-controls");
    // 触屏规则全部在媒体查询内：块外不应再出现 40px 的最小高度。
    expect(doc.slice(0, start)).not.toContain("min-height: 40px");
  });

  it("drops unsafe theme declarations instead of repairing them", () => {
    const doc = buildSettledVisualizationDoc(
      "<p>x</p>",
      "x",
      { ...theme, accent: "red; } body { display:none" },
      "x",
    );
    expect(doc).not.toContain("body { display:none");
  });
});

describe("mobile visualization height", () => {
  it("caps a portrait phone at about two thirds of the screen", () => {
    expect(mobileVisualizationCap(390, 844)).toBe(549);
    expect(mobileVisualizationCap(360, 640)).toBe(416);
  });

  it("keeps a floor on a landscape phone", () => {
    // 390 × 0.65 = 254 → 抬到 280；屏幕够高时不受下限影响。
    expect(mobileVisualizationCap(844, 390)).toBe(280);
    expect(mobileVisualizationCap(1000, 800)).toBe(520);
  });

  it("crops only when content clearly exceeds the cap", () => {
    expect(mobileVisualizationFrame(300, 549)).toEqual({
      height: 300,
      clipped: false,
    });
    // 超出不到一个余量：整段展示，省掉为几十像素加的渐隐和入口。
    expect(mobileVisualizationFrame(549 + 32, 549)).toEqual({
      height: 581,
      clipped: false,
    });
    expect(mobileVisualizationFrame(549 + 33, 549)).toEqual({
      height: 549,
      clipped: true,
    });
  });
});

describe("visualizationNotice", () => {
  const base: AgentMessage = {
    id: "m",
    role: "tool",
    content: "",
    timestamp: "",
    toolResult: {
      toolName: "render_html",
      summary: "",
      result: "",
      success: true,
      blocked: false,
    },
  };

  it("reports failures and blocked calls as errors", () => {
    const failed = {
      ...base,
      toolResult: { ...base.toolResult!, success: false, summary: "坏页面" },
    };
    expect(visualizationNotice(failed, "<p>x</p>")).toEqual({
      tone: "error",
      text: "坏页面",
    });
    const blocked = {
      ...base,
      toolResult: { ...base.toolResult!, blocked: true },
    };
    expect(visualizationNotice(blocked, "<p>x</p>")?.text).toBe("可视化失败");
  });

  it("says so when there is nothing to show, except while still streaming", () => {
    expect(visualizationNotice(base, "  ")).toEqual({
      tone: "muted",
      text: "可视化内容不可用",
    });
    expect(visualizationNotice({ ...base, isExecuting: true }, "")).toBeNull();
    expect(visualizationNotice(base, "<p>x</p>")).toBeNull();
  });
});

describe("resolveVisualizationTheme", () => {
  afterEach(() => {
    document.documentElement.style.removeProperty("--marcel-viz-background");
    document.body.replaceChildren();
  });

  it("falls back to the root tokens when no host is given", () => {
    document.documentElement.style.setProperty("--marcel-viz-background", "#18181b");
    expect(resolveVisualizationTheme().background).toBe("#18181b");
  });

  it("reads the color of the surface the host sits on, not the root's", () => {
    // 手机对话页比 :root 默认的面更深：覆盖写在那一层，可视化从自己的位置继承。
    document.documentElement.style.setProperty("--marcel-viz-background", "#18181b");
    const page = document.createElement("div");
    page.style.setProperty("--marcel-viz-background", "#09090b");
    const host = document.createElement("div");
    page.append(host);
    document.body.append(page);
    expect(resolveVisualizationTheme(host).background).toBe("#09090b");
    // 其余没被覆盖的颜色仍取自 :root，不会变成空串。
    expect(resolveVisualizationTheme(host).accent).toBe(
      resolveVisualizationTheme().accent,
    );
  });

  it("a host with no override behaves like the root", () => {
    document.documentElement.style.setProperty("--marcel-viz-background", "#18181b");
    const host = document.createElement("div");
    document.body.append(host);
    expect(resolveVisualizationTheme(host).background).toBe("#18181b");
  });
});

describe("sameVisualizationTheme", () => {
  it("compares field by field, so an unchanged theme keeps the same document", () => {
    expect(sameVisualizationTheme(theme, { ...theme })).toBe(true);
    expect(
      sameVisualizationTheme(theme, { ...theme, background: "#09090b" }),
    ).toBe(false);
    expect(
      sameVisualizationTheme(theme, { ...theme, colorScheme: "light" }),
    ).toBe(false);
  });
});
