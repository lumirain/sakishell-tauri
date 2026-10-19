// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HTML_VIZ_FOCUS_MESSAGE } from "@/lib/htmlVisualization";
import { useIframeFocusReveal } from "./useIframeFocusReveal";

let host: HTMLDivElement;
let root: Root;
let scroller: HTMLDivElement;
let frame: HTMLIFrameElement;
const scrollBy = vi.fn();
let observed: { callback: () => void; disconnected: boolean }[] = [];

function Probe({ token }: { token: string }) {
  const ref = useRef<HTMLIFrameElement>(null);
  useIframeFocusReveal(ref, token);
  return (
    <div data-testid="scroller" style={{ overflowY: "auto" }}>
      <iframe ref={ref} title="viz" />
    </div>
  );
}

const rect = (top: number, bottom: number) =>
  ({ top, bottom, height: bottom - top }) as DOMRect;

async function mount(token = "tok") {
  await act(async () => root.render(<Probe token={token} />));
  scroller = host.querySelector<HTMLDivElement>("[data-testid=scroller]")!;
  frame = host.querySelector("iframe")!;
  scroller.scrollBy = scrollBy as unknown as typeof scroller.scrollBy;
}

/** 列表在 100~500，iframe 顶边在 300：iframe 里相对位置 top/bottom 的控件。 */
function layout(listTop = 100, listBottom = 500, frameTop = 300) {
  scroller.getBoundingClientRect = () => rect(listTop, listBottom);
  frame.getBoundingClientRect = () => rect(frameTop, frameTop + 549);
}

async function focusMessage(
  data: Record<string, unknown>,
  source: MessageEventSource | null = frame.contentWindow,
) {
  await act(async () => {
    window.dispatchEvent(new MessageEvent("message", { data, source }));
  });
}

const focusData = (top: number, bottom: number, token = "tok") => ({
  type: HTML_VIZ_FOCUS_MESSAGE,
  token,
  top,
  bottom,
});

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("innerHeight", 844);
  observed = [];
  vi.stubGlobal(
    "ResizeObserver",
    class {
      entry: { callback: () => void; disconnected: boolean };
      constructor(callback: () => void) {
        this.entry = { callback, disconnected: false };
        observed.push(this.entry);
      }
      observe() {}
      disconnect() {
        this.entry.disconnected = true;
      }
    },
  );
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) =>
    setTimeout(() => cb(0), 0) as unknown as number,
  );
  vi.stubGlobal("cancelAnimationFrame", (id: number) => clearTimeout(id));
  scrollBy.mockReset();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("useIframeFocusReveal", () => {
  it("scrolls the list so a field hidden below the view comes into sight", async () => {
    await mount();
    layout();
    // 控件在 iframe 内 330~374 → 视口 630~674，可视区下沿 500：要再露出 174 + 16。
    await focusMessage(focusData(330, 374));
    expect(scrollBy).toHaveBeenCalledWith({ top: 190 });
  });

  it("does nothing for a field that is already visible", async () => {
    await mount();
    layout();
    await focusMessage(focusData(0, 44)); // 视口 300~344
    expect(scrollBy).not.toHaveBeenCalled();
  });

  it("scrolls up for a field above the view", async () => {
    await mount();
    layout(100, 500, -50);
    await focusMessage(focusData(10, 54)); // 视口 -40~4
    expect(scrollBy).toHaveBeenCalledWith({ top: -156 });
  });

  it("realigns each time the list is squeezed by the keyboard, for a limited time", async () => {
    vi.useFakeTimers();
    await mount();
    layout();
    await focusMessage(focusData(330, 374));
    expect(scrollBy).toHaveBeenCalledTimes(1);

    // 键盘升起：列表下沿 500 → 380。对齐放到下一帧，排在列表自己的贴底之后。
    layout(100, 380);
    observed[0].callback();
    expect(scrollBy).toHaveBeenCalledTimes(1);
    await act(async () => vi.advanceTimersByTime(1));
    expect(scrollBy).toHaveBeenLastCalledWith({ top: 674 - (380 - 16) });

    await act(async () => vi.advanceTimersByTime(2000));
    expect(observed[0].disconnected).toBe(true);
  });

  it("a newer report replaces the one still being followed", async () => {
    await mount();
    layout();
    await focusMessage(focusData(330, 374));
    await focusMessage(focusData(330, 374));
    expect(observed).toHaveLength(2);
    expect(observed[0].disconnected).toBe(true);
    expect(observed[1].disconnected).toBe(false);
  });

  it("stops following when unmounted", async () => {
    await mount();
    layout();
    await focusMessage(focusData(330, 374));
    await act(async () => root.render(<div />));
    expect(observed[0].disconnected).toBe(true);
  });

  it("ignores reports from another window, another token or malformed data", async () => {
    await mount();
    layout();
    await focusMessage(focusData(330, 374), window);
    await focusMessage(focusData(330, 374, "other"));
    await focusMessage({ type: "something-else", token: "tok", top: 330, bottom: 374 });
    await focusMessage({ type: HTML_VIZ_FOCUS_MESSAGE, token: "tok", top: "330", bottom: 374 });
    await focusMessage({ type: HTML_VIZ_FOCUS_MESSAGE, token: "tok", top: NaN, bottom: 374 });
    expect(scrollBy).not.toHaveBeenCalled();
  });

  it("respects a visual viewport that the keyboard has shrunk", async () => {
    vi.stubGlobal("visualViewport", { offsetTop: 0, height: 380 });
    await mount();
    layout();
    // 容器下沿 500，但键盘盖住了 380 以下：以 380 为准。
    await focusMessage(focusData(0, 44)); // 视口 300~344，在 380-16 内
    expect(scrollBy).not.toHaveBeenCalled();
    await focusMessage(focusData(60, 104)); // 视口 360~404
    expect(scrollBy).toHaveBeenCalledWith({ top: 404 - (380 - 16) });
  });
});
