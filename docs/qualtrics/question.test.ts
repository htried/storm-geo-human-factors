import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SCRIPT = path.join(process.cwd(), "docs/qualtrics/question.js");

/**
 * Mimic Qualtrics: resolve piped text, then blank every other "${...}" (up to
 * the next "}"), wherever it appears, including inside code and comments.
 */
export function qualtricsRewrite(src: string, answer = "50"): string {
  return src
    .replace(/\$\{q:\/\/QID\d+\/ChoiceNumericEntryValue\/\d+\}/g, answer)
    .replace("${e://Field/ResponseID}", "R_test")
    .replace(/\$\{[^}]*\}/g, "");
}

describe("Qualtrics question script", () => {
  it("is still valid JavaScript after Qualtrics' piped-text rewrite", () => {
    const rewritten = qualtricsRewrite(fs.readFileSync(SCRIPT, "utf8"));
    // Parse only (Function compiles without running the body).
    expect(() => new Function(rewritten)).not.toThrow();
  });

  it("only uses ${...} for real piped text", () => {
    const src = fs.readFileSync(SCRIPT, "utf8");
    const stray = (src.match(/\$\{[^}]*\}?/g) ?? []).filter(
      (m) => !/^\$\{q:\/\/QID\d+\/ChoiceNumericEntryValue\/\d+\}$/.test(m) && m !== "${e://Field/ResponseID}",
    );
    expect(stray).toEqual([]);
  });

  it("maps 19 topics to distinct slider QIDs", () => {
    const src = fs.readFileSync(SCRIPT, "utf8");
    const rows = [...src.matchAll(/\{ id: "([a-z_]+)", view: "\$\{q:\/\/(QID\d+)\//g)];
    expect(rows).toHaveLength(19);
    expect(new Set(rows.map((r) => r[1])).size).toBe(19);
    expect(new Set(rows.map((r) => r[2])).size).toBe(19);
  });
});
