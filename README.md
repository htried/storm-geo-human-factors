# Storm Human Factors Study

Next.js 15 app for controlled human-factors study conditions:

- `vanilla_search`
- `injected_search`
- `vanilla_agent`
- `injected_agent`

The app runs inside an iframe (`/study`) and records participant interaction
events plus completion code handoff via `postMessage`.

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
- **Security**
  - `middleware.ts` sets CSP `frame-ancestors` and referrer policy on `/study` and `/ext/*`.

## Requirements

- Node.js 20+ (project currently runs on newer Node without issue).
- npm 10+.
- Supabase project with migration in `supabase/migrations/0001_init.sql` applied.

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
- `SERPER_API_KEY`
- `OPENAI_API_KEY`
- `ASSIGN_SECRET`
- `INJECT_SECRET`
- `ADMIN_TOKEN`
- `IP_HASH_SALT`
- `ALLOWED_FRAME_ANCESTORS`

Optional model/config vars:

- `CHAT_MODEL`
- `CHAT_TEMPERATURE`
- `CHAT_MAX_TOKENS`
- `EMBEDDING_MODEL`

4. Build corpus artifact:

```bash
npm run build:corpus
```

This writes `app/data/corpus.json` (gitignored).

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

## Qualtrics (or parent survey) integration

Load iframe:

```html
<iframe
  id="studyFrame"
  src="https://<host>/study?participant_id=${participant_id}"
  style="width:100%;height:900px;border:0"
></iframe>
```

Listen for completion:

```js
window.addEventListener("message", (e) => {
  if (!e?.data || e.data.source !== "storm-study") return;
  if (e.data.type === "study_complete") {
    // e.data.completion_code, e.data.duration_ms, e.data.participant_id
  }
});
```

For tighter `postMessage` targeting, append `parent_origin=<survey_origin>` to the
iframe URL.

## Deploy (Vercel)

1. Import repo into Vercel.
2. Configure all required env vars in project settings.
3. Ensure `ALLOWED_FRAME_ANCESTORS` includes your survey origin(s).
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
