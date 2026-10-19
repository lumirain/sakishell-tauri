import { describe, expect, it } from "vitest";
import {
  BOTTOM_BRACKET,
  CRANK_LENGTH,
  footAt,
  HIP,
  kneeFor,
  PEDAL_KEYFRAMES_CSS,
} from "./pelicanPedal";

const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

describe("pedal geometry", () => {
  it("keeps the foot on the crank circle for every angle", () => {
    for (let i = 0; i < 24; i += 1) {
      const foot = footAt((i / 24) * Math.PI * 2);
      expect(dist(foot, BOTTOM_BRACKET)).toBeCloseTo(CRANK_LENGTH, 6);
    }
  });

  it("keeps both leg bones the same length through the whole pedal stroke", () => {
    for (let i = 0; i < 24; i += 1) {
      const foot = footAt((i / 24) * Math.PI * 2);
      const knee = kneeFor(HIP, foot);
      expect(dist(HIP, knee)).toBeCloseTo(33, 3);
      expect(dist(knee, foot)).toBeCloseTo(33, 3);
    }
  });

  it("bends the knee toward the front of the bike (the pelican faces left)", () => {
    for (let i = 0; i < 24; i += 1) {
      const foot = footAt((i / 24) * Math.PI * 2);
      const knee = kneeFor(HIP, foot);
      const mid = { x: (HIP.x + foot.x) / 2, y: (HIP.y + foot.y) / 2 };
      expect(knee.x).toBeLessThan(mid.x);
    }
  });

  it("emits a full loop of keyframes for both legs and both cranks", () => {
    for (const name of ["pelican-leg-a", "pelican-leg-b", "pelican-crank-a", "pelican-crank-b"]) {
      expect(PEDAL_KEYFRAMES_CSS).toContain(`@keyframes ${name}{`);
    }
    // 16 段 = 17 个关键帧，首尾同位置才能无缝循环
    const leg = PEDAL_KEYFRAMES_CSS.match(/@keyframes pelican-leg-a\{(.*)\}/)?.[1] ?? "";
    const frames = leg.match(/d:path\("[^"]+"\)/g) ?? [];
    expect(frames).toHaveLength(17);
    expect(frames[0]).toBe(frames[16]);
  });
});
