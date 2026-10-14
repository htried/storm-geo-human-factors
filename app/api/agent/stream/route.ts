import { getSupabase } from "@/lib/supabase";
import { loadCorpus } from "@/lib/corpus";
import type { Timeline } from "@/lib/corpus-types";
import { logEvent } from "@/lib/events";
import { parsePacingRange, planReplay } from "@/lib/replay-pacing";
import { buildSampleTimeline, SAMPLE_MATCHED_TOPIC_ID } from "@/lib/agent-sample";

// Replays are paced to AGENT_REPLAY_MS (default 25-35s); keep headroom so
// Vercel never cuts an overview off mid-stream.
export const maxDuration = 120;

const enc = new TextEncoder();

function sse(event: string, data: unknown): Uint8Array {
  return enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
  const timeline = pickTimeline({ timeline: base, resumeFrom });
  const plan = planReplay(timeline, parsePacingRange(process.env.AGENT_REPLAY_MS));

  // Record the drawn pacing so analyses can control for replay length.
  await logEvent({
    sessionId,
    t_ms: Date.now(),
    type: "agent_replay_planned",
    payload: {
      topic_id: topicId,
      total_ms: plan.totalMs,
      steps_ms: plan.stepsMs,
      report_ms: plan.reportMs,
      resume_from: resumeFrom,
    },
  }).catch(() => {});

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        controller.enqueue(
          sse("ready", {
            steps: timeline.steps.length,
            expected_duration_ms: plan.totalMs,
            citations: timeline.citations,
          }),
        );
        for (const ev of plan.events) {
          if (req.signal.aborted) break;
          if (ev.delayMs > 0) await sleep(ev.delayMs);
          controller.enqueue(
            ev.kind === "step" ? sse("step", { step: ev.step }) : sse("token", { token: ev.token }),
          );
        }

        controller.enqueue(sse("done", { ok: true, citations: timeline.citations }));
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
