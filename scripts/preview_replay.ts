import fs from "node:fs";
import path from "node:path";

import { CorpusSchema, type Corpus, type Timeline } from "@/lib/corpus-types";

type PreviewCondition = "vanilla" | "injected";

function pickTimeline(corpus: Corpus, topicId: string, condition: PreviewCondition): Timeline {
  const topic = corpus.topics.find((t) => t.topic_id === topicId);
  if (!topic) throw new Error(`Unknown topic_id: ${topicId}`);
  return condition === "injected" ? topic.injected_timeline : topic.vanilla_timeline;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function previewReplay(args: {
  corpusPath: string;
  topicId: string;
  condition: PreviewCondition;
  streamTokens?: boolean;
}): Promise<void> {
  const streamTokens = args.streamTokens ?? true;
  const raw = JSON.parse(await fs.promises.readFile(args.corpusPath, "utf8")) as unknown;
  const corpus = CorpusSchema.parse(raw);
  const timeline = pickTimeline(corpus, args.topicId, args.condition);

  console.log(`# Replay preview`);
  console.log(`topic=${args.topicId} condition=${args.condition}`);
  console.log(`steps=${timeline.steps.length} total_duration_ms=${timeline.total_duration_ms ?? "n/a"}`);
  for (const step of timeline.steps) {
    const text =
      step.type === "search"
        ? step.query
        : step.type === "source_found"
          ? `${step.title} (${step.url})`
          : step.type === "expert_turn"
            ? `${step.role}: ${step.text}`
            : step.text;
    console.log(`[${String(step.t_ms).padStart(5, " ")}ms] ${step.type}: ${text.slice(0, 160)}`);
  }

  console.log("\n# Report stream");
  if (!streamTokens) {
    process.stdout.write(timeline.report_tokens.join(""));
    process.stdout.write("\n");
    return;
  }
  for (const token of timeline.report_tokens) {
    process.stdout.write(token);
    await sleep(25);
  }
  process.stdout.write("\n");
}

async function main() {
  const topicId = process.argv[2];
  const condition = process.argv[3] as PreviewCondition | undefined;
  const corpusPath = process.argv[4] ?? path.join(process.cwd(), "app", "data", "corpus.json");
  if (!topicId || (condition !== "vanilla" && condition !== "injected")) {
    throw new Error(
      "Usage: tsx scripts/preview_replay.ts <topic_id> <vanilla|injected> [corpus.json]",
    );
  }
  await previewReplay({ corpusPath, topicId, condition });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}

export { pickTimeline };
