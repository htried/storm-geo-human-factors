import { describe, it, expect } from "vitest";
import { pickInjectionSlot, applyInjection } from "./injection";

describe("pickInjectionSlot", () => {
  it("returns a number in [0, n)", () => {
    for (let n = 1; n <= 10; n++) {
      const slot = pickInjectionSlot("s", "q", "secret-long-enough", n);
      expect(slot).toBeGreaterThanOrEqual(0);
      expect(slot).toBeLessThan(n);
    }
  });

  it("is deterministic per (session, query, secret)", () => {
    const a = pickInjectionSlot("s1", "q1", "sec-key-1234", 10);
    const b = pickInjectionSlot("s1", "q1", "sec-key-1234", 10);
    expect(a).toBe(b);
  });

  it("differs when session or query changes (in aggregate)", () => {
    const distinct = new Set<number>();
    for (let i = 0; i < 50; i++)
      distinct.add(pickInjectionSlot(`s${i}`, "q", "sec-key-1234", 10));
    expect(distinct.size).toBeGreaterThan(3);
  });
});

describe("applyInjection", () => {
  const mal = {
    title: "M",
    url: "u",
    displayed_url: "d",
    snippet: "s",
    rank: -1,
  };
  it("replaces the correct slot and updates ranks", () => {
    const results = Array.from({ length: 5 }, (_, i) => ({
      title: `t${i}`,
      url: `u${i}`,
      displayed_url: `d${i}`,
      snippet: `s${i}`,
      rank: i,
    }));
    const out = applyInjection(results, mal, 2);
    expect(out[2]!.title).toBe("M");
    expect(out[2]!.rank).toBe(2);
    expect(out[0]!.title).toBe("t0");
    expect(out.length).toBe(5);
  });

  it("is a no-op for empty arrays", () => {
    expect(applyInjection([], mal, 0)).toEqual([]);
  });
});
