// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

const UNLOCKED = "marcel.supremeEffects.unlocked";
const ENABLED = "marcel.supremeEffects.enabled";

/** 状态在模块加载时从 localStorage 读，所以每个用例都重新加载一遍模块。 */
async function load() {
  vi.resetModules();
  return import("./supremeEffectsStore");
}

beforeEach(() => {
  localStorage.clear();
});

describe("supremeEffectsStore", () => {
  it("starts locked and off for a fresh install", async () => {
    const { useSupremeEffectsStore, isSupremeTypingActive } = await load();
    const s = useSupremeEffectsStore.getState();
    expect(s.unlocked).toBe(false);
    expect(s.enabled).toBe(false);
    expect(isSupremeTypingActive()).toBe(false);
  });

  it("unlocking persists, but does not switch the effect on by itself", async () => {
    const { useSupremeEffectsStore, isSupremeTypingActive } = await load();
    useSupremeEffectsStore.getState().unlock();
    expect(useSupremeEffectsStore.getState().unlocked).toBe(true);
    expect(useSupremeEffectsStore.getState().enabled).toBe(false);
    expect(localStorage.getItem(UNLOCKED)).toBe("1");
    expect(isSupremeTypingActive()).toBe(false);
  });

  it("ignores enabling while still locked", async () => {
    const { useSupremeEffectsStore } = await load();
    useSupremeEffectsStore.getState().setEnabled(true);
    expect(useSupremeEffectsStore.getState().enabled).toBe(false);
    expect(localStorage.getItem(ENABLED)).toBeNull();
  });

  it("is active only when unlocked and enabled, and turning it off sticks", async () => {
    const { useSupremeEffectsStore, isSupremeTypingActive } = await load();
    const s = useSupremeEffectsStore.getState();
    s.unlock();
    s.setEnabled(true);
    expect(isSupremeTypingActive()).toBe(true);
    s.setEnabled(false);
    expect(isSupremeTypingActive()).toBe(false);
    expect(localStorage.getItem(ENABLED)).toBeNull();
  });

  it("remembers both flags across a restart", async () => {
    const first = await load();
    first.useSupremeEffectsStore.getState().unlock();
    first.useSupremeEffectsStore.getState().setEnabled(true);

    const second = await load();
    expect(second.useSupremeEffectsStore.getState().unlocked).toBe(true);
    expect(second.useSupremeEffectsStore.getState().enabled).toBe(true);
  });

  it("does not trust a stray enabled flag when the unlock flag is missing", async () => {
    localStorage.setItem(ENABLED, "1");
    const { useSupremeEffectsStore, isSupremeTypingActive } = await load();
    expect(useSupremeEffectsStore.getState().enabled).toBe(false);
    expect(isSupremeTypingActive()).toBe(false);
  });

  it("still works in memory when storage throws", async () => {
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("denied");
    });
    const { useSupremeEffectsStore } = await load();
    expect(() => useSupremeEffectsStore.getState().unlock()).not.toThrow();
    expect(useSupremeEffectsStore.getState().unlocked).toBe(true);
    spy.mockRestore();
  });
});
