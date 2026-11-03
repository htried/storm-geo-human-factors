import { describe, it, expect } from "vitest";
import { CONDITIONS, assignCondition, injectionDirectionOf, isAgentCondition, isInjectedCondition } from "./assignment";

const SECRET = "test-secret-that-is-long-enough";

describe("assignCondition", () => {
  it("returns one of the four conditions", () => {
    const c = assignCondition("p1", SECRET);
    expect(CONDITIONS).toContain(c);
  });

  it("is deterministic", () => {
    expect(assignCondition("p1", SECRET)).toBe(assignCondition("p1", SECRET));
  });

  it("distributes roughly evenly over all conditions", () => {
    const n = 1000 * CONDITIONS.length;
    const counts: Record<string, number> = {};
    for (let i = 0; i < n; i++) {
      const c = assignCondition(`p${i}`, SECRET);
      counts[c] = (counts[c] ?? 0) + 1;
    }
    for (const c of CONDITIONS) {
      expect(counts[c]).toBeGreaterThan(800);
      expect(counts[c]).toBeLessThan(1200);
    }
  });

  it("splits the default study arms into equal thirds", () => {
    const arms = ["vanilla_agent", "injected_agent_pro", "injected_agent_con"] as const;
    const counts: Record<string, number> = {};
    for (let i = 0; i < 3000; i++) {
      const c = assignCondition(`p${i}`, SECRET, arms);
      counts[c] = (counts[c] ?? 0) + 1;
    }
    for (const c of arms) {
      expect(counts[c]).toBeGreaterThan(850);
      expect(counts[c]).toBeLessThan(1150);
    }
  });

  it("maps arms to injection sides", () => {
    expect(injectionDirectionOf("injected_agent_pro")).toBe("pro");
    expect(injectionDirectionOf("injected_agent_con")).toBe("con");
    expect(injectionDirectionOf("injected_agent")).toBeUndefined();
    expect(injectionDirectionOf("vanilla_agent")).toBeUndefined();
    expect(isInjectedCondition("injected_agent_con")).toBe(true);
    expect(isInjectedCondition("vanilla_agent")).toBe(false);
    expect(isAgentCondition("injected_agent_pro")).toBe(true);
    expect(isAgentCondition("injected_search")).toBe(false);
  });

  it("differs across different secrets (in aggregate)", () => {
    let differences = 0;
    const N = 40;
    for (let i = 0; i < N; i++) {
      if (
        assignCondition(`q${i}`, SECRET) !==
        assignCondition(`q${i}`, SECRET + "-other")
      ) {
        differences++;
      }
    }
    expect(differences).toBeGreaterThan(N / 3);
  });
});
