import { describe, it, expect } from "vitest";
import { generateCompletionCode, COMPLETION_CODE_ALPHABET } from "./completion";

describe("generateCompletionCode", () => {
  it("returns an 8-character code", () => {
    const c = generateCompletionCode();
    expect(c).toHaveLength(8);
  });

  it("uses only the unambiguous alphabet (no O, 0, I, 1)", () => {
    for (let i = 0; i < 200; i++) {
      const c = generateCompletionCode();
      for (const ch of c) expect(COMPLETION_CODE_ALPHABET).toContain(ch);
      expect(c).not.toMatch(/[O0I1]/);
    }
  });

  it("alphabet is 32 uppercase alphanumeric characters", () => {
    expect(COMPLETION_CODE_ALPHABET).toHaveLength(32);
    expect(COMPLETION_CODE_ALPHABET).toMatch(/^[A-Z2-9]+$/);
  });

  it("produces high-entropy output (many distinct codes over 1000 draws)", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i++) seen.add(generateCompletionCode());
    expect(seen.size).toBeGreaterThan(990);
  });
});
