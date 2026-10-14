import { describe, expect, it } from "vitest";
import { selectTopic } from "./topic-selection";

const corpus = ["t1", "t2", "t3", "t4"];

describe("selectTopic", () => {
  it("draws uniformly among eligible topics only", () => {
    const counts: Record<string, number> = {};
    for (let i = 0; i < 3000; i++) {
      const r = selectTopic({ corpusTopicIds: corpus, eligibleTopics: ["t2", "t4"] });
      if (!r.ok) throw new Error("expected ok");
      expect(r.selection).toBe("eligible_random");
      counts[r.topic_id] = (counts[r.topic_id] ?? 0) + 1;
    }
    expect(Object.keys(counts).sort()).toEqual(["t2", "t4"]);
    expect(counts.t2!).toBeGreaterThan(1300);
    expect(counts.t4!).toBeGreaterThan(1300);
  });

  it("screens out when the eligible list is empty", () => {
    expect(selectTopic({ corpusTopicIds: corpus, eligibleTopics: [] })).toEqual({
      ok: false,
      reason: "no_eligible_topics",
    });
  });

  it("drops unknown IDs but records them", () => {
    const r = selectTopic({ corpusTopicIds: corpus, eligibleTopics: ["t3", "nope"], rng: () => 0 });
    expect(r).toMatchObject({ ok: true, topic_id: "t3", eligible: ["t3"], unknown: ["nope"] });
  });

  it("treats an all-unknown list as a config error, not a screen-out", () => {
    expect(selectTopic({ corpusTopicIds: corpus, eligibleTopics: ["x", "y"] })).toEqual({
      ok: false,
      reason: "eligible_topics_not_in_corpus",
      unknown: ["x", "y"],
    });
  });

  it("explicit topic_id wins (researcher preview)", () => {
    const r = selectTopic({ corpusTopicIds: corpus, explicitTopicId: "t1", eligibleTopics: ["t2"] });
    expect(r).toMatchObject({ ok: true, topic_id: "t1", selection: "explicit", eligible: ["t2"] });
    expect(selectTopic({ corpusTopicIds: corpus, explicitTopicId: "zz" })).toMatchObject({
      ok: false,
      reason: "unknown_topic_id",
    });
  });

  it("falls back to random over all topics when no list is given", () => {
    const r = selectTopic({ corpusTopicIds: corpus, rng: () => 0.99 });
    expect(r).toMatchObject({ ok: true, topic_id: "t4", selection: "random_all", eligible: null });
    expect(selectTopic({ corpusTopicIds: [] })).toEqual({ ok: false, reason: "empty_corpus" });
  });
});
