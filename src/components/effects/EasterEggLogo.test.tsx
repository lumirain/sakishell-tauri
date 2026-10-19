// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

// 礼炮由 confetti 引擎负责（jsdom 没有 canvas），这里只关心仪式本身
const fireConfetti = vi.fn();
let reduced = false;
vi.mock("@/lib/confetti", () => ({
  fireConfetti: (b: unknown) => fireConfetti(b),
  prefersReducedMotion: () => reduced,
}));

let host: HTMLDivElement;
let root: Root;
let useStore: typeof import("@/stores/supremeEffectsStore").useSupremeEffectsStore;

beforeEach(async () => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  reduced = false;
  localStorage.clear();
  vi.resetModules();
  // 重新加载 store，保证每个用例都从「未解锁」开始，且和被测组件拿到同一个实例
  const mod = await import("./EasterEggLogo");
  useStore = (await import("@/stores/supremeEffectsStore")).useSupremeEffectsStore;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  const Logo = mod.default;
  act(() => root.render(<Logo className="logo" />));
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});

const logo = () => host.querySelector("button") as HTMLButtonElement;

function click(times: number, gapMs = 100) {
  for (let i = 0; i < times; i += 1) {
    act(() => {
      logo().dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerType: "mouse" }));
      logo().click();
    });
    act(() => {
      vi.advanceTimersByTime(gapMs);
    });
  }
}

const banner = () => document.body.querySelector(".supreme-banner");

describe("EasterEggLogo", () => {
  it("renders the logo image as a click target", () => {
    expect(logo().querySelector("img")?.className).toBe("logo");
  });

  it("does not unlock or show anything before the tenth click", () => {
    click(9);
    act(() => {
      vi.advanceTimersByTime(6000);
    });
    expect(useStore.getState().unlocked).toBe(false);
    expect(banner()).toBeNull();
    expect(fireConfetti).not.toHaveBeenCalled();
  });

  it("rides in, then fires the cannons, unlocks and shows the message on the tenth click", () => {
    click(10);
    // 骑进来的这段时间：鹈鹕在，横幅还没出，也还没解锁
    expect(document.body.querySelector('[data-pelican]')).not.toBeNull();
    expect(banner()).toBeNull();
    expect(useStore.getState().unlocked).toBe(false);

    act(() => {
      vi.advanceTimersByTime(1800);
    });
    expect(useStore.getState().unlocked).toBe(true);
    expect(banner()?.textContent).toBe("您已解锁至尊无敌特效功能的启动权限！");
    expect(fireConfetti).toHaveBeenCalled();
    // 解锁不等于打开
    expect(useStore.getState().enabled).toBe(false);
  });

  it("clears the pelican and the banner when the ceremony is over", () => {
    click(10);
    act(() => {
      vi.advanceTimersByTime(7000);
    });
    expect(document.body.querySelector('[data-pelican]')).toBeNull();
    expect(banner()).toBeNull();
  });

  it("does not start a second ceremony while one is running", () => {
    click(10);
    click(10);
    expect(document.body.querySelectorAll('[data-pelican]')).toHaveLength(1);
  });

  it("can be replayed after it has finished", () => {
    click(10);
    act(() => {
      vi.advanceTimersByTime(7000);
    });
    click(10);
    expect(document.body.querySelectorAll('[data-pelican]')).toHaveLength(1);
  });

  it("with reduced motion: no pelican and no cannons, but the message and the unlock still arrive", () => {
    reduced = true;
    click(10);
    act(() => {
      vi.advanceTimersByTime(50);
    });
    expect(document.body.querySelector('[data-pelican]')).toBeNull();
    expect(fireConfetti).not.toHaveBeenCalled();
    expect(useStore.getState().unlocked).toBe(true);
    expect(banner()?.textContent).toContain("至尊无敌特效");
  });
});
