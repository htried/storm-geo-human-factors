import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  embedTopicsData,
  embedTopicsFile,
  embeddingInputHash,
  needsEmbedding,
} from "./embed_topics";

describe("embed_topics", () => {
  it("needsEmbedding is false when model/hash/vector are unchanged", () => {
    const model = "text-embedding-3-small";
    const topicText = "hello";
    const hash = embeddingInputHash(topicText, model);
    const t = {
      topic_id: "t1",
      topic_text: topicText,
      topic_embedding: [1, 2, 3],
      embedding_model: model,
      embedding_input_hash: hash,
    };
    expect(needsEmbedding(t, model)).toBe(false);
    expect(needsEmbedding({ ...t, embedding_input_hash: "wrong" }, model)).toBe(true);
  });

  it("embeds only changed topics and preserves unchanged ones", async () => {
    const model = "text-embedding-3-small";
    const unchangedHash = embeddingInputHash("same", model);
    const topics = [
      {
        topic_id: "a",
        topic_text: "same",
        topic_embedding: [0.1, 0.2],
        embedding_model: model,
        embedding_input_hash: unchangedHash,
      },
      {
        topic_id: "b",
        topic_text: "changed",
      },
    ];

    let calls = 0;
    const out = await embedTopicsData(topics, {
      model,
      embedBatch: async (texts) => {
        calls++;
        expect(texts).toEqual(["changed"]);
        return [[9, 9]];
      },
    });

    expect(calls).toBe(1);
    expect(out[0]!.topic_embedding).toEqual([0.1, 0.2]);
    expect(out[1]!.topic_embedding).toEqual([9, 9]);
    expect(out[1]!.embedding_input_hash).toBe(
      embeddingInputHash("changed", model),
    );
  });

  it("supports {topics: []} file shape and writes idempotent updates", async () => {
    const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "embed-topics-"));
    try {
      const inputPath = path.join(tmpDir, "topics.json");
      const source = {
        topics: [
          { topic_id: "x", topic_text: "alpha" },
          { topic_id: "y", topic_text: "beta" },
        ],
      };
      await fs.promises.writeFile(inputPath, JSON.stringify(source), "utf8");

      await embedTopicsFile(inputPath, inputPath, {
        model: "m-test",
        batchSize: 1,
        embedBatch: async (texts) =>
          texts.map((t) => [t.length, t.length + 1]),
      });

      const first = JSON.parse(await fs.promises.readFile(inputPath, "utf8")) as {
        topics: Array<{ topic_embedding?: number[]; embedding_input_hash?: string }>;
      };
      expect(first.topics[0]!.topic_embedding).toEqual([5, 6]);
      expect(first.topics[1]!.topic_embedding).toEqual([4, 5]);
      const hash0 = first.topics[0]!.embedding_input_hash;

      // Run again with an embedder that would throw if called; idempotency
      // should skip all embeddings because nothing changed.
      await embedTopicsFile(inputPath, inputPath, {
        model: "m-test",
        embedBatch: async () => {
          throw new Error("should not be called on idempotent pass");
        },
      });

      const second = JSON.parse(await fs.promises.readFile(inputPath, "utf8")) as {
        topics: Array<{ embedding_input_hash?: string }>;
      };
      expect(second.topics[0]!.embedding_input_hash).toBe(hash0);
    } finally {
      await fs.promises.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
