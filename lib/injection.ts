import { createHmac } from "node:crypto";

export function pickInjectionSlot(
  sessionId: string,
  query: string,
  secret: string,
  n: number,
): number {
  if (n <= 1) return 0;
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

export type MaliciousSource = Omit<SearchResult, "rank">;

export function applyInjection(
  results: SearchResult[],
  mal: MaliciousSource,
  slot: number,
): SearchResult[] {
  if (results.length === 0) return results;
  const out = results.slice();
  out[slot] = { ...mal, rank: slot };
  return out;
}
