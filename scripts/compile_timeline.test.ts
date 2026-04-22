import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { compileTimeline } from "./compile_timeline";

const HEALTH = path.join(process.cwd(), "test_data", "health_10452");

function refsFromReport(report: string): number[] {
  return [...report.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1]));
}

describe("compileTimeline", () => {
  it("builds a plausible timeline from health_10452 fixture", async () => {
    const reportPath = path.join(HEALTH, "report.md");
    const report = await fs.promises.readFile(reportPath, "utf8");
    const timeline = await compileTimeline({
      instanceDumpPath: path.join(HEALTH, "instance_dump.json"),
      logPath: path.join(HEALTH, "log.json"),
      reportPath,
      targetDurationMs: 30_000,
    });

    const types = new Set(timeline.steps.map((s) => s.type));
    const required = ["plan", "expert_turn", "search", "source_found", "synthesis"];
    expect(required.filter((t) => types.has(t as (typeof timeline.steps)[number]["type"])).length).toBeGreaterThanOrEqual(4);

    const maxT = Math.max(...timeline.steps.map((s) => s.t_ms));
    expect(maxT).toBeLessThanOrEqual(30_000);
    expect(timeline.total_duration_ms).toBe(30_000);

    expect(timeline.report_tokens.join("")).toBe(report);

    const refs = new Set(refsFromReport(report));
    const citationNums = new Set(timeline.citations.map((c) => c.n));
    for (const ref of refs) {
      expect(citationNums.has(ref), `missing citation [${ref}]`).toBe(true);
    }
  });
});
