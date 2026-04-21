import fs from "node:fs";
import path from "node:path";
import { CorpusSchema, type Corpus, type Topic } from "./corpus-types";

export function cosine(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length) throw new Error("vector length mismatch");
  let dot = 0,
    na = 0,
    nb = 0;
  for (let i = 0; i < a.length; i++) {
    const ai = a[i]!;
    const bi = b[i]!;
    dot += ai * bi;
    na += ai * ai;
    nb += bi * bi;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / Math.sqrt(na * nb);
}

export function findNearestTopic(
  corpus: Corpus,
  query: readonly number[],
): { topic: Topic; similarity: number } {
  if (corpus.topics.length === 0) throw new Error("corpus is empty");
  let best = corpus.topics[0]!;
  let bestSim = -Infinity;
  for (const t of corpus.topics) {
    const s = cosine(t.topic_embedding, query);
    if (s > bestSim) {
      bestSim = s;
      best = t;
    }
  }
  return { topic: best, similarity: bestSim };
}

let pending: Promise<Corpus> | null = null;

function defaultCorpusPath(): string {
  return (
    process.env.CORPUS_PATH ??
    path.join(process.cwd(), "app", "data", "corpus.json")
  );
}

export async function loadCorpus(corpusPath?: string): Promise<Corpus> {
  if (pending) return pending;
  const p = corpusPath ?? defaultCorpusPath();
  pending = (async () => {
    const raw = await fs.promises.readFile(p, "utf8");
    const parsed: unknown = JSON.parse(raw);
    return CorpusSchema.parse(parsed);
  })();
  // Reset on failure so a retry is possible.
  pending.catch(() => {
    pending = null;
  });
  return pending;
}

export function __resetCorpusForTest() {
  pending = null;
}
