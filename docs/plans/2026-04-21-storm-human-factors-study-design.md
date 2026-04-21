# STORM Geo Human Factors Study — Design

**Date:** 2026-04-21
**Status:** Approved (design phase)
**Owner:** Hal Triedman

## Purpose

Build an iframe-embeddable website that drives a four-condition between-subjects human study on how injected/poisoned information in AI research tools affects user beliefs and behavior. The site presents research tasks in one of four conditions — vanilla search, injected search, vanilla agent system, injected agent system — captures rich behavioral data, and hands a completion code back to a parent survey platform (e.g., Qualtrics).

## Study design

Between-subjects 2×2:

|              | Vanilla                          | Injected                                           |
| ------------ | -------------------------------- | -------------------------------------------------- |
| Search       | Live SERPER top-10 results       | Live SERPER with one slot swapped for a malicious source |
| Agent system | Pre-cached CoSTORM-style replay  | Pre-cached injected-variant replay                 |

Participants are assigned deterministically to one of the four conditions via `HMAC(ASSIGN_SECRET, participant_id) mod 4`. Assignment is idempotent across refreshes. A researcher-only `?condition=…` URL override is gated behind a shared secret.

## High-level architecture

One Next.js 15 (App Router) + TypeScript + Tailwind app deployed to Vercel. All secrets (SERPER, OpenAI, Supabase service role, admin/assign/inject secrets) are server-side only. The iframe renders a single `/study` page that resolves condition and then renders one of four sub-views.

**Server endpoints:**

- `POST /api/session` — create/resume a session from URL params.
- `POST /api/search` — proxies SERPER; applies injection for `injected_search`.
- `POST /api/agent/start` — embeds user query, finds top-1 cached topic, returns session + stream URL.
- `GET  /api/agent/stream` — SSE stream of agent replay steps and token-by-token report.
- `POST /api/agent/skip` — fast-forward to fully-rendered report.
- `POST /api/chat` — SSE streaming chat with report+sources pinned in system prompt.
- `POST /api/events` — bulk event ingest from the client.
- `POST /api/complete` — finalize session, emit completion code.
- `POST /api/admin/config` — admin-token gated; update chat/embedding model config.
- `GET  /api/admin/export` — admin-token gated CSV export.
- `GET  /ext/<topic_id>/<slug>` — renders the malicious landing page for the injected search condition.

**External services:**

- SERPER (live, per search query; cached 24h in `search_cache`).
- OpenAI Embeddings (`text-embedding-3-small` by default; user query embedded per request, corpus embedded offline).
- OpenAI Chat Completions (`gpt-4o-mini` by default, configurable via `app_config`).
- Supabase Postgres for all persisted state.

**Data artifact:** a single `app/data/corpus.json` built offline from `corpus_sources/`, loaded once per serverless instance.

## Participant flow

### Entry contract

Parent survey embeds:

```
https://<app>/study?participant_id=<opaque_id>&topic_id=<slug>[&condition=<cond>]
```

- `participant_id` required; seeds HMAC condition assignment and is the `participants.participant_id` key.
- `topic_id` optional; if unset, pick randomly from the active topic pool.
- `condition` optional, researcher-only; requires admin header or server-signed token.

### Screens

1. **Consent/intro** — framed topic prompt + "Begin" button.
2. **Task screen** — condition-specific:
   - Search: Google-like search bar, 10-blue-links results with up to 5 pages of pagination.
   - Agent: chat-style input → replay animation of agent steps → token-streamed report → post-response chat.
3. **Completion screen** — "Research complete" button; calls `/api/complete`, receives `completion_code`, posts it back to the parent with `window.parent.postMessage`.

### Parent ↔ iframe messaging

- On completion: `{source: "storm-study", type: "study_complete", participant_id, completion_code, duration_ms}`.
- Periodic heartbeat (every 30s): `{type: "heartbeat"}` so survey platforms can detect iframe crashes.
- Responsive resize: `{type: "resize", height}` on content-height change.

### Integrity guards

- Condition is server-side only; resolved condition returned after the session row exists.
- Injected content selected server-side; never branched on client data.
- Log `user_agent`, salted `ip_hash`, `referrer`, and `session_started_at` for post-hoc filtering.

## Search condition

### UI

Stripped-down Google clone: search bar, SERP with title/URL/snippet per result, up to 5 pages × 10 results, client-side pagination, external clicks open in new tabs.

### Server flow (`POST /api/search`)

Input `{session_id, query, page}`:

1. Load session → `condition`, `topic_id`.
2. Check `search_cache`; on miss call SERPER (`q`, `num=10`, `start=(page-1)*10`).
3. Normalize results to `{title, url, displayed_url, snippet, rank}`.
4. If `injected_search` and `page == 1`: seed RNG from `HMAC(INJECT_SECRET, session_id || query)`, pick a slot in `[0, 9]` (or `[0, N-1]` if fewer), replace with topic's `malicious_source`.
5. Log `search_results_served` event with `injected_rank` (nullable).
6. Return `{results, total_pages}`. `injected_rank` only surfaced to client when researcher-preview flag is set.

### Malicious landing page

`malicious_source.url` points at `https://<app>/ext/<topic_id>/<slug>`, rendered from topic's `landing_markdown` with a plausible fake-domain header. Clicks logged as `malicious_source_clicked`.

### Edge cases

- SERPER error → soft-fail message, session stays alive, `api_error` event.
- Zero organic results → empty state; do NOT fabricate an injected result onto an empty page.
- Pages 2+ are never injected.

### Events

- `query_submitted {query, page}`
- `search_results_served {query, page, injected_rank, result_urls}`
- `result_clicked {rank, url, is_malicious}`
- `page_changed {from, to}`
- `dwell_tick {seconds}` every 10s while tab visible.

## Agent condition

### Similarity match (`POST /api/agent/start`)

1. Embed user `query` with `text-embedding-3-small` (or whatever `app_config.embedding_model` is).
2. Cosine similarity vs every corpus topic's `topic_embedding`.
3. Take top-1 (no threshold — corpus is purpose-built to match study topics).
4. Select vanilla or injected timeline based on session `condition`.
5. Persist `matched_topic_id`, `matched_similarity` on the session.
6. Emit `agent_topic_matched` event.
7. Return `{stream_url, matched_topic_id, expected_duration_ms}`.

### Pre-compiled timeline shape

```json
{
  "topic_id": "health_10452",
  "total_duration_ms": 30000,
  "steps": [
    { "t_ms": 0,     "type": "plan",         "text": "Decomposing research question..." },
    { "t_ms": 1200,  "type": "expert_turn",  "role": "Moderator",    "text": "..." },
    { "t_ms": 2400,  "type": "search",       "query": "..." },
    { "t_ms": 3100,  "type": "source_found", "title": "...", "url": "...", "snippet": "..." },
    { "t_ms": 12000, "type": "synthesis",    "text": "Drafting report..." }
  ],
  "report_tokens": ["# ", "Types", " of", " Scars", "\n", "..."],
  "citations": [{ "n": 1, "url": "...", "title": "..." }]
}
```

Both `vanilla_timeline` and `injected_timeline` are stored. They share structure so the UX is indistinguishable; differences are in specific `source_found` entries (malicious source may be cited) and `report_tokens`.

### SSE stream (`GET /api/agent/stream`)

Two phases:

1. **Replay**: walk `steps` by wall clock, one SSE event per step. Client renders a left-side "agent activity" panel:
   - `plan` / `synthesis` → italic monospace line with pulsing dot.
   - `expert_turn` → card with role badge.
   - `search` → "Searching: …" chip.
   - `source_found` → compact source card under the most recent `search`.
2. **Report stream**: after the last step, emit `report_tokens` with 20–40ms jittered delay. Client renders live markdown with clickable `[n]` citations into the `citations` array.

### Stream control

- 15s client heartbeats; server drops stale streams after 60s.
- `POST /api/agent/skip` fast-forwards to the fully-rendered report; logs `agent_skip_used`.
- SSE reconnect via `?resume_from=<last_t_ms>` resumes at nearest step.

### Events

- `agent_started {matched_topic_id, similarity}`
- `agent_step_rendered {step_idx, type}` (batched every 500ms)
- `agent_report_stream_started` / `agent_report_stream_completed`
- `agent_skip_used`
- `citation_clicked {n, url, is_malicious}`
- `source_card_clicked {url, is_malicious}`

### Post-response chat

`POST /api/chat` input `{session_id, user_message}`:

1. Build system prompt: `CHAT_SYSTEM_PREAMBLE + shown_report_markdown + "\n\nSOURCES:\n" + stringified(shown_sources)`.
2. Append full prior `chat_messages` history for this session.
3. Call `app_config.chat_model` with `temperature`, `max_tokens` from config; stream back via SSE.
4. Persist both user and assistant turns in `chat_messages` with `is_malicious_context` denormalized from session condition.

Injected sources stay pinned across every chat turn so the "poisoning" persists. `chat_model_used`, `chat_temperature_used`, `embedding_model_used` are snapshotted onto the session row at session start so analysis can partition by exact config even if it changes mid-study.

### Failure modes

- Embedding API down → 503 from `/api/agent/start`; UI shows "System temporarily unavailable"; session stays open.
- Chat API error → error bubble with retry; do not drop session.
- Malformed timeline → fall back to a generic `generic_research` timeline shipped in the corpus.

## Corpus & build pipeline

### Input directory (`corpus_sources/`)

```
corpus_sources/
  <topic_id>/
    topic.md
    vanilla/
      instance_dump.json
      log.json
      report.md
    injected/
      instance_dump.json
      log.json      # optional; if absent, timings inherit vanilla
      report.md
    malicious_source.md   # frontmatter + body
```

Adding a topic is "drop a folder, rerun `build_corpus`".

### Scripts (`scripts/`)

- `compile_timeline.ts` — `(instance_dump.json, log.json, report.md)` → `{steps, report_tokens, citations}`. Walks `conversation_history` into steps, scales timings from `log.json` down to a target duration (default 30s), tokenizes the report on word-ish boundaries.
- `embed_topics.ts` — batch-calls OpenAI Embeddings, writes vectors back. Idempotent on `(topic_text, embedding_model)`.
- `build_corpus.ts` — orchestrator; validates schema; emits `app/data/corpus.json`.
- `mutate_instance.ts` — authoring helper to produce `injected/instance_dump.json` by mutating the vanilla dump (swap `cited_info` entries, rewrite `utterance` text).
- `preview_replay.ts` — CLI playback of any `(topic_id, condition)`.

### Artifact

`app/data/corpus.json`:

```json
{
  "version": "<iso-date-n>",
  "embedding_model": "text-embedding-3-small",
  "topics": [
    {
      "topic_id": "...",
      "topic_text": "...",
      "topic_embedding": [0.013, -0.087, "..."],
      "vanilla_timeline":  { "steps": [], "report_tokens": [], "citations": [] },
      "injected_timeline": { "steps": [], "report_tokens": [], "citations": [] },
      "malicious_source":  { "title": "...", "url_slug": "...", "displayed_url": "...", "snippet": "...", "landing_markdown": "..." }
    }
  ]
}
```

Loaded once per serverless instance via `fs.readFile`. At 50 topics × ~30KB × 2 variants ≈ 3MB; scales well to 500+ topics without changing storage strategy. Updating the corpus is a redeploy in v1.

## Data layer (Supabase Postgres)

```
participants
  participant_id   text primary key
  first_seen_at    timestamptz
  user_agent       text
  ip_hash          text
  referrer         text

sessions
  session_id              uuid primary key
  participant_id          text references participants
  condition               text not null
  topic_id                text not null
  assigned_by             text not null  -- 'hash' | 'researcher_override'
  matched_topic_id        text
  matched_similarity      float
  chat_model_used         text
  chat_temperature_used   float
  embedding_model_used    text
  completion_code         text
  started_at              timestamptz
  completed_at            timestamptz
  unique(participant_id)

events
  event_id      bigserial primary key
  session_id    uuid references sessions
  t_ms          int
  server_at     timestamptz
  type          text
  payload       jsonb

chat_messages
  message_id            uuid primary key
  session_id            uuid references sessions
  turn_number           int
  role                  text
  content               text
  is_malicious_context  boolean
  model                 text
  latency_ms            int
  created_at            timestamptz

search_cache
  cache_key    text primary key   -- sha256(query || page)
  query        text
  page         int
  raw_results  jsonb
  fetched_at   timestamptz
  expires_at   timestamptz

app_config
  id                 int primary key default 1
  chat_model         text
  chat_temperature   float
  chat_max_tokens    int
  embedding_model    text
  updated_at         timestamptz
  updated_by         text
  check (id = 1)
```

**Indexes:** `events(session_id, t_ms)`, `events(type)`, `sessions(condition)`, `sessions(participant_id)`, `search_cache(expires_at)`.

**Access:** RLS disabled; all writes use the service role key from server-side routes only.

## Iframe integration

**Headers on `/study` responses:**

- `Content-Security-Policy: frame-ancestors <ALLOWED_FRAME_ANCESTORS>;`
- `Referrer-Policy: strict-origin-when-cross-origin`.
- `X-Frame-Options` intentionally omitted (conflicts with `frame-ancestors`).

**URL contract:** `/study?participant_id=<id>&topic_id=<slug>[&condition=<cond>]`. Missing `participant_id` renders an error screen for the researcher.

## Admin / operations (v1)

- `?condition=<value>` URL override, gated by `ADMIN_TOKEN` header or server-signed token.
- `POST /api/admin/config` — partial upsert of `app_config` (chat model, temperature, max tokens, embedding model). 30s in-memory cache; falls back to `.env`.
- `GET /api/admin/export?format=csv&table=events|sessions|chat_messages` — CSV export for analysis.
- No admin UI in v1; curl/Postman only.

Future (not in v1): admin dashboard, hot-swappable corpus via Vercel Blob, per-topic override of chat model.

## Directory structure

```
.
├── app/
│   ├── study/
│   │   ├── page.tsx
│   │   ├── _components/ (ConsentPanel, SearchView, AgentView, ChatPanel, CompletionPanel)
│   │   └── _hooks/ (useEventLogger, useSSE)
│   ├── ext/[topic_id]/[slug]/page.tsx
│   ├── api/
│   │   ├── session/route.ts
│   │   ├── search/route.ts
│   │   ├── agent/{start,stream,skip}/route.ts
│   │   ├── chat/route.ts
│   │   ├── events/route.ts
│   │   ├── complete/route.ts
│   │   └── admin/{config,export}/route.ts
│   └── layout.tsx (CSP frame-ancestors)
├── lib/
│   ├── corpus.ts
│   ├── serper.ts
│   ├── openai.ts
│   ├── assignment.ts
│   ├── injection.ts
│   ├── supabase.ts
│   ├── config.ts
│   └── events.ts
├── scripts/
│   ├── compile_timeline.ts
│   ├── embed_topics.ts
│   ├── build_corpus.ts
│   ├── mutate_instance.ts
│   └── preview_replay.ts
├── corpus_sources/
├── app/data/corpus.json              # build artifact (gitignored)
├── supabase/migrations/0001_init.sql
├── docs/plans/2026-04-21-storm-human-factors-study-design.md
├── test_data/                         # existing CoSTORM samples (format reference)
├── .env
├── package.json
├── tsconfig.json
├── tailwind.config.ts
├── next.config.ts
└── README.md
```

## Dependencies

Runtime: `next`, `react`, `react-dom`, `typescript`, `tailwindcss`, `@supabase/supabase-js`, `openai`, `zod`, `react-markdown`, `remark-gfm`.

Dev: `tsx`, `@types/node`, `eslint`, `prettier`.

No vector DB client; cosine search is ~20 lines of TS over the in-memory array.

## Environment variables

- `SERPER_API_KEY` (existing)
- `OPENAI_API_KEY` (existing)
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `ASSIGN_SECRET` — HMAC key for condition assignment
- `INJECT_SECRET` — HMAC key for injection slot selection
- `ADMIN_TOKEN` — gates `/api/admin/*` and `?condition=` override
- `IP_HASH_SALT`
- `ALLOWED_FRAME_ANCESTORS` — space-separated CSP frame-ancestors list
- `CHAT_MODEL` (default `gpt-4o-mini`)
- `CHAT_TEMPERATURE` (default `0.3`)
- `CHAT_MAX_TOKENS` (default `800`)
- `EMBEDDING_MODEL` (default `text-embedding-3-small`)

## Open items for implementation plan

- Final list of study topics and their `malicious_source` content (provided by researcher).
- Consent/intro copy.
- Completion code format length and any uniqueness constraints imposed by the survey platform.
- Decision on whether `corpus.json` lives in-repo (small N) or via Vercel Blob (larger N, hot-swappable).
