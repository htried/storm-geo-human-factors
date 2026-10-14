-- Lock down study data so only the server (service_role / secret key) can
-- read or write it. Supabase exposes the `public` schema through PostgREST
-- and GraphQL to the `anon` and `authenticated` roles, whose keys are
-- considered public. Without this migration, anyone holding the project's
-- anon/publishable key could read participant data.
--
-- Strategy (defense in depth):
--   1. Enable RLS on every table with *no* policies  -> anon/authenticated
--      get zero rows even if a grant slips back in.
--   2. Revoke all table/sequence/function privileges from anon/authenticated.
--   3. Revoke default privileges so future tables start locked down too.
-- service_role has BYPASSRLS and keeps its grants, so the app is unaffected.

do $$
declare
  t text;
begin
  foreach t in array array[
    'participants', 'sessions', 'events', 'chat_messages', 'search_cache', 'app_config'
  ] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from anon, authenticated;

alter default privileges in schema public revoke all on tables    from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke all on functions from anon, authenticated;

-- Supabase creates objects as `postgres`; cover its default privileges too.
alter default privileges for role postgres in schema public revoke all on tables    from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on functions from anon, authenticated;

-- Make sure the server role can still do its job.
grant usage on schema public to service_role;
grant all on all tables    in schema public to service_role;
grant all on all sequences in schema public to service_role;
