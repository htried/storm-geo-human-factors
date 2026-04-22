"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";

import type { EventLogger } from "../_hooks/useEventLogger";
import { AgentActivity, type AgentStep } from "./AgentActivity";
import { AgentReport } from "./AgentReport";
import { ChatPanel } from "./ChatPanel";

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
  const [expectedDurationMs, setExpectedDurationMs] = useState<number | null>(null);
  const [startedAtMs, setStartedAtMs] = useState<number | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
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

  const loadFinalReport = useCallback(async () => {
    const res = await fetch(`/api/agent/report?session_id=${encodeURIComponent(props.sessionId)}`);
    const raw: unknown = await res.json().catch(() => ({}));
    if (!res.ok) return;
    const parsed = ReportResponseSchema.safeParse(raw);
    if (!parsed.success) return;
    setReport(parsed.data.report_tokens.join(""));
    setCitations(parsed.data.citations);
  }, [props.sessionId]);

  const onStart = useCallback(async () => {
    const q = query.trim();
    if (!q) return;
    setErr(null);
    setState("starting");
    setSteps([]);
    setReport("");
    setCitations([]);
    setExpectedDurationMs(null);
    setStartedAtMs(Date.now());
    setElapsedMs(0);
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
      setExpectedDurationMs(startParsed.data.expected_duration_ms);
      setState("streaming");
      await consumeStream(startParsed.data.stream_url);
      await loadFinalReport();
      setState("done");
    } catch (e) {
      setState("error");
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, [consumeStream, loadFinalReport, props.logger, props.sessionId, query]);

  useEffect(() => {
    if ((state !== "starting" && state !== "streaming") || startedAtMs === null) return;
    const id = setInterval(() => {
      setElapsedMs(Date.now() - startedAtMs);
    }, 120);
    return () => clearInterval(id);
  }, [startedAtMs, state]);

  const progressPercent = useMemo(() => {
    if (expectedDurationMs === null || expectedDurationMs <= 0) {
      return state === "streaming" || state === "starting" ? 20 : 0;
    }
    return Math.max(0, Math.min(100, (elapsedMs / expectedDurationMs) * 100));
  }, [elapsedMs, expectedDurationMs, state]);
  const isFinalizing = (state === "starting" || state === "streaming") && progressPercent >= 95;

  const statusText = useMemo(() => {
    if (state === "starting") return "Starting search…";
    if (state === "streaming") return "Streaming agent output…";
    if (state === "done") return "Search complete.";
    if (state === "error") return "Search failed.";
    return "Ready.";
  }, [state]);

  return (
    <section data-testid="agent-view" className="space-y-5">
      <header className="space-y-2">
        <h2 className="text-xl font-semibold">Deep research agent</h2>
        <div className="rounded border border-gray-200 bg-gray-50 p-3 text-sm text-gray-900 dark:border-gray-700 dark:bg-gray-900/60 dark:text-gray-100">
          {props.topicText}
        </div>
      </header>

      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void onStart();
        }}
      >
        <input
          data-testid="agent-query-input"
          className="flex-1 rounded border border-gray-300 bg-white px-3 py-2 text-gray-900 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Ask the agent to investigate..."
          disabled={props.disabled || state === "streaming"}
        />
        <button
          data-testid="agent-start"
          type="submit"
          className="rounded bg-blue-700 px-4 py-2 text-white disabled:bg-gray-400 dark:bg-blue-600"
          disabled={!canStart}
        >
          Start
        </button>
      </form>

      <p className="text-sm text-gray-600 dark:text-gray-300" data-testid="agent-status">
        {statusText}
      </p>
      {expectedDurationMs !== null && (
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Estimated runtime: ~{(expectedDurationMs / 1000)}s
        </p>
      )}
      {(state === "starting" || state === "streaming") && (
        <section className="space-y-2 rounded border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-900/60">
          <div className="h-2 w-full overflow-hidden rounded bg-gray-200 dark:bg-gray-700">
            <div
              className={
                isFinalizing
                  ? "h-full rounded bg-[linear-gradient(90deg,#2563eb_0%,#60a5fa_25%,#bfdbfe_50%,#60a5fa_75%,#2563eb_100%)] bg-[length:200%_100%] animate-progress-shimmer dark:bg-[linear-gradient(90deg,#3b82f6_0%,#93c5fd_25%,#dbeafe_50%,#93c5fd_75%,#3b82f6_100%)]"
                  : "h-full rounded bg-blue-600 transition-[width] duration-150 dark:bg-blue-500"
              }
              style={{ width: `${progressPercent}%` }}
              aria-hidden="true"
            />
          </div>
          <p className="text-xs text-gray-600 dark:text-gray-300">
            {isFinalizing ? "Finalizing report" : "Agent is working"}
            <span className="ml-1 inline-block animate-pulse">...</span>{" "}
            {elapsedMs > 0 ? `(${(elapsedMs / 1000).toFixed(1)}s elapsed)` : ""}
          </p>
        </section>
      )}
      {err && (
        <p data-testid="agent-error" className="text-sm text-red-700 dark:text-red-300">
          {err}
        </p>
      )}

      <AgentActivity steps={steps} />
      <AgentReport
        text={report}
        citations={citations}
        streaming={state === "starting" || state === "streaming"}
      />

      {streamDone && <ChatPanel sessionId={props.sessionId} />}

      <footer className="border-t border-gray-200 pt-4 dark:border-gray-700">
        <button
          type="button"
          className="rounded bg-blue-700 px-4 py-2 text-white hover:bg-blue-600 disabled:bg-gray-400 dark:bg-blue-600 dark:hover:bg-blue-500"
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
