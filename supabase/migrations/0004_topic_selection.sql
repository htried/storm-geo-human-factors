-- Record how each session's topic was chosen (see lib/topic-selection.ts):
--   eligible_random : uniform draw from the survey's eligible list (view in [25,75])
--   explicit        : researcher/preview override via topic_id
--   random_all      : no eligible list supplied; uniform over the whole corpus
-- and which topics were eligible, so assignments can be audited.
alter table public.sessions
  add column topic_selection text
    check (topic_selection in ('eligible_random', 'explicit', 'random_all')),
  add column eligible_topics text[];
