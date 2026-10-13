"use client";

import { useEffect, useRef } from "react";

export interface AgentStep {
  t_ms: number;
  type: "plan" | "expert_turn" | "search" | "source_found" | "synthesis";
  text?: string;
  role?: string;
  query?: string;
  title?: string;
  url?: string;
  snippet?: string;
}

const LABELS: Record<AgentStep["type"], string> = {
  plan: "Planning",
  search: "Searching",
  source_found: "Reading source",
  expert_turn: "Discussing",
  synthesis: "Synthesizing",
};

/** Source text sometimes carries stray HTML (e.g. `<p>`); show it as text. */
function clean(s: string | undefined): string {
  return (s ?? "").replace(/<[^>]*>/g, " ").replace(/\s{2,}/g, " ").trim();
}

function hostOf(url: string | undefined): string {
  try {
    return url ? new URL(url).host.replace(/^www\./, "") : "";
  } catch {
    return url ?? "";
  }
}

export function AgentActivity(props: {
  steps: AgentStep[];
  active: boolean;
  onSourceClick?: (url: string) => void;
}) {
  const scrollRef = useRef<HTMLOListElement>(null);
  const stickToBottom = useRef(true);

  // Follow new steps like a live log, unless the participant scrolled up to
  // read something.
  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [props.steps.length]);

  if (props.steps.length === 0 && !props.active) return null;

  return (
    <section data-testid="agent-activity" className="space-y-2">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-500">Research activity</h3>
      {/* Fixed px height (not vh): inside the survey iframe, vh tracks the
          iframe's own height, which we resize to fit content. */}
      <ol
        ref={scrollRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
        }}
        className="max-h-80 space-y-2 overflow-y-auto rounded border border-gray-200 bg-gray-50 p-2"
      >
        {props.steps.map((step, idx) => (
          <li
            key={`${idx}-${step.t_ms}-${step.type}`}
            data-testid="agent-step"
            className="rounded border border-gray-200 bg-white p-3 text-sm"
          >
            <div className="mb-1 text-xs font-medium text-gray-500">{LABELS[step.type] ?? step.type}</div>
            {step.type === "expert_turn" ? (
              <p>
                <span className="font-semibold">{clean(step.role)}: </span>
                {clean(step.text)}
              </p>
            ) : step.type === "search" ? (
              <p className="font-mono">{clean(step.query)}</p>
            ) : step.type === "source_found" ? (
              <div>
                <a
                  href={step.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium text-[#1a0dab] hover:underline"
                  onClick={() => step.url && props.onSourceClick?.(step.url)}
                >
                  {clean(step.title)}
                </a>
                <p className="text-xs text-gray-500">{hostOf(step.url)}</p>
                <p className="mt-1 text-gray-700">{clean(step.snippet)}</p>
              </div>
            ) : (
              <p className="italic">{clean(step.text)}</p>
            )}
          </li>
        ))}
        {props.active && (
          <li className="px-3 py-2 text-xs text-gray-400" aria-live="polite">
            Working…
          </li>
        )}
      </ol>
    </section>
  );
}
