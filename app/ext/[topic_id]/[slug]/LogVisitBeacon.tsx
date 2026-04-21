"use client";

import { useEffect, useRef } from "react";
import { useSearchParams } from "next/navigation";

interface Props {
  topicId: string;
  slug: string;
}

export function LogVisitBeacon(props: Props) {
  const searchParams = useSearchParams();
  const sessionId = searchParams.get("session_id");
  const firedRef = useRef(false);

  useEffect(() => {
    if (firedRef.current) return;
    if (!sessionId) return;
    firedRef.current = true;
    const payload = JSON.stringify({
      session_id: sessionId,
      events: [
        {
          t_ms: Date.now(),
          type: "malicious_source_clicked",
          payload: { topic_id: props.topicId, slug: props.slug },
        },
      ],
    });
    const blob = new Blob([payload], { type: "application/json" });
    // sendBeacon is fire-and-forget and survives a subsequent navigation away
    // if the user bounces straight back. If it's unavailable (SSR guard) or
    // refuses the payload, fall back to a keepalive fetch.
    const nav =
      typeof navigator !== "undefined" ? navigator : (undefined as unknown);
    const ok =
      nav && typeof (nav as Navigator).sendBeacon === "function"
        ? (nav as Navigator).sendBeacon("/api/events", blob)
        : false;
    if (!ok) {
      fetch("/api/events", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: payload,
        keepalive: true,
      }).catch(() => {});
    }
  }, [sessionId, props.topicId, props.slug]);

  return null;
}
