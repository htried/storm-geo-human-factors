/**
 * Picks the study topic for a new session.
 *
 * Methodology: participants rate their view on each candidate topic (0-100)
 * in the survey before the task. Only topics where they are undecided
 * (view in [25, 75]) are eligible, and one eligible topic is drawn uniformly
 * at random. The survey computes the eligible set and passes topic IDs only
 * (not the ratings); the draw happens here so it is recorded server-side.
 */

export type TopicSelection = "explicit" | "eligible_random" | "random_all";

export type SelectTopicResult =
  | {
      ok: true;
      topic_id: string;
      selection: TopicSelection;
      /** Eligible IDs that exist in the corpus (null if no list was given). */
      eligible: string[] | null;
      /** Eligible IDs the survey sent that the corpus doesn't know. */
      unknown: string[];
    }
  | { ok: false; reason: "no_eligible_topics" }
  | { ok: false; reason: "eligible_topics_not_in_corpus"; unknown: string[] }
  | { ok: false; reason: "unknown_topic_id"; topic_id: string }
  | { ok: false; reason: "empty_corpus" };

export function selectTopic(args: {
  corpusTopicIds: readonly string[];
  /** Researcher/preview override; wins over everything else. */
  explicitTopicId?: string;
  /** From the survey. `[]` means the participant has no eligible topic. */
  eligibleTopics?: readonly string[];
  rng?: () => number;
}): SelectTopicResult {
  const rng = args.rng ?? Math.random;
  const known = new Set(args.corpusTopicIds);

  if (args.explicitTopicId) {
    if (!known.has(args.explicitTopicId)) {
      return { ok: false, reason: "unknown_topic_id", topic_id: args.explicitTopicId };
    }
    return {
      ok: true,
      topic_id: args.explicitTopicId,
      selection: "explicit",
      eligible: args.eligibleTopics ? args.eligibleTopics.filter((t) => known.has(t)) : null,
      unknown: args.eligibleTopics ? args.eligibleTopics.filter((t) => !known.has(t)) : [],
    };
  }

  if (args.eligibleTopics) {
    const unique = Array.from(new Set(args.eligibleTopics));
    if (unique.length === 0) return { ok: false, reason: "no_eligible_topics" };
    const eligible = unique.filter((t) => known.has(t));
    const unknown = unique.filter((t) => !known.has(t));
    // A non-empty list with no known IDs is a survey/corpus mismatch, not a
    // participant who should be screened out.
    if (eligible.length === 0) {
      return { ok: false, reason: "eligible_topics_not_in_corpus", unknown };
    }
    const pick = eligible[Math.min(eligible.length - 1, Math.floor(rng() * eligible.length))]!;
    return { ok: true, topic_id: pick, selection: "eligible_random", eligible, unknown };
  }

  if (args.corpusTopicIds.length === 0) return { ok: false, reason: "empty_corpus" };
  const ids = args.corpusTopicIds;
  const pick = ids[Math.min(ids.length - 1, Math.floor(rng() * ids.length))]!;
  return { ok: true, topic_id: pick, selection: "random_all", eligible: null, unknown: [] };
}
