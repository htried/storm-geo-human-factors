import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { z } from "zod";

import { getSupabase } from "@/lib/supabase";
import { embedQuery } from "@/lib/openai";
import { loadCorpus, findNearestTopic, cosine } from "@/lib/corpus";
import { getAppConfig } from "@/lib/config";
import { logEvent } from "@/lib/events";
import {
  buildSampleTimeline,
  isSampleTriggerQuery,
  SAMPLE_MATCHED_TOPIC_ID,
} from "@/lib/agent-sample";

const BodySchema = z.object({
  session_id: z.string().min(1),
  query: z.string().trim().min(1).max(2_000),
});

const AGENT_CONDITIONS = new Set(["vanilla_agent", "injected_agent"]);

function badRequest(message: string, extra?: Record<string, unknown>) {
  return NextResponse.json({ error: message, ...extra }, { status: 400 });
}

function getTimingFactor(seed: string): number {
  if (process.env.NODE_ENV === "test") return 1;
  const digest = createHash("sha256").update(seed).digest();
  const ratio = digest[0]! / 255;
  return 0.8 + ratio * 0.4;
}

function queryKeywords(q: string): string[] {
  return q
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 4);
}

function keywordCoverageScore(query: string, corpusText: string): number {
  const keys = queryKeywords(query);
  if (keys.length === 0) return 0;
  const hay = corpusText.toLowerCase();
  let hits = 0;
  for (const k of keys) {
    if (hay.includes(k)) hits++;
  }
  return hits / keys.length;
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

  if (isSampleTriggerQuery(query)) {
    const sampleTimeline = buildSampleTimeline();
    const expectedDurationMs = sampleTimeline.total_duration_ms ?? 4_000;
    const timingFactor = getTimingFactor(
      `${session_id}:${SAMPLE_MATCHED_TOPIC_ID}:${condition}`,
    );
    const adjustedDurationMs = Math.max(
      1_500,
      Math.round(expectedDurationMs * timingFactor),
    );
    const { error: sampleUpdateErr } = await sb
      .from("sessions")
      .update({
        matched_topic_id: SAMPLE_MATCHED_TOPIC_ID,
        matched_similarity: 1,
        embedding_model_used: cfg.embedding_model,
        chat_model_used: cfg.chat_model,
        chat_temperature_used: cfg.chat_temperature,
      })
      .eq("session_id", session_id);
    if (sampleUpdateErr) {
      return NextResponse.json({ error: "failed to update session" }, { status: 500 });
    }
    await logEvent({
      sessionId: session_id,
      t_ms: Date.now(),
      type: "agent_topic_matched",
      payload: {
        matched_topic_id: SAMPLE_MATCHED_TOPIC_ID,
        similarity: 1,
        embedding_model: cfg.embedding_model,
        sample_triggered: true,
      },
    }).catch(() => {});
    const stream_url = `/api/agent/stream?session_id=${encodeURIComponent(session_id)}`;
    return NextResponse.json({
      stream_url,
      matched_topic_id: SAMPLE_MATCHED_TOPIC_ID,
      expected_duration_ms: adjustedDurationMs,
    });
  }

  let embedding: number[];
  try {
    embedding = await embedQuery(query, cfg.embedding_model);
  } catch {
    return NextResponse.json({ error: "embedding service unavailable" }, { status: 503 });
  }

  const corpus = await loadCorpus();
  const sessionTopicId = (session as { topic_id: string }).topic_id;
  const sessionTopic = corpus.topics.find((t) => t.topic_id === sessionTopicId);
  const nearest = findNearestTopic(corpus, embedding);
  let topic = sessionTopic ?? nearest.topic;
  let similarity = sessionTopic ? 1 : nearest.similarity;
  // If multiple runs exist for one topic, semantically rank within that group.
  if (sessionTopic) {
    const groupId = sessionTopic.topic_group_id ?? sessionTopic.topic_id;
    const candidates = corpus.topics.filter(
      (t) => (t.topic_group_id ?? t.topic_id) === groupId,
    );
    if (candidates.length > 1) {
      const isInjected = condition === "injected_agent";
      let best = candidates[0]!;
      let bestScore = -Infinity;
      let bestSim = -Infinity;
      for (const c of candidates) {
        const sim = cosine(c.topic_embedding, embedding);
        const timeline = isInjected ? c.injected_timeline : c.vanilla_timeline;
        const lexical = keywordCoverageScore(query, timeline.report_tokens.join(""));
        const combined = sim + lexical;
        if (combined > bestScore) {
          best = c;
          bestScore = combined;
          bestSim = sim;
        }
      }
      topic = best;
      similarity = bestSim;
    }
  }
  const expectedDurationMs =
    (condition === "injected_agent"
      ? topic.injected_timeline.total_duration_ms
      : topic.vanilla_timeline.total_duration_ms) ?? 30_000;
  const timingFactor = getTimingFactor(`${session_id}:${topic.topic_id}:${condition}`);
  const adjustedDurationMs = Math.max(
    5_000,
    Math.round(expectedDurationMs * timingFactor),
  );

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
    expected_duration_ms: adjustedDurationMs,
  });
}
