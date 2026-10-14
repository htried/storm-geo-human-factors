"use client";

import { useEffect, useRef } from "react";

export const IFRAME_MESSAGE_SOURCE = "storm-study";

export type IframeOutboundMessage =
  | {
      source: typeof IFRAME_MESSAGE_SOURCE;
      type: "study_complete";
      participant_id: string;
      completion_code: string;
      duration_ms: number;
      topic_id: string;
    }
  | {
      source: typeof IFRAME_MESSAGE_SOURCE;
      type: "study_ineligible";
      participant_id: string;
      reason: string;
    }
  | { source: typeof IFRAME_MESSAGE_SOURCE; type: "heartbeat" }
  | { source: typeof IFRAME_MESSAGE_SOURCE; type: "resize"; height: number };

/**
 * Module-level parent-origin state. Set by `setParentOrigin` (called from
 * `StudyClient` once the URL `parent_origin` search param is read). If a
 * valid absolute-origin string is set, every postMessage targets it
 * explicitly; otherwise we fall back to "*" (documented below).
 *
 * We keep this at module scope rather than passing it through every postX
 * call so that existing call sites (and future ones) don't have to thread
 * an origin argument through their APIs. There's exactly one study frame
 * per browsing context, so sharing module state is safe.
 */
let parentOrigin: string = "*";

/**
 * Register the expected parent origin. Accepts only absolute origins (e.g.
 * "https://surveys.example.com"). Anything else, or an explicit "*", leaves
 * the target origin as the permissive "*".
 *
 * Why permissive by default: survey platforms (Qualtrics et al.) don't
 * publish a fixed origin, and the study must still run when embedded in an
 * unknown parent. The production defense against hostile embedders is the
 * CSP `frame-ancestors` header set in middleware (Phase 7+), which prevents
 * hostile parents from loading /study in the first place. When the embedder
 * does know its origin (it can pass it as a query param), using it here
 * adds a belt-and-braces guard against leaking completion_code to other
 * frames in the same browsing context.
 */
export function setParentOrigin(origin: string | null | undefined): void {
  if (!origin) {
    parentOrigin = "*";
    return;
  }
  try {
    const u = new URL(origin);
    // Origin is protocol + "//" + host (+ optional port). new URL normalizes
    // that, so `u.origin` is the canonical form.
    parentOrigin = u.origin;
  } catch {
    parentOrigin = "*";
  }
}

/** Test/debug helper. Not part of the stable API. */
export function __getParentOriginForTest(): string {
  return parentOrigin;
}

function post(msg: IframeOutboundMessage): void {
  if (typeof window === "undefined") return;
  window.parent.postMessage(msg, parentOrigin);
}

export function postComplete(args: {
  participant_id: string;
  completion_code: string;
  duration_ms: number;
  topic_id: string;
}): void {
  post({ source: IFRAME_MESSAGE_SOURCE, type: "study_complete", ...args });
}

export function postIneligible(args: { participant_id: string; reason: string }): void {
  post({ source: IFRAME_MESSAGE_SOURCE, type: "study_ineligible", ...args });
}

export function postHeartbeat(): void {
  post({ source: IFRAME_MESSAGE_SOURCE, type: "heartbeat" });
}

export function postResize(height: number): void {
  post({ source: IFRAME_MESSAGE_SOURCE, type: "resize", height });
}

const HEARTBEAT_INTERVAL_MS = 30_000;

export function useHeartbeat(enabled: boolean = true): void {
  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(postHeartbeat, HEARTBEAT_INTERVAL_MS);
    return () => clearInterval(id);
  }, [enabled]);
}

/**
 * Watches an element's content height and posts a `resize` message to the
 * parent frame whenever it changes. Caller wires this to the root study
 * container element via a ref.
 */
export function useResizeObserver(
  ref: React.RefObject<HTMLElement | null>,
): void {
  const lastHeight = useRef<number>(-1);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const el = ref.current;
    if (!el) return;

    const emit = () => {
      const h = Math.ceil(el.getBoundingClientRect().height);
      if (h !== lastHeight.current) {
        lastHeight.current = h;
        postResize(h);
      }
    };

    emit();

    const ro = new ResizeObserver(() => emit());
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
}
