import { NextResponse } from "next/server";
import { z } from "zod";

import { getSupabase } from "@/lib/supabase";
import { embedQuery } from "@/lib/openai";
import { loadCorpus, findNearestTopic, cosine } from "@/lib/corpus";
import { getAppConfig } from "@/lib/config";
import { logEvent } from "@/lib/events";
import { isMockMode } from "@/lib/mock";
import type { Topic } from "@/lib/corpus-types";
import { isSampleTriggerQuery, SAMPLE_MATCHED_TOPIC_ID } from "@/lib/agent-sample";

const BodySchema = z.object({
  session_id: z.string().min(1),
  query: z.string().trim().min(1).max(2_000),
});

const AGENT_CONDITIONS = new Set(["vanilla_agent", "injected_agent"]);

function badRequest(message: string, extra?: Record<string, unknown>) {
  return NextResponse.json({ error: message, ...extra }, { status: 400 });
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
  const mock = isMockMode();
  const sessionTopicId = (session as { topic_id: string }).topic_id;
  const stream_url = `/api/agent/stream?session_id=${encodeURIComponent(session_id)}`;

  // Debug shortcut for piloting: a fixed phrase plays a short, obviously-fake
  // demo report. Only honored in mock mode so it can't fire in the live study.
  if (mock && isSampleTriggerQuery(query)) {
    const { error: sampleUpdateErr } = await sb
      .from("sessions")
      .update({
        matched_topic_id: SAMPLE_MATCHED_TOPIC_ID,
        matched_similarity: 1,
        embedding_model_used: "mock",
      })
      .eq("session_id", session_id);
    if (sampleUpdateErr) {
      return NextResponse.json({ error: "failed to update session" }, { status: 500 });
    }
    await logEvent({
      sessionId: session_id,
      t_ms: Date.now(),
      type: "agent_topic_matched",
      payload: { matched_topic_id: SAMPLE_MATCHED_TOPIC_ID, similarity: 1, sample_triggered: true },
    }).catch(() => {});
    return NextResponse.json({
      stream_url,
      matched_topic_id: SAMPLE_MATCHED_TOPIC_ID,
      expected_duration_ms: 30_000,
    });
  }

  const corpus = await loadCorpus();
  const sessionTopic = corpus.topics.find((t) => t.topic_id === sessionTopicId);

  let topic: Topic;
  let similarity: number | null;
  if (mock) {
    // Mock mode: no embedding call; replay the participant's assigned topic.
    if (!sessionTopic) {
      return NextResponse.json({ error: "assigned topic not found in corpus" }, { status: 500 });
    }
    topic = sessionTopic;
    similarity = null;
  } else {
    let embedding: number[];
    try {
      embedding = await embedQuery(query, cfg.embedding_model);
    } catch {
      return NextResponse.json({ error: "embedding service unavailable" }, { status: 503 });
    }
    // The participant's assigned topic wins; fall back to the nearest topic
    // only if the assignment isn't in the corpus.
    const nearest = findNearestTopic(corpus, embedding);
    topic = sessionTopic ?? nearest.topic;
    similarity = sessionTopic ? 1 : nearest.similarity;
    // If multiple runs exist for one topic, rank them against the query
    // (embedding similarity + keyword coverage of the condition's report).
    if (sessionTopic) {
      const groupId = sessionTopic.topic_group_id ?? sessionTopic.topic_id;
      const candidates = corpus.topics.filter(
        (t) => (t.topic_group_id ?? t.topic_id) === groupId,
      );
      if (candidates.length > 1) {
        const isInjected = condition === "injected_agent";
        let bestScore = -Infinity;
        for (const c of candidates) {
          const sim = cosine(c.topic_embedding, embedding);
          const timeline = isInjected ? c.injected_timeline : c.vanilla_timeline;
          const combined = sim + keywordCoverageScore(query, timeline.report_tokens.join(""));
          if (combined > bestScore) {
            bestScore = combined;
            topic = c;
            similarity = sim;
          }
        }
      }
    }
  }
  const embeddingModelUsed = mock ? "mock" : cfg.embedding_model;
  const expectedDurationMs =
    (condition === "injected_agent"
      ? topic.injected_timeline.total_duration_ms
      : topic.vanilla_timeline.total_duration_ms) ?? 30_000;

  const { error: updateErr } = await sb
    .from("sessions")
    .update({
      matched_topic_id: topic.topic_id,
      matched_similarity: similarity,
      embedding_model_used: embeddingModelUsed,
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
      embedding_model: embeddingModelUsed,
    },
  }).catch(() => {});

  return NextResponse.json({
    stream_url,
    matched_topic_id: topic.topic_id,
    expected_duration_ms: expectedDurationMs,
  });
}
