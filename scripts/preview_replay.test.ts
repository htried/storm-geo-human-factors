import { describe, expect, it } from "vitest";

import { pickTimeline } from "./preview_replay";

describe("pickTimeline", () => {
  it("returns the correct timeline for vanilla/injected", () => {
    const corpus = {
      version: "v",
      embedding_model: "m",
      topics: [
        {
          topic_id: "t1",
          topic_text: "x",
          topic_embedding: [1],
          vanilla_timeline: { steps: [], report_tokens: ["v"], citations: [] },
          injected_timeline: { steps: [], report_tokens: ["i"], citations: [] },
          malicious_source: {
            title: "a",
            url_slug: "b",
            displayed_url: "c",
            snippet: "d",
            landing_markdown: "e",
          },
        },
      ],
    };
    expect(pickTimeline(corpus, "t1", "vanilla").report_tokens.join("")).toBe("v");
    expect(pickTimeline(corpus, "t1", "injected").report_tokens.join("")).toBe("i");
  });
});
