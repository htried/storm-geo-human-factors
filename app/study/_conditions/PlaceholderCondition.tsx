"use client";

import type { EventLogger } from "../_hooks/useEventLogger";

export interface ConditionProps {
  sessionId: string;
  topicId: string;
  topicText: string;
  logger: EventLogger;
  onComplete: () => void | Promise<void>;
}

export function PlaceholderCondition(
  props: ConditionProps & { conditionLabel: string },
) {
  return (
    <section className="space-y-4">
      <header>
        <h2 className="text-xl font-semibold">{props.conditionLabel}</h2>
        <p className="text-sm text-gray-600">
          Session <code className="font-mono">{props.sessionId}</code>
        </p>
      </header>

      <div className="rounded-md border border-gray-200 p-4">
        <p className="text-sm uppercase tracking-wide text-gray-500">
          Topic ({props.topicId})
        </p>
        <p className="mt-2">{props.topicText}</p>
      </div>

      <p className="text-sm text-amber-700">
        This condition UI is a placeholder. The full interaction arrives in
        phases 4 (search) and 5 (agent).
      </p>

      <button
        type="button"
        className="rounded bg-black px-4 py-2 text-white hover:bg-gray-800"
        onClick={() => {
          props.logger.log("condition_placeholder_done", {
            condition: props.conditionLabel,
          });
          void props.onComplete();
        }}
      >
        Finish (placeholder)
      </button>
    </section>
  );
}
