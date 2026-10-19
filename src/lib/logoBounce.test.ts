import { describe, expect, it } from "vitest";
import { isSettled, jumpEnergy, makeAxis, stepAxis, tune } from "./logoBounce";

function simulate(axis: ReturnType<typeof makeAxis>, seconds: number, onFrame?: (pos: number) => void) {
  for (let t = 0; t < seconds; t += 1 / 60) {
    stepAxis(axis, 1 / 60);
    onFrame?.(axis.pos);
  }
}

describe("spring axis", () => {
  it("settles on its target", () => {
    const axis = makeAxis(1, 0.3, 0.6);
    axis.target = 0.5;
    simulate(axis, 3);
    expect(isSettled(axis, 0.001, 0.01)).toBe(true);
  });

  it("critically damped (zeta = 1) never overshoots", () => {
    const axis = makeAxis(0.84, 0.2, 1);
    axis.target = 1;
    let max = -Infinity;
    simulate(axis, 2, (p) => (max = Math.max(max, p)));
    expect(max).toBeLessThanOrEqual(1 + 1e-4);
  });

  it("underdamped (zeta < 1) overshoots then comes back", () => {
    const axis = makeAxis(0.84, 0.36, 0.42);
    axis.target = 1;
    let max = -Infinity;
    simulate(axis, 2, (p) => (max = Math.max(max, p)));
    expect(max).toBeGreaterThan(1.01);
    expect(Math.abs(axis.pos - 1)).toBeLessThan(0.01);
  });

  it("an upward impulse lifts above rest and returns (the jump)", () => {
    const lift = makeAxis(0, 0.55, 0.5);
    lift.vel = -450;
    let min = Infinity;
    simulate(lift, 3, (p) => (min = Math.min(min, p)));
    expect(min).toBeLessThan(-10);
    expect(Math.abs(lift.pos)).toBeLessThan(0.5);
  });

  it("stays numerically stable on a long frame (tab was backgrounded)", () => {
    const axis = makeAxis(0, 0.18, 1);
    axis.target = 10;
    stepAxis(axis, 0.5);
    expect(Number.isFinite(axis.pos)).toBe(true);
    expect(Math.abs(axis.pos - 10)).toBeLessThan(1);
  });

  it("tune keeps position and velocity, so changing parameters mid-flight never jumps", () => {
    const axis = makeAxis(0, 0.5, 0.5);
    axis.pos = -12;
    axis.vel = 80;
    tune(axis, 0.2, 1);
    expect(axis.pos).toBe(-12);
    expect(axis.vel).toBe(80);
  });
});

describe("jumpEnergy", () => {
  it("grows with each consecutive click and is capped at the tenth", () => {
    expect(jumpEnergy(1)).toBe(1);
    expect(jumpEnergy(5)).toBeGreaterThan(jumpEnergy(2));
    expect(jumpEnergy(10)).toBeCloseTo(1.9);
    expect(jumpEnergy(99)).toBe(jumpEnergy(10));
    expect(jumpEnergy(0)).toBe(1);
  });
});
