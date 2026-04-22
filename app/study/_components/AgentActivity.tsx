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

export function AgentActivity(props: { steps: AgentStep[] }) {
  const listRef = useRef<HTMLOListElement | null>(null);
  const stickToBottomRef = useRef(true);

  function handleScroll() {
    const el = listRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickToBottomRef.current = distanceFromBottom < 24;
  }

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    if (!stickToBottomRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [props.steps]);

  return (
    <section
      data-testid="agent-activity"
      className="space-y-3 rounded border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-900"
    >
      <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
        Agent activity
      </h3>
      <ol
        ref={listRef}
        onScroll={handleScroll}
        className="max-h-80 space-y-2 overflow-y-auto pr-1"
      >
        {props.steps.map((step, idx) => (
          <details
            key={`${idx}-${step.t_ms}-${step.type}`}
            data-testid="agent-step"
            className="rounded border border-gray-200 bg-white p-3 text-sm dark:border-gray-700 dark:bg-gray-800"
          >
            <summary className="cursor-pointer list-none">
              <div className="flex items-center justify-between gap-3">
                <span className="font-medium text-gray-900 dark:text-gray-100">
                  Step {idx + 1}: {step.type}
                </span>
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  {step.t_ms}ms
                </span>
              </div>
            </summary>
            <div className="mt-2">
              {step.type === "expert_turn" ? (
                <p className="text-gray-800 dark:text-gray-200">
                  <span className="font-semibold">{step.role}: </span>
                  {step.text}
                </p>
              ) : step.type === "search" ? (
                <p className="font-mono text-gray-800 dark:text-gray-200">Searching: {step.query}</p>
              ) : step.type === "source_found" ? (
                <div className="space-y-1">
                  <p className="font-medium text-gray-900 dark:text-gray-100">{step.title}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">{step.url}</p>
                  <p className="text-gray-800 dark:text-gray-200">{step.snippet}</p>
                </div>
              ) : (
                <p className="italic text-gray-800 dark:text-gray-200">{step.text}</p>
              )}
            </div>
          </details>
        ))}
      </ol>
    </section>
  );
}
