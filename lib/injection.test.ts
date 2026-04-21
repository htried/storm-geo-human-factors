import { describe, it, expect } from "vitest";
import {
  pickInjectionSlot,
  applyInjection,
  type InjectedResult,
} from "./injection";

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

  it("is keyed by secret (differs across secrets in aggregate)", () => {
    let differences = 0;
    for (let i = 0; i < 40; i++) {
      const a = pickInjectionSlot(`s${i}`, "q", "secret-A-value", 10);
      const b = pickInjectionSlot(`s${i}`, "q", "secret-B-value", 10);
      if (a !== b) differences++;
    }
    expect(differences).toBeGreaterThan(20);
  });

  it("throws on n <= 0", () => {
    expect(() => pickInjectionSlot("s", "q", "secret", 0)).toThrow(/>= 1/);
    expect(() => pickInjectionSlot("s", "q", "secret", -5)).toThrow(/>= 1/);
  });
});

describe("applyInjection", () => {
  const injected: InjectedResult = {
    title: "M",
    url: "https://mal.example/x",
    displayed_url: "mal.example",
    snippet: "malicious snippet",
  };
  const makeResults = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      title: `t${i}`,
      url: `u${i}`,
      displayed_url: `d${i}`,
      snippet: `s${i}`,
      rank: i,
    }));

  it("replaces the correct slot and updates ranks", () => {
    const results = makeResults(5);
    const out = applyInjection(results, injected, 2);
    expect(out[2]!.title).toBe("M");
    expect(out[2]!.rank).toBe(2);
    expect(out[0]!.title).toBe("t0");
    expect(out.length).toBe(5);
  });

  it("is a no-op for empty arrays", () => {
    expect(applyInjection([], injected, 0)).toEqual([]);
  });

  it("throws if slot is out of range", () => {
    const results = makeResults(5);
    expect(() => applyInjection(results, injected, 5)).toThrow(/out of range/);
    expect(() => applyInjection(results, injected, -1)).toThrow(/out of range/);
  });

  it("leaves no sparse holes", () => {
    const results = makeResults(3);
    const out = applyInjection(results, injected, 1);
    for (const r of out) expect(r).toBeDefined();
    expect(Object.keys(out).length).toBe(3);
  });
});
