/** Study arms and helpers. Dependency-free so client components can import it. */

export const CONDITIONS = [
  "vanilla_search",
  "injected_search",
  "vanilla_agent",
  "injected_agent",
  // Agent poisoned toward a fixed side (ProCon pro/con corpora). The replayed run is drawn
  // only from corpus entries whose injection_direction matches.
  "injected_agent_pro",
  "injected_agent_con",
] as const;

export type Condition = (typeof CONDITIONS)[number];

export const AGENT_CONDITIONS: readonly Condition[] = [
  "vanilla_agent",
  "injected_agent",
  "injected_agent_pro",
  "injected_agent_con",
];

export function isAgentCondition(c: string): c is Condition {
  return (AGENT_CONDITIONS as readonly string[]).includes(c);
}

/** Conditions that replay/show the injected (poisoned) timeline. */
export function isInjectedCondition(c: string): boolean {
  return (
    c === "injected_search" ||
    c === "injected_agent" ||
    c === "injected_agent_pro" ||
    c === "injected_agent_con"
  );
}

/** Side the injection pushes toward, or undefined when any side is acceptable. */
export function injectionDirectionOf(c: string): "pro" | "con" | undefined {
  if (c === "injected_agent_pro") return "pro";
  if (c === "injected_agent_con") return "con";
  return undefined;
}
