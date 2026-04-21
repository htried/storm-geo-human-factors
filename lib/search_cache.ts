import { createHash } from "node:crypto";
import { z } from "zod";

import { getSupabase } from "./supabase";
import type { SerperSearchResult } from "./serper";

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

export function cacheKey(query: string, page: number): string {
  return createHash("sha256").update(`${query}|${page}`).digest("hex");
}

const CachedResultSchema = z.object({
  title: z.string(),
  url: z.string(),
  displayed_url: z.string(),
  snippet: z.string(),
  rank: z.number().int().nonnegative(),
});

const CachedRawResultsSchema = z.array(CachedResultSchema);

export interface GetCachedArgs {
  query: string;
  page: number;
}

export async function getCached(
  args: GetCachedArgs,
): Promise<SerperSearchResult[] | null> {
  const key = cacheKey(args.query, args.page);
  const sb = getSupabase();
  const { data, error } = await sb
    .from("search_cache")
    .select("raw_results")
    .eq("cache_key", key)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  if (error) throw new Error(`search_cache select failed: ${error.message}`);
  if (!data) return null;
  const parsed = CachedRawResultsSchema.safeParse(
    (data as { raw_results?: unknown }).raw_results,
  );
  if (!parsed.success) return null;
  return parsed.data;
}

export interface SetCachedArgs {
  query: string;
  page: number;
  raw_results: SerperSearchResult[];
  ttlMs?: number;
}

export async function setCached(args: SetCachedArgs): Promise<void> {
  const ttl = args.ttlMs ?? DEFAULT_TTL_MS;
  const now = Date.now();
  const expiresAt = new Date(now + ttl).toISOString();
  const row = {
    cache_key: cacheKey(args.query, args.page),
    query: args.query,
    page: args.page,
    raw_results: args.raw_results,
    expires_at: expiresAt,
  };
  const sb = getSupabase();
  const { error } = await sb
    .from("search_cache")
    .upsert(row, { onConflict: "cache_key" });
  if (error) throw new Error(`search_cache upsert failed: ${error.message}`);
}
