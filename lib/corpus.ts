import fs from "node:fs";
import path from "node:path";
import { isMockMode } from "./mock";
import { CorpusSchema, type Corpus, type Topic } from "./corpus-types";

/** A topic's study-level ID: several replayable runs can share one group. */
export function topicGroupId(t: Pick<Topic, "topic_id" | "topic_group_id">): string {
  return t.topic_group_id ?? t.topic_id;
}

/** Study topics a session can be assigned: one per group (not per-run variants). */
export function studyTopicIds(corpus: Corpus): string[] {
  return corpus.topics.filter((t) => topicGroupId(t) === t.topic_id).map((t) => t.topic_id);
}

/**
 * Runs that may be replayed for a session on `groupId`. With a `direction`, only runs
 * whose injection pushed toward that side; corpora without direction tags are
 * returned whole so older single-side corpora keep working.
 */
export function groupCandidates(
  corpus: Corpus,
  groupId: string,
  direction?: "pro" | "con",
): Topic[] {
  const group = corpus.topics.filter((t) => topicGroupId(t) === groupId);
  if (!direction || !group.some((t) => t.injection_direction)) return group;
  return group.filter((t) => t.injection_direction === direction);
}

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

function primaryCorpusPath(): string {
  return (
    process.env.CORPUS_PATH ??
    path.join(process.cwd(), "app", "data", "corpus.json")
  );
}

function mockCorpusPath(): string {
  return path.join(process.cwd(), "app", "data", "corpus.mock.json");
}

function placeholderCorpusPath(): string {
  return path.join(process.cwd(), "app", "data", "corpus.placeholder.json");
}

function allowPlaceholderFallback(): boolean {
  if (process.env.ALLOW_PLACEHOLDER_CORPUS === "1") return true;
  // Keep local/dev ergonomics and test reliability, but fail closed in
  // production unless explicitly opted in.
  return process.env.NODE_ENV !== "production";
}

async function readFileIfExists(p: string): Promise<string | null> {
  try {
    return await fs.promises.readFile(p, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

export async function loadCorpus(corpusPath?: string): Promise<Corpus> {
  if (pending) return pending;
  const explicit = corpusPath !== undefined;
  const primary = corpusPath ?? primaryCorpusPath();
  pending = (async () => {
    let raw = await readFileIfExists(primary);
    // Mock mode (topics still being validated): use the committed mock corpus
    // built from corpus_sources/ without embeddings.
    if (raw === null && !explicit && isMockMode()) {
      raw = await readFileIfExists(mockCorpusPath());
    }
    // If the caller didn't pass an explicit path and the primary file doesn't
    // exist (e.g. Phase 5 hasn't built corpus.json yet), fall back to the
    // committed placeholder corpus so dev server and tests can run.
    if (raw === null && !explicit && allowPlaceholderFallback()) {
      const placeholder = placeholderCorpusPath();
      raw = await readFileIfExists(placeholder);
      if (raw === null) {
        throw new Error(
          `loadCorpus: neither ${primary} nor ${placeholder} exists`,
        );
      }
    }
    if (raw === null) {
      // Explicit path was given and missing — surface that clearly.
      await fs.promises.readFile(primary, "utf8");
      throw new Error(`loadCorpus: ${primary} is unreadable`);
    }
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
