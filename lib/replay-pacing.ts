import type { Step, Timeline } from "./corpus-types";

/**
 * Turns a recorded agent timeline into a paced replay plan. The recorded
 * timestamps only provide *relative* ordering/spacing; the wall-clock length
 * of each replay is drawn per session so it never lands on a suspiciously
 * round number, and steps/tokens get jitter so the cadence looks organic.
 */

export interface PacingOptions {
  /** Inclusive range for the total replay length (steps + report). */
  minTotalMs: number;
  maxTotalMs: number;
  /** Uniform [0,1) source; injectable for deterministic tests. */
  rng?: () => number;
}

export type ReplayEvent =
  | { delayMs: number; kind: "step"; step: Step }
  | { delayMs: number; kind: "token"; token: string };

export interface ReplayPlan {
  totalMs: number;
  stepsMs: number;
  reportMs: number;
  events: ReplayEvent[];
}

export const DEFAULT_PACING: Readonly<Pick<PacingOptions, "minTotalMs" | "maxTotalMs">> = {
  minTotalMs: 25_000,
  maxTotalMs: 35_000,
};

/** Parses "25000-35000" (ms). Falls back to DEFAULT_PACING on bad input. */
export function parsePacingRange(raw: string | undefined): { minTotalMs: number; maxTotalMs: number } {
  const m = raw?.trim().match(/^(\d+)\s*-\s*(\d+)$/);
  if (!m) return { ...DEFAULT_PACING };
  const a = Number(m[1]);
  const b = Number(m[2]);
  return { minTotalMs: Math.min(a, b), maxTotalMs: Math.max(a, b) };
}

const TOKEN_TICK_MS = 45;

export function planReplay(timeline: Timeline, opts: PacingOptions): ReplayPlan {
  const rng = opts.rng ?? Math.random;
  const uniform = (lo: number, hi: number) => lo + (hi - lo) * rng();

  const totalMs = Math.round(uniform(opts.minTotalMs, opts.maxTotalMs));
  const hasSteps = timeline.steps.length > 0;
  const hasTokens = timeline.report_tokens.length > 0;
  // Research phase gets ~50-65% of the time; the report streams in the rest.
  const stepsShare = !hasTokens ? 1 : !hasSteps ? 0 : uniform(0.5, 0.65);
  const stepsMs = Math.round(totalMs * stepsShare);
  const reportMs = totalMs - stepsMs;

  const events: ReplayEvent[] = [];

  // --- steps: keep recorded relative spacing, rescale, then jitter each gap.
  if (hasSteps) {
    const steps = timeline.steps;
    const first = steps[0]!.t_ms;
    const span = Math.max(1, steps[steps.length - 1]!.t_ms - first);
    // A short "thinking" pause before the first step.
    const lead = Math.min(stepsMs, Math.round(stepsMs * uniform(0.02, 0.06)));
    const body = stepsMs - lead;
    let prevTarget = 0;
    let emitted = 0;
    steps.forEach((step, i) => {
      const nominal = i === 0 ? lead : lead + ((step.t_ms - first) / span) * body;
      const gap = nominal - prevTarget;
      // +/-35% jitter on each gap, but never reorder and never exceed the budget.
      const jittered = i === 0 ? nominal : prevTarget + Math.max(0, gap * uniform(0.65, 1.35));
      const at = Math.min(stepsMs, Math.max(emitted, Math.round(jittered)));
      events.push({ delayMs: at - emitted, kind: "step", step });
      emitted = at;
      prevTarget = nominal;
    });
    // Absorb rounding/jitter drift so the research phase ends on budget.
    if (emitted < stepsMs && hasTokens) {
      events.push({ delayMs: stepsMs - emitted, kind: "token", token: "" });
    }
  }

  // --- report: batch tokens into ticks so the stream finishes in reportMs.
  if (hasTokens) {
    const tokens = timeline.report_tokens;
    const ticks = Math.max(1, Math.round(reportMs / TOKEN_TICK_MS));
    const n = tokens.length;
    let i = 0;
    let lastEmitAt = 0;
    for (let t = 0; t < ticks; t++) {
      // Cumulative progress with per-tick wobble; the last tick always lands
      // on 100% so the stream ends exactly at reportMs.
      let f = (t + 1) / ticks;
      if (t < ticks - 1) f += (rng() - 0.5) * (0.8 / ticks);
      const upTo = t === ticks - 1 ? n : Math.min(n, Math.max(i, Math.round(n * f)));
      const take = upTo - i;
      if (take <= 0) continue;
      const at = Math.round(((t + 1) / ticks) * reportMs);
      events.push({ delayMs: Math.max(0, at - lastEmitAt), kind: "token", token: tokens.slice(i, i + take).join("") });
      lastEmitAt = at;
      i += take;
    }
  }

  // Drop the empty padding token (it only carries delay) by folding its delay
  // into the next event.
  const folded: ReplayEvent[] = [];
  let pending = 0;
  for (const e of events) {
    if (e.kind === "token" && e.token === "") {
      pending += e.delayMs;
      continue;
    }
    folded.push({ ...e, delayMs: e.delayMs + pending });
    pending = 0;
  }

  return { totalMs, stepsMs, reportMs, events: folded };
}
