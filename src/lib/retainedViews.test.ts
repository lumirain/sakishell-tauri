import { describe, expect, it } from "vitest";
import { MOBILE_MAX_RETAINED_VIEWS, retainRecent } from "./retainedViews";

const keys = (set: ReadonlySet<string>) => [...set];

describe("retainRecent", () => {
  it("without a limit only appends, and returns the same set for a known key", () => {
    const one = retainRecent(new Set(), "a");
    expect(keys(one)).toEqual(["a"]);
    expect(retainRecent(one, "a")).toBe(one);
    expect(keys(retainRecent(one, "b"))).toEqual(["a", "b"]);
  });

  it("without a limit never evicts, however many are visited", () => {
    let set: ReadonlySet<string> = new Set();
    for (let i = 0; i < 50; i++) set = retainRecent(set, `row-${i}`);
    expect(set.size).toBe(50);
  });

  it("drops the one seen longest ago once over the limit", () => {
    let set: ReadonlySet<string> = new Set();
    for (const key of ["a", "b", "c", "d"]) set = retainRecent(set, key, 4);
    expect(keys(set)).toEqual(["a", "b", "c", "d"]);
    set = retainRecent(set, "e", 4);
    expect(keys(set)).toEqual(["b", "c", "d", "e"]);
  });

  it("treats a returning row as the most recent, so it is not the next to go", () => {
    let set: ReadonlySet<string> = new Set();
    for (const key of ["a", "b", "c", "d"]) set = retainRecent(set, key, 4);
    set = retainRecent(set, "a", 4);
    expect(keys(set)).toEqual(["b", "c", "d", "a"]);
    set = retainRecent(set, "e", 4);
    expect(keys(set)).toEqual(["c", "d", "a", "e"]);
  });

  it("leaves the set untouched when the newest key is seen again", () => {
    const set = retainRecent(retainRecent(new Set(), "a", 4), "b", 4);
    expect(retainRecent(set, "b", 4)).toBe(set);
  });

  it("shrinks an oversized set when the limit is lowered", () => {
    const big = new Set(["a", "b", "c", "d", "e", "f"]);
    expect(keys(retainRecent(big, "f", 2))).toEqual(["e", "f"]);
  });

  it("keeps one slot for the row being viewed even with a limit of 1", () => {
    const set = retainRecent(new Set(["a"]), "b", 1);
    expect(keys(set)).toEqual(["b"]);
  });

  it("exposes the phone limit as four", () => {
    expect(MOBILE_MAX_RETAINED_VIEWS).toBe(4);
  });
});
