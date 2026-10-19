// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildSettledVisualizationDoc,
  buildStreamingVisualizationDoc,
  HTML_VIZ_FOCUS_MESSAGE,
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

const inlineScripts = (doc: string) =>
  [...doc.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
const focusScript = (doc: string) =>
  inlineScripts(doc).find((s) => s.includes("wantsKeyboard"));

/** 在 jsdom 里跑 iframe 里的聚焦脚本：监听器收进 `listeners`，宿主换成 `parent`。 */
function runBridge(mode: "report" | "self") {
  const doc = buildSettledVisualizationDoc("", "x", theme, "tok", { focus: mode });
  const script = focusScript(doc);
  expect(script).toBeDefined();
  const listeners = new Map<string, EventListener>();
  const parent = { postMessage: vi.fn() };
  new Function("parent", "addEventListener", script!)(
    parent,
    (type: string, listener: EventListener) => listeners.set(type, listener),
  );
  return { listeners, parent };
}

function field(tag: string, props: Record<string, unknown> = {}) {
  const el = document.createElement(tag) as HTMLInputElement;
  Object.assign(el, props);
  document.body.append(el);
  return el;
}

function fire(listeners: Map<string, EventListener>, type: string, target: Element) {
  const event = new Event(type, { bubbles: true });
  Object.defineProperty(event, "target", { value: target });
  listeners.get(type)?.(event);
}

afterEach(() => document.body.replaceChildren());

describe("iframe focus bridge: documents", () => {
  it("is absent unless a mode is requested, so desktop documents are unchanged", () => {
    expect(focusScript(buildSettledVisualizationDoc("<p>x</p>", "x", theme, "t"))).toBeUndefined();
    expect(focusScript(buildStreamingVisualizationDoc(theme, "t"))).toBeUndefined();
  });

  it("is installed in settled and streaming documents when requested", () => {
    expect(focusScript(buildSettledVisualizationDoc("<p>x</p>", "x", theme, "t", { focus: "report" }))).toBeDefined();
    expect(focusScript(buildStreamingVisualizationDoc(theme, "t", { focus: "report" }))).toBeDefined();
  });

  it("installs before model-authored markup, like the height reporter", () => {
    const doc = buildSettledVisualizationDoc("<input id=q>", "x", theme, "t", { focus: "report" });
    expect(doc.indexOf("wantsKeyboard")).toBeLessThan(doc.indexOf("<input id=q>"));
  });
});

describe("iframe focus bridge: report mode", () => {
  it("reports where a text field is, tagged with the token", () => {
    const { listeners, parent } = runBridge("report");
    const input = field("input", { type: "text" });
    input.getBoundingClientRect = () => ({ top: 120, bottom: 164 }) as DOMRect;
    fire(listeners, "focusin", input);
    expect(parent.postMessage).toHaveBeenCalledWith(
      { type: HTML_VIZ_FOCUS_MESSAGE, token: "tok", top: 120, bottom: 164 },
      "*",
    );
  });

  it("covers every control that opens the keyboard", () => {
    const { listeners, parent } = runBridge("report");
    for (const el of [
      field("input", { type: "number" }),
      field("input", { type: "search" }),
      field("textarea"),
      Object.defineProperty(field("div"), "isContentEditable", { value: true }),
    ]) {
      el.getBoundingClientRect = () => ({ top: 0, bottom: 10 }) as DOMRect;
      fire(listeners, "focusin", el);
    }
    expect(parent.postMessage).toHaveBeenCalledTimes(4);
  });

  it("ignores controls that never raise the keyboard", () => {
    const { listeners, parent } = runBridge("report");
    for (const el of [
      field("input", { type: "checkbox" }),
      field("input", { type: "radio" }),
      field("input", { type: "range" }),
      field("input", { type: "button" }),
      field("input", { type: "text", readOnly: true }),
      field("textarea", { readOnly: true }),
      field("button"),
      field("select"),
      field("div"),
    ]) {
      fire(listeners, "focusin", el);
    }
    expect(parent.postMessage).not.toHaveBeenCalled();
  });

  it("also reports a tap on a field that kept focus after the keyboard was dismissed", () => {
    const { listeners, parent } = runBridge("report");
    const input = field("input", { type: "text" });
    input.getBoundingClientRect = () => ({ top: 5, bottom: 45 }) as DOMRect;
    fire(listeners, "click", input);
    expect(parent.postMessage).toHaveBeenCalledOnce();
  });
});

describe("iframe focus bridge: self mode", () => {
  it("scrolls the focused field to the middle when the viewport shrinks", () => {
    const { listeners, parent } = runBridge("self");
    const input = field("input", { type: "text" });
    input.scrollIntoView = vi.fn();
    input.focus();
    listeners.get("resize")?.(new Event("resize"));
    expect(input.scrollIntoView).toHaveBeenCalledWith({ block: "center", inline: "nearest" });
    expect(parent.postMessage).not.toHaveBeenCalled();
  });

  it("leaves the scroll position alone when nothing editable is focused", () => {
    const { listeners } = runBridge("self");
    const button = field("button");
    button.scrollIntoView = vi.fn();
    button.focus();
    listeners.get("resize")?.(new Event("resize"));
    expect(button.scrollIntoView).not.toHaveBeenCalled();
  });
});
