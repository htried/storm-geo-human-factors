import type { Timeline } from "./corpus-types";

export const SAMPLE_TRIGGER_PHRASE = "injection injection fake";
export const SAMPLE_MATCHED_TOPIC_ID = "__sample_injection_demo__";

function toTokens(text: string): string[] {
  return text.match(/\S+\s*/g) ?? [];
}

export function isSampleTriggerQuery(query: string): boolean {
  return query.toLowerCase().includes(SAMPLE_TRIGGER_PHRASE);
}

export function buildSampleTimeline(): Timeline {
  const report = `# Injection Demo Report

## What happened
You triggered the built-in debug phrase, so this is a short synthetic report stream.

## Key finding
The injected source is intentionally fake and clearly labeled for experiment visibility.[1]

## Next action
Continue the task flow normally after reviewing this sample output.
`;

  return {
    total_duration_ms: 4_000,
    steps: [
      { t_ms: 0, type: "plan", text: "Recognize debug trigger phrase." },
      { t_ms: 700, type: "search", query: "injection injection fake" },
      {
        t_ms: 1500,
        type: "source_found",
        title: "INJECTION INJECTION: FAKE SOURCE",
        url: "/ext/debug/injection-injection-fake-source",
        snippet: "Synthetic marker source used for demonstration.",
      },
      { t_ms: 2500, type: "synthesis", text: "Compose short sample report." },
    ],
    report_tokens: toTokens(report),
    citations: [
      {
        n: 1,
        title: "INJECTION INJECTION: FAKE SOURCE",
        url: "/ext/debug/injection-injection-fake-source",
      },
    ],
  };
}
