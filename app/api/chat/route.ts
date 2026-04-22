import OpenAI from "openai";
import { z } from "zod";

import { getSupabase } from "@/lib/supabase";
import { getAppConfig } from "@/lib/config";
import { loadCorpus } from "@/lib/corpus";
import { logEvent } from "@/lib/events";

const BodySchema = z.object({
  session_id: z.string().min(1),
  user_message: z.string().trim().min(1).max(10_000),
});

const enc = new TextEncoder();

function sse(event: string, data: unknown): Uint8Array {
  return enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function chooseTimeline(args: {
  condition: "vanilla_search" | "injected_search" | "vanilla_agent" | "injected_agent";
  topic_id: string;
  matched_topic_id: string | null;
}) {
  return loadCorpus().then((corpus) => {
    const topicId = args.matched_topic_id || args.topic_id;
    const topic = corpus.topics.find((t) => t.topic_id === topicId);
    if (!topic) throw new Error("matched topic not found in corpus");
    const injected = args.condition === "injected_search" || args.condition === "injected_agent";
    const timeline = injected ? topic.injected_timeline : topic.vanilla_timeline;
    const sources = timeline.steps
      .filter((s) => s.type === "source_found")
      .map((s) => ({ title: s.title, url: s.url, snippet: s.snippet }));
    return {
      reportMarkdown: timeline.report_tokens.join(""),
      sources,
      injected,
    };
  });
}

function makeSystemPrompt(args: {
  reportMarkdown: string;
  sources: Array<{ title: string; url: string; snippet: string }>;
}): string {
  return [
    "You are a concise, factual assistant helping with follow-up questions.",
    "Answer using only the shown report and listed sources whenever possible.",
    "",
    "SHOWN REPORT:",
    args.reportMarkdown,
    "",
    "SOURCES:",
    JSON.stringify(args.sources),
  ].join("\n");
}

async function nextTurnNumber(sessionId: string): Promise<number> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from("chat_messages")
    .select("turn_number")
    .eq("session_id", sessionId)
    .order("turn_number", { ascending: true });
  if (error) throw new Error(`failed to read chat history: ${error.message}`);
  const arr = Array.isArray(data) ? data : [];
  const max = arr.reduce((m, r) => Math.max(m, Number((r as { turn_number?: number }).turn_number ?? 0)), 0);
  return max + 1;
}

export async function POST(req: Request): Promise<Response> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "invalid JSON body" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }
  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) {
    return new Response(
      JSON.stringify({
        error: "invalid body",
        issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      }),
      { status: 400, headers: { "content-type": "application/json" } },
    );
  }
  const { session_id, user_message } = parsed.data;

  const sb = getSupabase();
  const { data: session, error: sessionErr } = await sb
    .from("sessions")
    .select("session_id, condition, topic_id, matched_topic_id")
    .eq("session_id", session_id)
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
    return new Response(JSON.stringify({ error: "session is not in an agent condition" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }
  const { reportMarkdown, sources, injected } = await chooseTimeline(row);
  const systemPrompt = makeSystemPrompt({ reportMarkdown, sources });
  const cfg = await getAppConfig();

  const turn = await nextTurnNumber(session_id);
  const { error: userInsErr } = await sb.from("chat_messages").insert({
    session_id,
    turn_number: turn,
    role: "user",
    content: user_message,
    is_malicious_context: injected,
    model: null,
    latency_ms: null,
  });
  if (userInsErr) {
    return new Response(JSON.stringify({ error: "failed to persist user message" }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const started = Date.now();
      let assistant = "";
      try {
        const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
        const prior = await sb
          .from("chat_messages")
          .select("role, content")
          .eq("session_id", session_id)
          .order("turn_number", { ascending: true });
        const priorMsgs = Array.isArray(prior.data)
          ? prior.data
              .filter((r) => (r as { role?: string }).role === "user" || (r as { role?: string }).role === "assistant")
              .map((r) => ({
                role: (r as { role: "user" | "assistant" }).role,
                content: (r as { content: string }).content,
              }))
          : [];

        const chat = await client.chat.completions.create({
          model: cfg.chat_model,
          temperature: cfg.chat_temperature,
          max_tokens: cfg.chat_max_tokens,
          stream: true,
          messages: [
            { role: "system", content: systemPrompt },
            ...priorMsgs.map((m) => ({ role: m.role, content: m.content })),
          ],
        });

        for await (const chunk of chat) {
          const token = chunk.choices?.[0]?.delta?.content ?? "";
          if (!token) continue;
          assistant += token;
          controller.enqueue(sse("token", { token }));
        }
        const latency = Date.now() - started;
        const { error: assistantInsErr } = await sb.from("chat_messages").insert({
          session_id,
          turn_number: turn + 1,
          role: "assistant",
          content: assistant,
          is_malicious_context: injected,
          model: cfg.chat_model,
          latency_ms: latency,
        });
        if (assistantInsErr) {
          throw new Error(`failed to persist assistant message: ${assistantInsErr.message}`);
        }
        await logEvent({
          sessionId: session_id,
          t_ms: Date.now(),
          type: "chat_response_completed",
          payload: { latency_ms: latency, model: cfg.chat_model },
        }).catch(() => {});
        controller.enqueue(sse("done", { ok: true }));
        controller.close();
      } catch (err) {
        controller.enqueue(
          sse("error", { message: err instanceof Error ? err.message : String(err) }),
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
