import { createHmac } from "node:crypto";

export function pickInjectionSlot(
  sessionId: string,
  query: string,
  secret: string,
  n: number,
): number {
  if (n <= 0) throw new Error(`pickInjectionSlot: n must be >= 1 (got ${n})`);
  if (n === 1) return 0;
  const hmac = createHmac("sha256", secret)
    .update(`${sessionId}|${query}`)
    .digest();
  return hmac.readUInt32BE(0) % n;
}

export interface SearchResult {
  title: string;
  url: string;
  displayed_url: string;
  snippet: string;
  rank: number;
}

// Renamed from `MaliciousSource` to avoid collision with the corpus schema's
// `MaliciousSource` (which has url_slug + landing_markdown). This type is the
// SERP-row shape (url already resolved) used at the moment of injection.
export type InjectedResult = Omit<SearchResult, "rank">;

export function applyInjection(
  results: SearchResult[],
  injected: InjectedResult,
  slot: number,
): SearchResult[] {
  if (results.length === 0) return results;
  if (slot < 0 || slot >= results.length) {
    throw new Error(
      `applyInjection: slot ${slot} out of range for results of length ${results.length}`,
    );
  }
  const out = results.slice();
  out[slot] = { ...injected, rank: slot };
  return out;
}
