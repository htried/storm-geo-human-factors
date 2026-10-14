import fs from "node:fs";
import { createHash } from "node:crypto";

import OpenAI from "openai";

interface TopicLike {
  topic_id: string;
  topic_text: string;
  topic_embedding?: number[];
  embedding_model?: string;
  embedding_input_hash?: string;
}

export interface EmbedTopicsOptions {
  model?: string;
  batchSize?: number;
  embedBatch?: (texts: string[], model: string) => Promise<number[][]>;
}

export function embeddingInputHash(topicText: string, model: string): string {
  return createHash("sha256").update(`${model}|${topicText}`).digest("hex");
}

export function needsEmbedding(topic: TopicLike, model: string): boolean {
  const h = embeddingInputHash(topic.topic_text, model);
  return !(
    topic.embedding_model === model &&
    topic.embedding_input_hash === h &&
    Array.isArray(topic.topic_embedding) &&
    topic.topic_embedding.length > 0
  );
}

async function defaultEmbedBatch(texts: string[], model: string): Promise<number[][]> {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const resp = await client.embeddings.create({
    model,
    input: texts,
  });
  return resp.data.map((d) => d.embedding);
}

export async function embedTopicsData<T extends TopicLike>(
  topics: T[],
  options: EmbedTopicsOptions = {},
): Promise<T[]> {
  const model = options.model ?? process.env.EMBEDDING_MODEL ?? "text-embedding-3-small";
  const batchSize = Math.max(1, options.batchSize ?? 32);
  const embedBatch = options.embedBatch ?? defaultEmbedBatch;
  const out = topics.map((t) => ({ ...t })) as T[];

  const toEmbed: number[] = [];
  for (let i = 0; i < out.length; i++) {
    if (needsEmbedding(out[i]!, model)) toEmbed.push(i);
  }

  for (let i = 0; i < toEmbed.length; i += batchSize) {
    const batchIdx = toEmbed.slice(i, i + batchSize);
    const batchTexts = batchIdx.map((idx) => out[idx]!.topic_text);
    const vectors = await embedBatch(batchTexts, model);
    if (vectors.length !== batchIdx.length) {
      throw new Error(
        `embedTopicsData: embedding count mismatch (got ${vectors.length}, expected ${batchIdx.length})`,
      );
    }
    for (let j = 0; j < batchIdx.length; j++) {
      const idx = batchIdx[j]!;
      out[idx]!.topic_embedding = vectors[j]!;
      out[idx]!.embedding_model = model;
      out[idx]!.embedding_input_hash = embeddingInputHash(out[idx]!.topic_text, model);
    }
  }

  return out;
}

interface TopicsFileObject<T> {
  topics: T[];
}

function normalizeTopicsPayload<T extends TopicLike>(raw: unknown): {
  wrapper: "array" | "object";
  topics: T[];
} {
  if (Array.isArray(raw)) {
    return { wrapper: "array", topics: raw as T[] };
  }
  if (raw && typeof raw === "object" && Array.isArray((raw as { topics?: unknown }).topics)) {
    return {
      wrapper: "object",
      topics: (raw as TopicsFileObject<T>).topics,
    };
  }
  throw new Error("embed_topics: input must be Topic[] or {topics: Topic[]}");
}

export async function embedTopicsFile(
  topicsPath: string,
  outPath: string,
  options: EmbedTopicsOptions = {},
): Promise<void> {
  const raw = JSON.parse(await fs.promises.readFile(topicsPath, "utf8")) as unknown;
  const normalized = normalizeTopicsPayload<TopicLike>(raw);
  const updated = await embedTopicsData(normalized.topics, options);
  const payload =
    normalized.wrapper === "array" ? updated : ({ topics: updated } satisfies TopicsFileObject<TopicLike>);
  await fs.promises.writeFile(outPath, JSON.stringify(payload, null, 2), "utf8");
}

async function main() {
  const topicsPath = process.argv[2];
  if (!topicsPath) {
    throw new Error("Usage: tsx scripts/embed_topics.ts <topics.json> [out.json]");
  }
  const outPath = process.argv[3] ?? topicsPath;
  await embedTopicsFile(topicsPath, outPath);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
