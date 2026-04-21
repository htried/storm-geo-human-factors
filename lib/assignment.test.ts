import { describe, it, expect } from "vitest";
import { assignCondition, CONDITIONS } from "./assignment";

const SECRET = "test-secret-that-is-long-enough";

describe("assignCondition", () => {
  it("returns one of the four conditions", () => {
    const c = assignCondition("p1", SECRET);
    expect(CONDITIONS).toContain(c);
  });

  it("is deterministic", () => {
    expect(assignCondition("p1", SECRET)).toBe(assignCondition("p1", SECRET));
  });

  it("distributes roughly evenly over 4 buckets across 4000 ids", () => {
    const counts: Record<string, number> = {};
    for (let i = 0; i < 4000; i++) {
      const c = assignCondition(`p${i}`, SECRET);
      counts[c] = (counts[c] ?? 0) + 1;
    }
    for (const c of CONDITIONS) {
      expect(counts[c]).toBeGreaterThan(800);
      expect(counts[c]).toBeLessThan(1200);
    }
  });

  it("differs across different secrets", () => {
    const any = [0, 1, 2, 3].some(
      (i) =>
        assignCondition(`q${i}`, SECRET) !==
        assignCondition(`q${i}`, SECRET + "-other"),
    );
    expect(any).toBe(true);
  });
});
