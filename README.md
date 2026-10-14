# Storm Human Factors Study

Next.js 15 app for controlled human-factors study conditions:

- `vanilla_search`
- `injected_search`
- `vanilla_agent` (AI overview, clean sources)
- `injected_agent` (AI overview, UGC-injected source)

**Which arms run is controlled by `ENABLED_CONDITIONS`** (comma list). The
default is the two AI-overview arms only: `vanilla_agent,injected_agent`.
Add the `*_search` arms back to re-enable traditional search.

The app runs inside an iframe (`/study`, embedded in Qualtrics) and records
participant interaction events plus completion code handoff via `postMessage`.

**Mock mode** (`MOCK_EXTERNAL_APIS=1`) runs the whole flow with no OpenAI or
SERPER keys: the agent replays the participant's assigned topic from
`app/data/corpus.mock.json` and follow-up chat returns a canned reply
(recorded with `model = 'mock'`). Regenerate the mock corpus from
`corpus_sources/` with `npm run build:corpus:mock`.

Deploying under Cornell accounts and locking down data access:
[`docs/deployment-cornell.md`](docs/deployment-cornell.md).

## Architecture Overview

- **Session lifecycle**
  - `POST /api/session`: idempotent participant session creation + condition assignment.
  - `POST /api/complete`: idempotent completion code issuance.
- **Search condition**
  - `POST /api/search`: SERPER proxy with cache and optional rank-slot injection.
  - `/ext/[topic_id]/[slug]`: malicious landing renderer for injected-search condition.
- **Agent condition**
  - `POST /api/agent/start`: embed query + topic match.
  - `GET /api/agent/stream`: SSE replay + token stream.
  - `POST /api/agent/skip`, `GET /api/agent/report`.
- **Chat**
  - `POST /api/chat`: SSE assistant token streaming with persisted turns.
- **Admin**
  - `POST /api/admin/config`: runtime model config updates.
  - `GET /api/admin/export`: CSV export for events/sessions/chat messages.
  - `GET /api/admin/session_summary`: test-only endpoint (`NODE_ENV !== production`).
  - All admin endpoints 404 unless `ADMIN_API_ENABLED=1`.
- **Security**
  - `middleware.ts` allows framing of `/study` and `/ext/*` only by
    `ALLOWED_FRAME_ANCESTORS`; all other routes send `frame-ancestors 'none'`.

## Requirements

- Node.js 20+ (project currently runs on newer Node without issue).
- npm 10+.
- Supabase project with all migrations in `supabase/migrations/` applied
  (`0002_lockdown.sql` removes anon/authenticated access to every table).
- Docker, for the local Supabase stack (`npx supabase start`).

## Supabase Setup (Required)

1. Create a Supabase project (see `docs/deployment-cornell.md` for account and
   lockdown settings).
2. Open `Settings -> API` and copy:
   - **Project URL** -> use as `SUPABASE_URL`
   - **secret** (service_role) key -> use as `SUPABASE_SERVICE_ROLE_KEY`
     - Do **not** use the anon/publishable key.
3. Apply **all** migrations in `supabase/migrations/`, in order:
   `npx supabase link --project-ref <ref> && npx supabase db push`
   (or paste each file into the SQL Editor). `0002_lockdown.sql` is what
   blocks the public key from reading study data.
4. Confirm tables exist in `Table Editor`: `participants`, `sessions`,
   `events`, `chat_messages`, `search_cache`, `app_config`.
5. Put values in local env (`.env.local`):

```env
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<secret-key>
```

6. Restart the Next.js server after env changes.

### Quick Verification

Run this after starting the app:

```bash
curl -i -X POST "http://localhost:3000/api/session" \
  -H "content-type: application/json" \
  -d '{"participant_id":"debug-001"}'
```

Expected result: `HTTP/1.1 200` with JSON containing `session_id`, `condition`, and `topic_id`.

If you use `curl -s`, errors can look like "no output" because progress/error text is suppressed.

### Debug trigger (mock mode only)

With `MOCK_EXTERNAL_APIS=1`, an agent query containing
`injection injection fake` plays a short, obviously fake demo report
(`lib/agent-sample.ts`). It is ignored when mock mode is off.

## Local Setup

1. Install dependencies:

```bash
npm install
```

2. Copy env template:

```bash
cp .env.example .env.local
```

3. Fill required env vars:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `ASSIGN_SECRET`
- `INJECT_SECRET`
- `ADMIN_TOKEN` (≥32 chars in production)
- `IP_HASH_SALT`
- `ALLOWED_FRAME_ANCESTORS`
- `OPENAI_API_KEY` (unless `MOCK_EXTERNAL_APIS=1`)
- `SERPER_API_KEY` (only if a `*_search` arm is enabled and not in mock mode)

Study/lockdown switches:

- `ENABLED_CONDITIONS` (default `vanilla_agent,injected_agent`)
- `MOCK_EXTERNAL_APIS` (default off)
- `ADMIN_API_ENABLED` (default off; `/api/admin/*` 404s)
- `AGENT_REPLAY_MS` (default `25000-35000`): per-session total length of the
  AI-overview replay, drawn uniformly from the range and logged as an
  `agent_replay_planned` event

For local development against a local Supabase:

```bash
npx supabase start   # applies supabase/migrations/*, prints SUPABASE_URL + service key
```

Optional model/config vars:

- `CHAT_MODEL`
- `CHAT_TEMPERATURE`
- `CHAT_MAX_TOKENS`
- `EMBEDDING_MODEL`

4. Build corpus artifact (skip in mock mode, which uses the committed
   `app/data/corpus.mock.json`):

```bash
npm run build:corpus
```

This writes `app/data/corpus.json` (gitignored) and takes precedence over the
mock corpus when present.

5. Start dev server:

```bash
npm run dev
```

## Commands

- `npm run dev` — Next dev server
- `npm run build` — production build
- `npm run start` — run production build
- `npm run lint` — ESLint
- `npm test` — Vitest
- `npm run test:e2e` — Playwright E2E
- `npm run build:corpus` — compile corpus from `corpus_sources/*`
- `npm run build:corpus:mock` — same, without embeddings, into `app/data/corpus.mock.json`
- `npm run preview:replay` — preview timeline token replay

## Corpus Workflow

Source-of-truth topic artifacts live under `corpus_sources/<topic_id>/`:

- `topic.md`
- `vanilla/{instance_dump.json,log.json,report.md}`
- `injected/{instance_dump.json,log.json,report.md}`
- `malicious_source.md`

Build pipeline scripts:

- `scripts/compile_timeline.ts`
- `scripts/embed_topics.ts`
- `scripts/build_corpus.ts`
- `scripts/mutate_instance.ts`
- `scripts/preview_replay.ts`

## Researcher Operations

### Condition override (preview)

`/api/session` accepts `condition_override` when either:

- `Authorization: Bearer <ADMIN_TOKEN>`, or
- signed `?token=...` query parameter.

Generate a signed preview URL:

```bash
ADMIN_TOKEN=... npx tsx scripts/sign_preview_url.ts \
  "https://<host>/study" \
  "participant-123" \
  "injected_agent" \
  "topic-fullflow" \
  24
```

### Runtime model config

Admin endpoints require `ADMIN_API_ENABLED=1` (they 404 otherwise). In
production prefer reading data from the Supabase dashboard.

```bash
curl -X POST "https://<host>/api/admin/config" \
  -H "Authorization: Bearer <ADMIN_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"chat_model":"gpt-4o-mini","chat_temperature":0.3,"chat_max_tokens":800,"embedding_model":"text-embedding-3-small","updated_by":"researcher"}'
```

### CSV export

```bash
curl "https://<host>/api/admin/export?table=events&format=csv" \
  -H "Authorization: Bearer <ADMIN_TOKEN>"
```

## Qualtrics integration

Paste [`docs/qualtrics/question.js`](docs/qualtrics/question.js) into the
JavaScript of a Text/Graphic question (setup steps are in the file header). It:

- builds the iframe with `participant_id=${e://Field/ResponseID}` and
  `parent_origin` (so `postMessage` targets only the survey origin),
- resizes the iframe to the study content,
- hides Next until the study posts `study_complete`, then stores
  `study_completion_code` / `study_duration_ms` as embedded data and advances.

Set `ALLOWED_FRAME_ANCESTORS` to your survey's Qualtrics host.

### Topic eligibility

Participants rate their view on each of the candidate topics (0–100) before
the task. The question JS fills `TOPICS` with each topic's ID and the piped
value of its "What's your view on this issue?" slider, and treats topics with
a view in **[25, 75]** as eligible.

- No eligible topic: the study is not loaded; `study_eligible=0` and the
  survey advances (branch on it in the survey flow).
- Otherwise the eligible IDs (not the ratings) go to the study as
  `?eligible=a,b,c`; `/api/session` draws one uniformly at random
  (`lib/topic-selection.ts`) and stores `topic_selection` and
  `eligible_topics` on the session (migration `0004`).
- On completion Qualtrics receives `study_topic_id`, for display logic on
  post-task questions about the assigned topic.

Topic IDs in `TOPICS` must match corpus `topic_id`s. In mock mode the corpus
has placeholder topics `topic_01`…`topic_19` (`corpus_sources/mock_topics.json`).
To fake slider answers in the local harness, add `&views=10,50,90,…`.

Test the embed locally (a fake Qualtrics page on a different origin):

```bash
python3 -m http.server 8080 -d docs/qualtrics
```

with `ALLOWED_FRAME_ANCESTORS=http://localhost:8080` in `.env.local`, then open
`http://localhost:8080/harness.html?study=http://localhost:3000&rid=R_test1`.

## Deploy (Vercel)

1. Import repo into Vercel.
2. Configure all required env vars in project settings.
3. Ensure `ALLOWED_FRAME_ANCESTORS` includes your survey origin(s).
   See `docs/deployment-cornell.md` for account ownership and lockdown steps.
4. Deploy.

`middleware.ts` already handles required iframe CSP/referrer headers.

## Testing Strategy

- **Unit/integration:** Vitest for libs and API routes.
- **E2E:** Playwright specs in `tests/e2e/`.
- Most E2E tests stub API routes to stay deterministic and avoid requiring live
  Supabase/SERPER/OpenAI in CI.

## Notes

- `app/data/corpus.json` is intentionally gitignored; rebuild locally after clone.
- `GET /api/admin/session_summary` is a non-production test helper endpoint.
