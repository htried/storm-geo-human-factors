import { NextResponse } from "next/server";
import { z } from "zod";

import { getSupabase } from "@/lib/supabase";
import { embedQuery } from "@/lib/openai";
import { loadCorpus, findNearestTopic } from "@/lib/corpus";
import { getAppConfig } from "@/lib/config";
import { logEvent } from "@/lib/events";

const BodySchema = z.object({
  session_id: z.string().min(1),
  query: z.string().trim().min(1).max(2_000),
});

const AGENT_CONDITIONS = new Set(["vanilla_agent", "injected_agent"]);

function badRequest(message: string, extra?: Record<string, unknown>) {
  return NextResponse.json({ error: message, ...extra }, { status: 400 });
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
  const { session_id, query } = parsed.data;

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

  const condition = (session as { condition: string }).condition;
  if (!AGENT_CONDITIONS.has(condition)) {
    return badRequest("session is not in an agent condition");
  }

  const cfg = await getAppConfig();

  let embedding: number[];
  try {
    embedding = await embedQuery(query, cfg.embedding_model);
  } catch {
    return NextResponse.json({ error: "embedding service unavailable" }, { status: 503 });
  }

  const corpus = await loadCorpus();
  const { topic, similarity } = findNearestTopic(corpus, embedding);
  const expectedDurationMs =
    (condition === "injected_agent"
      ? topic.injected_timeline.total_duration_ms
      : topic.vanilla_timeline.total_duration_ms) ?? 30_000;

  const { error: updateErr } = await sb
    .from("sessions")
    .update({
      matched_topic_id: topic.topic_id,
      matched_similarity: similarity,
      embedding_model_used: cfg.embedding_model,
      chat_model_used: cfg.chat_model,
      chat_temperature_used: cfg.chat_temperature,
    })
    .eq("session_id", session_id);
  if (updateErr) {
    return NextResponse.json({ error: "failed to update session" }, { status: 500 });
  }

  await logEvent({
    sessionId: session_id,
    t_ms: Date.now(),
    type: "agent_topic_matched",
    payload: {
      matched_topic_id: topic.topic_id,
      similarity,
      embedding_model: cfg.embedding_model,
    },
  }).catch(() => {});

  const stream_url = `/api/agent/stream?session_id=${encodeURIComponent(session_id)}`;
  return NextResponse.json({
    stream_url,
    matched_topic_id: topic.topic_id,
    expected_duration_ms: expectedDurationMs,
  });
}
