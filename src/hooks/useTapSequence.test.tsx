// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTapSequence } from "./useTapSequence";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
const complete = vi.fn();
const counts: number[] = [];

function Harness() {
  const tap = useTapSequence(10, 1500, complete);
  return (
    <button type="button" onClick={() => counts.push(tap())}>
      logo
    </button>
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  counts.length = 0;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root.render(<Harness />));
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});

function tap(times = 1) {
  for (let i = 0; i < times; i += 1) act(() => host.querySelector("button")?.click());
}

describe("useTapSequence", () => {
  it("reports the position inside the current run and completes on the last tap", () => {
    tap(9);
    expect(complete).not.toHaveBeenCalled();
    expect(counts).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    tap();
    expect(complete).toHaveBeenCalledTimes(1);
    expect(counts[counts.length - 1]).toBe(10);
  });

  it("starts a fresh run after completing instead of firing again on tap 11", () => {
    tap(10);
    tap();
    expect(complete).toHaveBeenCalledTimes(1);
    expect(counts[counts.length - 1]).toBe(1);
  });

  it("breaks the run when two taps are further apart than the interval", () => {
    tap(9);
    vi.advanceTimersByTime(1500);
    tap();
    expect(counts[counts.length - 1]).toBe(1);
    expect(complete).not.toHaveBeenCalled();
  });

  it("keeps the run alive while every gap stays under the interval", () => {
    for (let i = 0; i < 10; i += 1) {
      tap();
      vi.advanceTimersByTime(1400);
    }
    expect(complete).toHaveBeenCalledTimes(1);
  });
});
