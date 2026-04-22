import { getSupabase } from "@/lib/supabase";
import { loadCorpus } from "@/lib/corpus";
import type { Timeline } from "@/lib/corpus-types";
import { createHash } from "node:crypto";
import { buildSampleTimeline, SAMPLE_MATCHED_TOPIC_ID } from "@/lib/agent-sample";

const enc = new TextEncoder();

function sse(event: string, data: unknown): Uint8Array {
  return enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getTimingFactor(seed: string): number {
  if (process.env.NODE_ENV === "test") return 1;
  const digest = createHash("sha256").update(seed).digest();
  const ratio = digest[0]! / 255;
  return 0.8 + ratio * 0.4;
}

function applyTimingFactor(timeline: Timeline, factor: number): Timeline {
  const steps = timeline.steps.map((step) => ({
    ...step,
    t_ms: Math.max(0, Math.round(step.t_ms * factor)),
  }));
  const total_duration_ms =
    timeline.total_duration_ms === undefined
      ? undefined
      : Math.max(5_000, Math.round(timeline.total_duration_ms * factor));
  return { ...timeline, steps, total_duration_ms };
}

function pickTimeline(args: {
  timeline: Timeline;
  resumeFrom: number;
}): Timeline {
  const steps = args.timeline.steps.filter((s) => s.t_ms >= args.resumeFrom);
  return { ...args.timeline, steps };
}

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const sessionId = url.searchParams.get("session_id");
  const resumeFromRaw = url.searchParams.get("resume_from");
  const resumeFrom =
    resumeFromRaw && Number.isFinite(Number(resumeFromRaw))
      ? Math.max(0, Math.floor(Number(resumeFromRaw)))
      : 0;

  if (!sessionId) {
    return new Response(JSON.stringify({ error: "session_id is required" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  const sb = getSupabase();
  const { data: session, error: sessionErr } = await sb
    .from("sessions")
    .select("session_id, condition, topic_id, matched_topic_id")
    .eq("session_id", sessionId)
    .maybeSingle();
  if (sessionErr) {
    return new Response(JSON.stringify({ error: "failed to look up session" }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }
  if (!session) {
    return new Response(JSON.stringify({ error: "unknown session" }), {
      status: 404,
      headers: { "content-type": "application/json" },
    });
  }

  const row = session as {
    condition: "vanilla_search" | "injected_search" | "vanilla_agent" | "injected_agent";
    topic_id: string;
    matched_topic_id: string | null;
  };
  if (row.condition !== "vanilla_agent" && row.condition !== "injected_agent") {
    return new Response(JSON.stringify({ error: "session is not in agent condition" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  const topicId = row.matched_topic_id || row.topic_id;
  let base: Timeline;
  if (topicId === SAMPLE_MATCHED_TOPIC_ID) {
    base = buildSampleTimeline();
  } else {
    const corpus = await loadCorpus();
    const topic = corpus.topics.find((t) => t.topic_id === topicId);
    if (!topic) {
      return new Response(JSON.stringify({ error: "matched topic not found in corpus" }), {
        status: 500,
        headers: { "content-type": "application/json" },
      });
    }
    base =
      row.condition === "injected_agent"
        ? topic.injected_timeline
        : topic.vanilla_timeline;
  }
  const factor = getTimingFactor(`${sessionId}:${topicId}:${row.condition}`);
  const variedTimeline = applyTimingFactor(base, factor);
  const timeline = pickTimeline({ timeline: variedTimeline, resumeFrom });

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        controller.enqueue(
          sse("ready", {
            steps: timeline.steps.length,
            expected_duration_ms: timeline.total_duration_ms ?? 30_000,
          }),
        );
        let prev = resumeFrom;
        for (const step of timeline.steps) {
          if (req.signal.aborted) break;
          const delay = Math.max(0, step.t_ms - prev);
          if (delay > 0) await sleep(delay);
          controller.enqueue(sse("step", { step }));
          prev = step.t_ms;
        }

        for (const token of timeline.report_tokens) {
          if (req.signal.aborted) break;
          controller.enqueue(sse("token", { token }));
          // Keep report streaming visibly progressive, but faster than the
          // original pacing so users don't feel the UI is stalled.
          const jitter = 6 + Math.floor(Math.random() * 7);
          await sleep(jitter);
        }

        controller.enqueue(sse("done", { ok: true }));
        controller.close();
      } catch (err) {
        controller.enqueue(
          sse("error", {
            message: err instanceof Error ? err.message : String(err),
          }),
        );
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  });
}
