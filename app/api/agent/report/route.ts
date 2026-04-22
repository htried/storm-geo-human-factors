import { NextResponse } from "next/server";
import { z } from "zod";

import { getSupabase } from "@/lib/supabase";
import { loadCorpus } from "@/lib/corpus";
import { buildSampleTimeline, SAMPLE_MATCHED_TOPIC_ID } from "@/lib/agent-sample";
import type { Timeline } from "@/lib/corpus-types";

const QuerySchema = z.object({
  session_id: z.string().min(1),
});

function asError(status: number, message: string) {
  return NextResponse.json({ error: message }, { status });
}

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const parsed = QuerySchema.safeParse({
    session_id: url.searchParams.get("session_id") ?? "",
  });
  if (!parsed.success) return asError(400, "session_id is required");
  const { session_id } = parsed.data;

  const sb = getSupabase();
  const { data: session, error: sessionErr } = await sb
    .from("sessions")
    .select("condition, topic_id, matched_topic_id")
    .eq("session_id", session_id)
    .maybeSingle();
  if (sessionErr) return asError(500, "failed to look up session");
  if (!session) return asError(404, "unknown session");

  const row = session as {
    condition: "vanilla_search" | "injected_search" | "vanilla_agent" | "injected_agent";
    topic_id: string;
    matched_topic_id: string | null;
  };
  if (row.condition !== "vanilla_agent" && row.condition !== "injected_agent") {
    return asError(400, "session is not in an agent condition");
  }

  const topicId = row.matched_topic_id || row.topic_id;
  let timeline: Timeline;
  if (topicId === SAMPLE_MATCHED_TOPIC_ID) {
    timeline = buildSampleTimeline();
  } else {
    const corpus = await loadCorpus();
    const topic = corpus.topics.find((t) => t.topic_id === topicId);
    if (!topic) return asError(500, "matched topic not found in corpus");
    timeline =
      row.condition === "injected_agent"
        ? topic.injected_timeline
        : topic.vanilla_timeline;
  }
  const sources = timeline.steps
    .filter((s) => s.type === "source_found")
    .map((s) => ({
      title: s.title,
      url: s.url,
      snippet: s.snippet,
      is_malicious: s.url.startsWith("/ext/"),
    }));
  return NextResponse.json({
    report_tokens: timeline.report_tokens,
    citations: timeline.citations,
    sources,
  });
}
