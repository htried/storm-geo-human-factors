"use client";

import { useCallback, useEffect, useRef } from "react";

interface BufferedEvent {
  t_ms: number;
  type: string;
  payload?: Record<string, unknown>;
}

const FLUSH_INTERVAL_MS = 3_000;
const MAX_BUFFER_BEFORE_FLUSH = 20;
const MAX_BATCH = 100;

export interface EventLogger {
  log: (type: string, payload?: Record<string, unknown>) => void;
  flush: () => Promise<void>;
}

/**
 * Client-side event logger. Buffers events and batches them to `/api/events`.
 * - Flushes every 3s while the buffer is non-empty.
 * - Flushes eagerly once the buffer grows past MAX_BUFFER_BEFORE_FLUSH.
 * - Flushes on `pagehide` / visibility change via `navigator.sendBeacon` when
 *   available so events aren't lost on tab close or navigation.
 *
 * t_ms on each event is computed relative to when this hook first mounted,
 * giving a stable timeline per client session.
 */
export function useEventLogger(sessionId: string | null): EventLogger {
  const bufferRef = useRef<BufferedEvent[]>([]);
  const t0Ref = useRef<number>(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const sessionIdRef = useRef<string | null>(sessionId);

  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);

  const sendBatch = useCallback(
    async (batch: BufferedEvent[], useBeacon: boolean): Promise<void> => {
      const sid = sessionIdRef.current;
      if (!sid || batch.length === 0) return;
      const body = JSON.stringify({
        session_id: sid,
        events: batch.slice(0, MAX_BATCH),
      });

      if (useBeacon && typeof navigator !== "undefined" && navigator.sendBeacon) {
        const blob = new Blob([body], { type: "application/json" });
        navigator.sendBeacon("/api/events", blob);
        return;
      }

      try {
        await fetch("/api/events", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body,
          keepalive: true,
        });
      } catch {
        // Best-effort. Dropped events are acceptable for a research log.
      }
    },
    [],
  );

  const flushAll = useCallback(
    async (useBeacon: boolean = false): Promise<void> => {
      while (bufferRef.current.length > 0) {
        const chunk = bufferRef.current.splice(0, MAX_BATCH);
        await sendBatch(chunk, useBeacon);
      }
    },
    [sendBatch],
  );

  useEffect(() => {
    t0Ref.current = performance.now();
    timerRef.current = setInterval(() => {
      if (bufferRef.current.length > 0) void flushAll(false);
    }, FLUSH_INTERVAL_MS);

    const onHide = () => {
      void flushAll(true);
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") onHide();
    };

    window.addEventListener("pagehide", onHide);
    window.addEventListener("beforeunload", onHide);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      window.removeEventListener("pagehide", onHide);
      window.removeEventListener("beforeunload", onHide);
      document.removeEventListener("visibilitychange", onVisibility);
      void flushAll(true);
    };
  }, [flushAll]);

  const log = useCallback(
    (type: string, payload?: Record<string, unknown>): void => {
      const t_ms = Math.max(0, Math.round(performance.now() - t0Ref.current));
      bufferRef.current.push({ t_ms, type, payload });
      if (bufferRef.current.length >= MAX_BUFFER_BEFORE_FLUSH) {
        void flushAll(false);
      }
    },
    [flushAll],
  );

  const flush = useCallback(async () => {
    await flushAll(false);
  }, [flushAll]);

  return { log, flush };
}
