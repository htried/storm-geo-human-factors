"use client";

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
  return (
    <section data-testid="agent-activity" className="space-y-3">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
        Agent activity
      </h3>
      <ol className="space-y-2">
        {props.steps.map((step, idx) => (
          <li
            key={`${idx}-${step.t_ms}-${step.type}`}
            data-testid="agent-step"
            className="rounded border border-gray-200 bg-white p-3 text-sm"
          >
            <div className="mb-1 text-xs text-gray-500">
              {step.type} @ {step.t_ms}ms
            </div>
            {step.type === "expert_turn" ? (
              <p>
                <span className="font-semibold">{step.role}: </span>
                {step.text}
              </p>
            ) : step.type === "search" ? (
              <p className="font-mono">Searching: {step.query}</p>
            ) : step.type === "source_found" ? (
              <div>
                <p className="font-medium">{step.title}</p>
                <p className="text-xs text-gray-500">{step.url}</p>
                <p>{step.snippet}</p>
              </div>
            ) : (
              <p className="italic">{step.text}</p>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
