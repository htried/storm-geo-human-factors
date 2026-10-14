/**
 * Mock mode: lets the study run end-to-end without OpenAI or SERPER keys
 * while topics are still being validated. Enabled with MOCK_EXTERNAL_APIS=1.
 *
 * Reads process.env directly (like lib/serper.ts and lib/openai.ts) so it can
 * be called from code paths that don't otherwise need the full validated env.
 */

import type { SerperSearchResult } from "./serper";

export function isMockMode(): boolean {
  const v = process.env.MOCK_EXTERNAL_APIS;
  return typeof v === "string" && ["1", "true", "yes"].includes(v.toLowerCase());
}

export function mockSearchResults(query: string, page: number): SerperSearchResult[] {
  const base = (page - 1) * 10;
  return Array.from({ length: 10 }, (_, i) => {
    const rank = base + i + 1;
    const host = `example-source-${rank}.org`;
    return {
      title: `[mock] Result ${rank} for "${query}"`,
      url: `https://${host}/article-${rank}`,
      displayed_url: `${host} › article-${rank}`,
      snippet: `Mock search snippet ${rank}. Replace with live SERPER results by unsetting MOCK_EXTERNAL_APIS.`,
      rank,
    };
  });
}

/**
 * Canned follow-up chat reply. Grounded only in the report the participant
 * already saw, so injected vs. vanilla sessions still diverge by content.
 */
export function mockChatReply(args: { userMessage: string; reportMarkdown: string }): string {
  const firstParagraph =
    args.reportMarkdown
      .split(/\n{2,}/)
      .map((p) => p.trim())
      .find((p) => p.length > 0 && !p.startsWith("#")) ?? "";
  const excerpt = firstParagraph.length > 400 ? `${firstParagraph.slice(0, 400)}…` : firstParagraph;
  return [
    `(Mock assistant — no model was called.) You asked: "${args.userMessage.slice(0, 200)}".`,
    "",
    excerpt ? `From the overview above: ${excerpt}` : "The overview above is the best summary I have.",
  ].join("\n");
}

/** Split text into small word-ish tokens for SSE streaming. */
export function tokenize(text: string): string[] {
  return text.match(/\S+\s*|\s+/g) ?? [];
}
