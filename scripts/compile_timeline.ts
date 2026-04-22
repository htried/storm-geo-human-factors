import fs from "node:fs";
import path from "node:path";

import { TimelineSchema, type Timeline, type Citation, type Step } from "@/lib/corpus-types";

const DEFAULT_TARGET_DURATION_MS = 30_000;

interface RawSource {
  url?: string;
  title?: string;
  description?: string;
  snippets?: string[];
}

interface RawTurn {
  role?: string;
  utterance?: string;
  queries?: string[];
  raw_retrieved_info?: RawSource[];
}

interface RawInstanceDump {
  runner_argument?: { topic?: string };
  warmstart_conv_archive?: RawTurn[];
  conversation_history?: RawTurn[];
  knowledge_base?: {
    info_uuid_to_info_dict?: Record<
      string,
      { citation_uuid?: number; url?: string; title?: string; description?: string }
    >;
  };
}

export interface CompileTimelineArgs {
  instanceDumpPath: string;
  logPath: string;
  reportPath: string;
  targetDurationMs?: number;
}

function extractCitationNumbers(report: string): number[] {
  const out = new Set<number>();
  const re = /\[(\d+)\]/g;
  for (const m of report.matchAll(re)) {
    out.add(Number(m[1]));
  }
  return [...out].sort((a, b) => a - b);
}

function tokenizeReport(report: string): string[] {
  return report.match(/\S+|\s+/g) ?? [report];
}

function snippetFromSource(s: RawSource): string {
  if (Array.isArray(s.snippets) && s.snippets.length > 0) {
    return String(s.snippets[0] ?? "").slice(0, 300);
  }
  if (typeof s.description === "string" && s.description.length > 0) {
    return s.description.slice(0, 300);
  }
  return "";
}

function sourceToStep(s: RawSource): Step | null {
  const url = typeof s.url === "string" ? s.url : "";
  if (!url) return null;
  return {
    t_ms: 0,
    type: "source_found",
    title: typeof s.title === "string" && s.title.length > 0 ? s.title : url,
    url,
    snippet: snippetFromSource(s),
  };
}

function turnToSteps(turn: RawTurn): Step[] {
  const steps: Step[] = [];

  const queries = Array.isArray(turn.queries)
    ? turn.queries.filter((q) => typeof q === "string" && q.trim().length > 0)
    : [];
  for (const q of queries.slice(0, 2)) {
    steps.push({ t_ms: 0, type: "search", query: q });
  }

  const role = (turn.role ?? "").trim();
  const utterance = (turn.utterance ?? "").trim();
  if (role && utterance && !/moderator/i.test(role)) {
    steps.push({
      t_ms: 0,
      type: "expert_turn",
      role,
      text: utterance.slice(0, 600),
    });
  }

  const retrieved = Array.isArray(turn.raw_retrieved_info) ? turn.raw_retrieved_info : [];
  for (const src of retrieved.slice(0, 2)) {
    const sf = sourceToStep(src);
    if (sf) steps.push(sf);
  }

  return steps;
}

function withScaledTime(steps: Step[], targetDurationMs: number): Step[] {
  if (steps.length === 0) return [];
  if (steps.length === 1) return [{ ...steps[0]!, t_ms: 0 }];
  return steps.map((s, i) => ({
    ...s,
    t_ms: Math.round((i / (steps.length - 1)) * targetDurationMs),
  }));
}

function buildCitations(instance: RawInstanceDump, report: string): Citation[] {
  const refs = extractCitationNumbers(report);
  const info = instance.knowledge_base?.info_uuid_to_info_dict ?? {};
  return refs.map((n) => {
    const rec = info[String(n)] ?? {};
    return {
      n,
      url: typeof rec.url === "string" && rec.url.length > 0 ? rec.url : `about:missing/${n}`,
      title:
        typeof rec.title === "string" && rec.title.length > 0
          ? rec.title
          : typeof rec.description === "string" && rec.description.length > 0
            ? rec.description.slice(0, 120)
            : `Citation ${n}`,
    };
  });
}

export async function compileTimeline(args: CompileTimelineArgs): Promise<Timeline> {
  const targetDurationMs = args.targetDurationMs ?? DEFAULT_TARGET_DURATION_MS;
  const [instanceRaw, report] = await Promise.all([
    fs.promises.readFile(args.instanceDumpPath, "utf8"),
    fs.promises.readFile(args.reportPath, "utf8"),
    // Keep logPath as part of the contract even though this phase does not
    // yet derive timings from log internals.
    fs.promises.readFile(args.logPath, "utf8"),
  ]);

  const instance: RawInstanceDump = JSON.parse(instanceRaw);
  const steps: Step[] = [];
  const topic = instance.runner_argument?.topic?.trim();
  if (topic) {
    steps.push({
      t_ms: 0,
      type: "plan",
      text: `Investigating topic: ${topic.slice(0, 260)}`,
    });
  } else {
    steps.push({ t_ms: 0, type: "plan", text: "Planning research approach." });
  }

  const turns: RawTurn[] = [
    ...(instance.warmstart_conv_archive ?? []),
    ...(instance.conversation_history ?? []),
  ];
  for (const turn of turns) {
    steps.push(...turnToSteps(turn));
  }

  steps.push({
    t_ms: 0,
    type: "synthesis",
    text: "Synthesizing retrieved evidence into the final report.",
  });

  const timed = withScaledTime(steps, targetDurationMs);
  const timeline: Timeline = {
    steps: timed,
    report_tokens: tokenizeReport(report),
    citations: buildCitations(instance, report),
    total_duration_ms: targetDurationMs,
  };
  return TimelineSchema.parse(timeline);
}

async function main() {
  const instanceDumpPath = process.argv[2];
  const logPath = process.argv[3];
  const reportPath = process.argv[4];
  const outPath = process.argv[5] ?? path.join(process.cwd(), "timeline.out.json");
  if (!instanceDumpPath || !logPath || !reportPath) {
    throw new Error(
      "Usage: tsx scripts/compile_timeline.ts <instance_dump.json> <log.json> <report.md> [out.json]",
    );
  }
  const timeline = await compileTimeline({
    instanceDumpPath,
    logPath,
    reportPath,
  });
  await fs.promises.writeFile(outPath, JSON.stringify(timeline, null, 2), "utf8");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
