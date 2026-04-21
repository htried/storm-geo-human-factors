import { z } from "zod";

export const PlanStepSchema = z.object({
  t_ms: z.number().int().nonnegative(),
  type: z.literal("plan"),
  text: z.string(),
});

export const ExpertTurnStepSchema = z.object({
  t_ms: z.number().int().nonnegative(),
  type: z.literal("expert_turn"),
  role: z.string(),
  text: z.string(),
});

export const SearchStepSchema = z.object({
  t_ms: z.number().int().nonnegative(),
  type: z.literal("search"),
  query: z.string(),
});

export const SourceFoundStepSchema = z.object({
  t_ms: z.number().int().nonnegative(),
  type: z.literal("source_found"),
  title: z.string(),
  url: z.string(),
  snippet: z.string(),
});

export const SynthesisStepSchema = z.object({
  t_ms: z.number().int().nonnegative(),
  type: z.literal("synthesis"),
  text: z.string(),
});

export const StepSchema = z.discriminatedUnion("type", [
  PlanStepSchema,
  ExpertTurnStepSchema,
  SearchStepSchema,
  SourceFoundStepSchema,
  SynthesisStepSchema,
]);

export type Step = z.infer<typeof StepSchema>;

export const CitationSchema = z.object({
  n: z.number().int().positive(),
  url: z.string(),
  title: z.string(),
});

export type Citation = z.infer<typeof CitationSchema>;

export const TimelineSchema = z.object({
  steps: z.array(StepSchema),
  report_tokens: z.array(z.string()),
  citations: z.array(CitationSchema),
  total_duration_ms: z.number().int().nonnegative().optional(),
});

export type Timeline = z.infer<typeof TimelineSchema>;

export const MaliciousSourceSchema = z.object({
  title: z.string(),
  url_slug: z.string(),
  displayed_url: z.string(),
  snippet: z.string(),
  landing_markdown: z.string(),
});

export type MaliciousSource = z.infer<typeof MaliciousSourceSchema>;

export const TopicSchema = z.object({
  topic_id: z.string().min(1),
  topic_text: z.string(),
  topic_embedding: z.array(z.number()),
  vanilla_timeline: TimelineSchema,
  injected_timeline: TimelineSchema,
  malicious_source: MaliciousSourceSchema,
});

export type Topic = z.infer<typeof TopicSchema>;

export const CorpusSchema = z.object({
  version: z.string(),
  embedding_model: z.string(),
  topics: z.array(TopicSchema),
});

export type Corpus = z.infer<typeof CorpusSchema>;
