import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

import { parsePacingRange, planReplay, type ReplayPlan } from "./replay-pacing";
import type { Timeline } from "./corpus-types";

function seeded(seed: number): () => number {
  // mulberry32
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const mock = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), "app/data/corpus.mock.json"), "utf8"),
) as { topics: Array<{ vanilla_timeline: Timeline; injected_timeline: Timeline }> };
const seedTimeline = mock.topics[0]!.injected_timeline;

const sum = (p: ReplayPlan) => p.events.reduce((s, e) => s + e.delayMs, 0);

describe("planReplay", () => {
  it("fits the whole replay into the drawn total, within [min,max]", () => {
    for (let s = 1; s <= 50; s++) {
      const plan = planReplay(seedTimeline, { minTotalMs: 25_000, maxTotalMs: 35_000, rng: seeded(s) });
      expect(plan.totalMs).toBeGreaterThanOrEqual(25_000);
      expect(plan.totalMs).toBeLessThanOrEqual(35_000);
      expect(Math.abs(sum(plan) - plan.totalMs)).toBeLessThanOrEqual(50);
    }
  });

  it("varies the total across sessions (not 30s on the dot)", () => {
    const totals = new Set(
      Array.from({ length: 20 }, (_, s) =>
        planReplay(seedTimeline, { minTotalMs: 25_000, maxTotalMs: 35_000, rng: seeded(s + 1) }).totalMs,
      ),
    );
    expect(totals.size).toBeGreaterThan(15);
  });

  it("emits every step in order and reassembles the exact report", () => {
    const plan = planReplay(seedTimeline, { minTotalMs: 25_000, maxTotalMs: 35_000, rng: seeded(7) });
    const steps = plan.events.filter((e) => e.kind === "step").map((e) => (e as { step: unknown }).step);
    expect(steps).toEqual(seedTimeline.steps);
    const text = plan.events
      .filter((e) => e.kind === "token")
      .map((e) => (e as { token: string }).token)
      .join("");
    expect(text).toBe(seedTimeline.report_tokens.join(""));
    // all steps come before any token
    const firstToken = plan.events.findIndex((e) => e.kind === "token");
    const lastStep = plan.events.map((e) => e.kind).lastIndexOf("step");
    expect(lastStep).toBeLessThan(firstToken);
    expect(plan.events.every((e) => e.delayMs >= 0)).toBe(true);
  });

  it("puts the step/report boundary near stepsMs", () => {
    const plan = planReplay(seedTimeline, { minTotalMs: 30_000, maxTotalMs: 30_000, rng: seeded(3) });
    let t = 0;
    for (const e of plan.events) {
      t += e.delayMs;
      if (e.kind === "token") break;
    }
    expect(plan.stepsMs).toBeGreaterThanOrEqual(15_000);
    expect(plan.stepsMs).toBeLessThanOrEqual(19_500);
    expect(t).toBeGreaterThanOrEqual(plan.stepsMs);
    expect(t).toBeLessThanOrEqual(plan.stepsMs + 200);
  });

  it("is instantaneous with a 0-0 range (used by tests)", () => {
    const plan = planReplay(seedTimeline, { minTotalMs: 0, maxTotalMs: 0 });
    expect(sum(plan)).toBe(0);
  });
});

describe("parsePacingRange", () => {
  it("parses ranges and falls back on junk", () => {
    expect(parsePacingRange("20000-30000")).toEqual({ minTotalMs: 20_000, maxTotalMs: 30_000 });
    expect(parsePacingRange("30000 - 20000")).toEqual({ minTotalMs: 20_000, maxTotalMs: 30_000 });
    expect(parsePacingRange(undefined)).toEqual({ minTotalMs: 25_000, maxTotalMs: 35_000 });
    expect(parsePacingRange("fast")).toEqual({ minTotalMs: 25_000, maxTotalMs: 35_000 });
  });
});
