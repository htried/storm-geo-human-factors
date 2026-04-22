"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { z } from "zod";

import type { EventLogger } from "../_hooks/useEventLogger";
import { AgentActivity, type AgentStep } from "./AgentActivity";
import { AgentReport } from "./AgentReport";

const StartResponseSchema = z.object({
  stream_url: z.string().min(1),
  matched_topic_id: z.string().min(1),
  expected_duration_ms: z.number().int().positive(),
});

const ReportResponseSchema = z.object({
  report_tokens: z.array(z.string()),
  citations: z.array(z.object({ n: z.number(), url: z.string(), title: z.string() })),
});

type StreamState = "idle" | "starting" | "streaming" | "done" | "error";

export function AgentView(props: {
  sessionId: string;
  topicText: string;
  logger: EventLogger;
  disabled?: boolean;
  onComplete: () => void | Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const [steps, setSteps] = useState<AgentStep[]>([]);
  const [report, setReport] = useState("");
  const [citations, setCitations] = useState<Array<{ n: number; url: string; title: string }>>(
    [],
  );
  const [state, setState] = useState<StreamState>("idle");
  const [err, setErr] = useState<string | null>(null);
  const readerAbort = useRef<AbortController | null>(null);

  const canStart = query.trim().length > 0 && !props.disabled && state !== "streaming";
  const streamDone = state === "done";

  const parseSseChunk = useCallback((chunk: string) => {
    const lines = chunk.split("\n");
    let event = "message";
    let data = "";
    for (const line of lines) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      if (line.startsWith("data:")) data += line.slice(5).trim();
    }
    if (!data) return null;
    try {
      return { event, data: JSON.parse(data) as Record<string, unknown> };
    } catch {
      return null;
    }
  }, []);

  const consumeStream = useCallback(
    async (streamUrl: string) => {
      readerAbort.current?.abort();
      const ac = new AbortController();
      readerAbort.current = ac;

      const res = await fetch(streamUrl, { signal: ac.signal });
      if (!res.ok || !res.body) {
        throw new Error(`agent stream failed (${res.status})`);
      }
      const decoder = new TextDecoder();
      const reader = res.body.getReader();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const chunks = buf.split("\n\n");
        buf = chunks.pop() ?? "";
        for (const chunk of chunks) {
          const parsed = parseSseChunk(chunk);
          if (!parsed) continue;
          if (parsed.event === "step" && parsed.data.step) {
            setSteps((prev) => [...prev, parsed.data.step as AgentStep]);
          } else if (parsed.event === "token" && typeof parsed.data.token === "string") {
            setReport((prev) => prev + parsed.data.token);
          } else if (parsed.event === "done") {
            setState("done");
          }
        }
      }
    },
    [parseSseChunk],
  );

  const onStart = useCallback(async () => {
    const q = query.trim();
    if (!q) return;
    setErr(null);
    setState("starting");
    setSteps([]);
    setReport("");
    setCitations([]);
    props.logger.log("agent_started", { query: q });
    try {
      const startRes = await fetch("/api/agent/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ session_id: props.sessionId, query: q }),
      });
      const startRaw: unknown = await startRes.json().catch(() => ({}));
      if (!startRes.ok) {
        const e = (startRaw as { error?: string }).error ?? `agent start failed (${startRes.status})`;
        throw new Error(e);
      }
      const startParsed = StartResponseSchema.safeParse(startRaw);
      if (!startParsed.success) {
        throw new Error("agent start response malformed");
      }
      setState("streaming");
      await consumeStream(startParsed.data.stream_url);
    } catch (e) {
      setState("error");
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, [consumeStream, props.logger, props.sessionId, query]);

  const onSkip = useCallback(async () => {
    setErr(null);
    try {
      await fetch("/api/agent/skip", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ session_id: props.sessionId }),
      });
      readerAbort.current?.abort();
      const reportRes = await fetch(
        `/api/agent/report?session_id=${encodeURIComponent(props.sessionId)}`,
      );
      const raw: unknown = await reportRes.json().catch(() => ({}));
      if (!reportRes.ok) {
        throw new Error(
          (raw as { error?: string }).error ?? `report fetch failed (${reportRes.status})`,
        );
      }
      const parsed = ReportResponseSchema.safeParse(raw);
      if (!parsed.success) throw new Error("report payload malformed");
      setReport(parsed.data.report_tokens.join(""));
      setCitations(parsed.data.citations);
      setState("done");
      props.logger.log("agent_skip_used", {});
    } catch (e) {
      setState("error");
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, [props.logger, props.sessionId]);

  const statusText = useMemo(() => {
    if (state === "starting") return "Starting simulation…";
    if (state === "streaming") return "Streaming agent output…";
    if (state === "done") return "Simulation complete.";
    if (state === "error") return "Simulation failed.";
    return "Ready.";
  }, [state]);

  return (
    <section data-testid="agent-view" className="space-y-5">
      <header className="space-y-2">
        <h2 className="text-xl font-semibold">Agent research simulation</h2>
        <div className="rounded border border-gray-200 bg-gray-50 p-3 text-sm">
          {props.topicText}
        </div>
      </header>

      <div className="flex gap-2">
        <input
          data-testid="agent-query-input"
          className="flex-1 rounded border border-gray-300 px-3 py-2"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Ask the agent to investigate..."
          disabled={props.disabled || state === "streaming"}
        />
        <button
          data-testid="agent-start"
          type="button"
          className="rounded bg-black px-4 py-2 text-white disabled:bg-gray-400"
          disabled={!canStart}
          onClick={() => void onStart()}
        >
          Start
        </button>
        <button
          data-testid="agent-skip"
          type="button"
          className="rounded border border-gray-300 px-4 py-2 text-sm disabled:text-gray-400"
          disabled={props.disabled || state === "idle" || state === "done"}
          onClick={() => void onSkip()}
        >
          Skip simulation
        </button>
      </div>

      <p className="text-sm text-gray-600" data-testid="agent-status">
        {statusText}
      </p>
      {err && (
        <p data-testid="agent-error" className="text-sm text-red-700">
          {err}
        </p>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <AgentActivity steps={steps} />
        <AgentReport text={report} citations={citations} />
      </div>

      <footer className="border-t border-gray-200 pt-4">
        <button
          type="button"
          className="rounded bg-black px-4 py-2 text-white hover:bg-gray-800 disabled:bg-gray-400"
          disabled={props.disabled || !streamDone}
          onClick={() => void props.onComplete()}
          data-testid="condition-finish"
        >
          I&apos;m done — finish
        </button>
      </footer>
    </section>
  );
}
