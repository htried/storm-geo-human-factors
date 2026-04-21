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
    }
  | { source: typeof IFRAME_MESSAGE_SOURCE; type: "heartbeat" }
  | { source: typeof IFRAME_MESSAGE_SOURCE; type: "resize"; height: number };

function post(msg: IframeOutboundMessage): void {
  if (typeof window === "undefined") return;
  // Target origin "*" is intentional: the parent survey platform (Qualtrics,
  // etc.) may be on a domain not known at build time. The payloads are
  // strictly non-secret (IDs + counters + heights), so this is acceptable.
  window.parent.postMessage(msg, "*");
}

export function postComplete(args: {
  participant_id: string;
  completion_code: string;
  duration_ms: number;
}): void {
  post({ source: IFRAME_MESSAGE_SOURCE, type: "study_complete", ...args });
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
