import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { cosine, findNearestTopic, loadCorpus, __resetCorpusForTest } from "./corpus";
import type { Corpus, Timeline, MaliciousSource } from "./corpus-types";

describe("cosine", () => {
  it("returns 1 for identical vectors", () => {
    expect(cosine([1, 0, 0], [1, 0, 0])).toBeCloseTo(1);
  });
  it("returns 0 for orthogonal", () => {
    expect(cosine([1, 0], [0, 1])).toBeCloseTo(0);
  });
  it("throws on mismatched lengths", () => {
    expect(() => cosine([1], [1, 2])).toThrow();
  });
  it("returns 0 for zero vectors (no NaN)", () => {
    expect(cosine([0, 0], [0, 0])).toBe(0);
    expect(cosine([0, 0], [1, 1])).toBe(0);
  });
});

const emptyTimeline: Timeline = {
  steps: [],
  report_tokens: [],
  citations: [],
};

const emptyMalicious: MaliciousSource = {
  title: "",
  url_slug: "",
  displayed_url: "",
  snippet: "",
  landing_markdown: "",
};

const CORPUS: Corpus = {
  version: "test",
  embedding_model: "m",
  topics: [
    {
      topic_id: "a",
      topic_text: "a",
      topic_embedding: [1, 0, 0],
      vanilla_timeline: emptyTimeline,
      injected_timeline: emptyTimeline,
      malicious_source: emptyMalicious,
    },
    {
      topic_id: "b",
      topic_text: "b",
      topic_embedding: [0, 1, 0],
      vanilla_timeline: emptyTimeline,
      injected_timeline: emptyTimeline,
      malicious_source: emptyMalicious,
    },
  ],
};

describe("findNearestTopic", () => {
  it("returns top-1 with similarity", () => {
    const r = findNearestTopic(CORPUS, [0.9, 0.1, 0]);
    expect(r.topic.topic_id).toBe("a");
    expect(r.similarity).toBeGreaterThan(0.9);
  });

  it("throws on empty corpus", () => {
    expect(() =>
      findNearestTopic({ ...CORPUS, topics: [] }, [1, 0, 0]),
    ).toThrow(/empty/i);
  });
});

describe("loadCorpus", () => {
  let tmpDir: string;
  let corpusFile: string;

  beforeEach(async () => {
    __resetCorpusForTest();
    tmpDir = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), "corpus-test-"),
    );
    corpusFile = path.join(tmpDir, "corpus.json");
  });

  afterEach(async () => {
    __resetCorpusForTest();
    await fs.promises.rm(tmpDir, { recursive: true, force: true });
  });

  it("parses and Zod-validates a well-formed corpus file", async () => {
    await fs.promises.writeFile(corpusFile, JSON.stringify(CORPUS));
    const loaded = await loadCorpus(corpusFile);
    expect(loaded.version).toBe("test");
    expect(loaded.topics).toHaveLength(2);
    expect(loaded.topics[0]!.topic_id).toBe("a");
  });

  it("throws a Zod error on malformed corpus JSON", async () => {
    await fs.promises.writeFile(
      corpusFile,
      JSON.stringify({ version: "x", topics: "not-an-array" }),
    );
    await expect(loadCorpus(corpusFile)).rejects.toThrow();
  });

  it("caches the same promise across concurrent calls", async () => {
    await fs.promises.writeFile(corpusFile, JSON.stringify(CORPUS));
    const [a, b, c] = await Promise.all([
      loadCorpus(corpusFile),
      loadCorpus(corpusFile),
      loadCorpus(corpusFile),
    ]);
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  it("resets cache on failure so retry is possible", async () => {
    await fs.promises.writeFile(corpusFile, "not json at all");
    await expect(loadCorpus(corpusFile)).rejects.toThrow();
    await fs.promises.writeFile(corpusFile, JSON.stringify(CORPUS));
    const ok = await loadCorpus(corpusFile);
    expect(ok.version).toBe("test");
  });
});
