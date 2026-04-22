import { NextResponse } from "next/server";
import { z } from "zod";

import { loadEnv } from "@/lib/env";
import { getSupabase } from "@/lib/supabase";
import { searchSerper, type SerperSearchResult } from "@/lib/serper";
import { getCached, setCached } from "@/lib/search_cache";
import { logEvent } from "@/lib/events";
import { loadCorpus } from "@/lib/corpus";
import { applyInjection, pickInjectionSlot } from "@/lib/injection";

const BodySchema = z.object({
  session_id: z.string().min(1),
  query: z.string().min(1).max(500),
  page: z.number().int().min(1).max(5),
});

const TOTAL_PAGES = 5;

function badRequest(message: string, extra?: Record<string, unknown>) {
  return NextResponse.json({ error: message, ...extra }, { status: 400 });
}

function nowMs(): number {
  return Date.now();
}

export async function POST(req: Request): Promise<Response> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return badRequest("invalid JSON body");
  }
  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) {
    return badRequest("invalid body", {
      issues: parsed.error.issues.map((i) => ({
        path: i.path.join("."),
        message: i.message,
      })),
    });
  }
  const { session_id, query, page } = parsed.data;

  const sb = getSupabase();
  const { data: session, error: sessionErr } = await sb
    .from("sessions")
    .select("session_id, condition, topic_id")
    .eq("session_id", session_id)
    .maybeSingle();

  if (sessionErr) {
    return NextResponse.json({ error: "failed to look up session" }, { status: 500 });
  }
  if (!session) {
    return NextResponse.json({ error: "unknown session" }, { status: 404 });
  }
  const sessionRow = session as {
    session_id: string;
    condition:
      | "vanilla_search"
      | "injected_search"
      | "vanilla_agent"
      | "injected_agent";
    topic_id: string;
  };

  // Stage 1: cache lookup. A miss falls through to SERPER + populate.
  let results: SerperSearchResult[] | null = null;
  try {
    results = await getCached({ query, page });
  } catch (err) {
    // Cache lookups must never take the request down. Log and continue.
    await logEvent({
      sessionId: session_id,
      t_ms: nowMs(),
      type: "api_error",
      payload: {
        where: "search_cache.get",
        message: err instanceof Error ? err.message : String(err),
      },
    }).catch(() => {});
    results = null;
  }
  if (results === null) {
    try {
      const fresh = await searchSerper({ query, page });
      results = fresh.results;
    } catch (err) {
      await logEvent({
        sessionId: session_id,
        t_ms: nowMs(),
        type: "api_error",
        payload: {
          where: "serper",
          message: err instanceof Error ? err.message : String(err),
        },
      }).catch(() => {});
      return NextResponse.json(
        { error: "search provider unavailable" },
        { status: 502 },
      );
    }
    try {
      await setCached({ query, page, raw_results: results });
    } catch (err) {
      await logEvent({
        sessionId: session_id,
        t_ms: nowMs(),
        type: "api_error",
        payload: {
          where: "search_cache.set",
          message: err instanceof Error ? err.message : String(err),
        },
      }).catch(() => {});
    }
  }

  // Stage 2: injection. Only on page 1 of injected_search with non-empty results.
  let injectedRank: number | null = null;
  if (
    sessionRow.condition === "injected_search" &&
    page === 1 &&
    results.length > 0
  ) {
    const env = loadEnv();
    const corpus = await loadCorpus();
    const topic = corpus.topics.find((t) => t.topic_id === sessionRow.topic_id);
    const mal = topic?.malicious_source;
    if (!mal || !mal.url_slug) {
      await logEvent({
        sessionId: session_id,
        t_ms: nowMs(),
        type: "injection_skipped",
        payload: {
          topic_id: sessionRow.topic_id,
          reason: "no_malicious_source",
        },
      }).catch(() => {});
    } else {
      try {
        const slot = pickInjectionSlot(
          session_id,
          query,
          env.INJECT_SECRET,
          results.length,
        );
        results = applyInjection(
          results,
          {
            title: mal.title,
            url: `/ext/${sessionRow.topic_id}/${mal.url_slug}`,
            displayed_url: mal.displayed_url,
            snippet: mal.snippet,
          },
          slot,
        );
        injectedRank = slot;
      } catch (err) {
        await logEvent({
          sessionId: session_id,
          t_ms: nowMs(),
          type: "injection_skipped",
          payload: {
            topic_id: sessionRow.topic_id,
            reason: "apply_failed",
            message: err instanceof Error ? err.message : String(err),
          },
        }).catch(() => {});
      }
    }
  }

  await logEvent({
    sessionId: session_id,
    t_ms: nowMs(),
    type: "search_results_served",
    payload: {
      query,
      page,
      injected_rank: injectedRank,
      result_urls: results.map((r) => r.url),
    },
  }).catch(() => {});

  const adminHeader = req.headers.get("x-admin-token");
  const env = loadEnv();
  const adminPreview =
    adminHeader !== null && adminHeader === env.ADMIN_TOKEN;

  const body: {
    results: SerperSearchResult[];
    total_pages: number;
    injected_rank?: number;
  } = {
    results,
    total_pages: TOTAL_PAGES,
  };
  if (adminPreview && injectedRank !== null) {
    body.injected_rank = injectedRank;
  }
  return NextResponse.json(body);
}
