-- Agent arms poisoned toward a fixed side (ProCon pro/con corpora). Participants are
-- randomized three ways: vanilla_agent / injected_agent_pro / injected_agent_con
-- (ENABLED_CONDITIONS). injected_agent stays valid for existing sessions.
alter table public.sessions drop constraint if exists sessions_condition_check;
alter table public.sessions
  add constraint sessions_condition_check check (condition in (
    'vanilla_search', 'injected_search', 'vanilla_agent', 'injected_agent',
    'injected_agent_pro', 'injected_agent_con'
  ));
