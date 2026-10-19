// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

const fireConfetti = vi.fn();
vi.mock("./confetti", () => ({ fireConfetti: (b: unknown) => fireConfetti(b) }));
vi.mock("./caretPosition", () => ({ getCaretViewportPoint: () => ({ x: 120, y: 340 }) }));

let celebrateTyping: typeof import("./typingConfetti").celebrateTyping;
let confettiCountFor: typeof import("./typingConfetti").confettiCountFor;
let store: typeof import("@/stores/supremeEffectsStore").useSupremeEffectsStore;

const textarea = () => document.createElement("textarea");
let clock = 1000;

beforeEach(async () => {
  localStorage.clear();
  vi.resetModules();
  fireConfetti.mockClear();
  // 每个用例把时钟推到新的一秒，避开 35ms 节流
  clock += 1000;
  vi.spyOn(performance, "now").mockImplementation(() => clock);
  ({ celebrateTyping, confettiCountFor } = await import("./typingConfetti"));
  ({ useSupremeEffectsStore: store } = await import("@/stores/supremeEffectsStore"));
});

function enable() {
  store.getState().unlock();
  store.getState().setEnabled(true);
}

describe("celebrateTyping", () => {
  it("does nothing until the effect is unlocked and switched on", () => {
    celebrateTyping(textarea(), "", "a");
    expect(fireConfetti).not.toHaveBeenCalled();

    store.getState().unlock();
    celebrateTyping(textarea(), "", "a");
    expect(fireConfetti).not.toHaveBeenCalled();
  });

  it("fires one burst at the caret when new text comes in", () => {
    enable();
    celebrateTyping(textarea(), "ab", "abc");
    expect(fireConfetti).toHaveBeenCalledTimes(1);
    expect(fireConfetti.mock.calls[0][0]).toMatchObject({ x: 120, y: 340, angle: -90 });
  });

  it("stays quiet on deletes and same-length replacements", () => {
    enable();
    celebrateTyping(textarea(), "abc", "ab");
    celebrateTyping(textarea(), "abc", "abd");
    celebrateTyping(textarea(), "", "");
    expect(fireConfetti).not.toHaveBeenCalled();
  });

  it("throttles bursts that arrive faster than 35ms apart", () => {
    enable();
    celebrateTyping(textarea(), "", "a");
    clock += 10;
    celebrateTyping(textarea(), "a", "ab");
    expect(fireConfetti).toHaveBeenCalledTimes(1);
    clock += 40;
    celebrateTyping(textarea(), "ab", "abc");
    expect(fireConfetti).toHaveBeenCalledTimes(2);
  });

  it("makes a bigger burst for a paste than for a single key, within a cap", () => {
    expect(confettiCountFor(1)).toBe(12);
    expect(confettiCountFor(40)).toBeGreaterThan(confettiCountFor(1));
    expect(confettiCountFor(100000)).toBe(42);
  });
});
