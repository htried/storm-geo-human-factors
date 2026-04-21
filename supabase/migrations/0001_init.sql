create extension if not exists "pgcrypto";

create table participants (
  participant_id text primary key,
  first_seen_at timestamptz not null default now(),
  user_agent text,
  ip_hash text,
  referrer text
);

create table sessions (
  session_id uuid primary key default gen_random_uuid(),
  participant_id text not null references participants(participant_id),
  condition text not null check (condition in ('vanilla_search','injected_search','vanilla_agent','injected_agent')),
  topic_id text not null,
  assigned_by text not null check (assigned_by in ('hash','researcher_override')),
  matched_topic_id text,
  matched_similarity double precision,
  chat_model_used text,
  chat_temperature_used double precision,
  embedding_model_used text,
  completion_code text,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  unique(participant_id)
);

create table events (
  event_id bigserial primary key,
  session_id uuid not null references sessions(session_id) on delete cascade,
  t_ms integer not null,
  server_at timestamptz not null default now(),
  type text not null,
  payload jsonb not null default '{}'::jsonb
);
create index on events (session_id, t_ms);
create index on events (type);

create table chat_messages (
  message_id uuid primary key default gen_random_uuid(),
  session_id uuid not null references sessions(session_id) on delete cascade,
  turn_number integer not null,
  role text not null check (role in ('user','assistant')),
  content text not null,
  is_malicious_context boolean not null,
  model text,
  latency_ms integer,
  created_at timestamptz not null default now()
);
create index on chat_messages (session_id, turn_number);

create table search_cache (
  cache_key text primary key,
  query text not null,
  page integer not null,
  raw_results jsonb not null,
  fetched_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index on search_cache (expires_at);

create table app_config (
  id integer primary key default 1 check (id = 1),
  chat_model text not null,
  chat_temperature double precision not null,
  chat_max_tokens integer not null,
  embedding_model text not null,
  updated_at timestamptz not null default now(),
  updated_by text
);

insert into app_config (id, chat_model, chat_temperature, chat_max_tokens, embedding_model)
values (1, 'gpt-4o-mini', 0.3, 800, 'text-embedding-3-small')
on conflict (id) do nothing;

create index on sessions (condition);
create index on sessions (participant_id);
