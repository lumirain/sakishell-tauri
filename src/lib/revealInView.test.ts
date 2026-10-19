// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { nearestScroller, revealDelta } from "./revealInView";

describe("revealDelta", () => {
  const view = { top: 100, bottom: 500 };

  it("is zero when the target already sits inside the margins", () => {
    expect(revealDelta({ top: 200, bottom: 260 }, view)).toBe(0);
    expect(revealDelta({ top: 116, bottom: 484 }, view)).toBe(0);
  });

  it("scrolls down by exactly what is hidden below, plus the margin", () => {
    // 键盘把可视区下沿抬到 500：输入框底边在 540，要再露出 40 + 16。
    expect(revealDelta({ top: 480, bottom: 540 }, view)).toBe(56);
  });

  it("scrolls up when the target is above the view", () => {
    expect(revealDelta({ top: 60, bottom: 110 }, view)).toBe(-56);
  });

  it("aligns the top edge when the target is taller than the view", () => {
    expect(revealDelta({ top: 300, bottom: 900 }, view)).toBe(300 - 116);
  });

  it("honours a custom margin", () => {
    expect(revealDelta({ top: 480, bottom: 520 }, view, 0)).toBe(20);
  });
});

describe("nearestScroller", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it("finds the closest vertically scrolling ancestor", () => {
    const outer = document.createElement("div");
    outer.style.overflowY = "auto";
    const inner = document.createElement("div");
    inner.style.overflowY = "scroll";
    const target = document.createElement("iframe");
    inner.append(target);
    outer.append(inner);
    document.body.append(outer);
    expect(nearestScroller(target)).toBe(inner);
  });

  it("skips ancestors that only clip", () => {
    const scroller = document.createElement("div");
    scroller.style.overflowY = "auto";
    const clip = document.createElement("div");
    clip.style.overflowY = "hidden";
    const target = document.createElement("iframe");
    clip.append(target);
    scroller.append(clip);
    document.body.append(scroller);
    expect(nearestScroller(target)).toBe(scroller);
  });

  it("falls back to the document scroller", () => {
    const target = document.createElement("iframe");
    document.body.append(target);
    expect(nearestScroller(target)).toBe(
      document.scrollingElement ?? document.documentElement,
    );
  });
});
