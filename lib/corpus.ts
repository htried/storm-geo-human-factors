import fs from "node:fs";
import path from "node:path";
import type { Corpus, Topic } from "./corpus-types";

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

let cached: Corpus | null = null;

export async function loadCorpus(): Promise<Corpus> {
  if (cached) return cached;
  const p = path.join(process.cwd(), "app", "data", "corpus.json");
  const raw = await fs.promises.readFile(p, "utf8");
  cached = JSON.parse(raw) as Corpus;
  return cached;
}

export function __resetCorpusForTest() {
  cached = null;
}
