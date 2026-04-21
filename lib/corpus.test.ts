import { describe, it, expect } from "vitest";
import { cosine, findNearestTopic } from "./corpus";
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
