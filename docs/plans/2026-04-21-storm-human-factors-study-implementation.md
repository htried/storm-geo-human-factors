# STORM Geo Human Factors Study — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build an iframe-embeddable Next.js site that runs a 2×2 between-subjects human study (vanilla/injected × search/agent), captures rich behavioral data, and hands a completion code back to a parent survey.

**Architecture:** Single Next.js 15 App-Router TypeScript app on Vercel. Server-side API routes proxy SERPER and OpenAI. Supabase Postgres stores sessions/events/chat. An offline Node build pipeline turns CoSTORM runs + hand-authored injected variants into a single in-memory `corpus.json` artifact. Condition assignment is deterministic HMAC on `participant_id`. Agent playback is a pre-compiled "replay timeline" streamed over SSE, then token-streaming the report, then OpenAI chat with the shown report/sources pinned in the system prompt.

**Tech stack:** Next.js 15 (App Router), TypeScript (strict), Tailwind CSS, Vitest (unit), Playwright (e2e, minimal), Zod (runtime validation), `@supabase/supabase-js`, `openai`, `react-markdown` + `remark-gfm`, `tsx` (scripts).

**Reference design doc:** `docs/plans/2026-04-21-storm-human-factors-study-design.md`. Read it before starting.

---

## Working Principles

1. **TDD**: every non-trivial lib/route is test-first. UI components get Playwright smoke tests, not unit tests.
2. **YAGNI**: anything not in the design doc is out of scope. Flag and skip.
3. **DRY**: shared helpers live in `lib/`. API routes are thin wrappers.
4. **Frequent commits**: one logical unit per commit. Conventional-commits style (`feat:`, `fix:`, `test:`, `chore:`).
5. **Server-side secrets only**: no `NEXT_PUBLIC_*` for SERPER/OpenAI/Supabase-service-role/ASSIGN_SECRET/INJECT_SECRET/ADMIN_TOKEN.
6. **Zod at every boundary**: validate every API route input and every external response (SERPER, OpenAI) before using it.

## Phases

1. **Foundation** — scaffold, config, Supabase migration, testing harness.
2. **Core libs (TDD-heavy)** — assignment, injection, corpus+cosine, config.
3. **Session plumbing** — `/api/session`, `/api/events`, `/api/complete` + iframe postMessage bridge.
4. **Search condition** — SERPER client, `/api/search` (with injection), SearchView UI, malicious landing page.
5. **Corpus build pipeline (offline)** — `compile_timeline`, `embed_topics`, `build_corpus`, plus one end-to-end seed topic from `test_data/health_10452`.
6. **Agent condition** — `/api/agent/start`, `/api/agent/stream` (SSE), AgentView UI, skip.
7. **Chat** — `/api/chat` streaming + ChatPanel.
8. **Admin & ops** — `app_config`, `/api/admin/config`, `/api/admin/export`, researcher overrides, iframe CSP.
9. **Polish** — README, env docs, seed script, smoke e2e, deploy config.

Each task below is one commit.

---

## Phase 1 — Foundation

### Task 1: Scaffold Next.js project

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `tailwind.config.ts`, `postcss.config.mjs`, `app/layout.tsx`, `app/page.tsx`, `app/globals.css`, `.gitignore` (append)

**Step 1: Initialize**

Run:
```bash
npx create-next-app@latest . --ts --tailwind --eslint --app --src-dir=false --import-alias="@/*" --no-turbopack --yes
```

**Step 2: Append `.gitignore`**

Append to `.gitignore`:
```
# study artifacts
app/data/corpus.json
corpus_sources/
/.env.local
```

**Step 3: Strict TypeScript**

In `tsconfig.json`, ensure `"strict": true`, `"noUncheckedIndexedAccess": true`, `"noImplicitOverride": true`.

**Step 4: Verify scaffold builds**

Run: `npm run build`
Expected: Successful build, no TS errors.

**Step 5: Commit**

```bash
git add -A
git commit -m "chore: scaffold Next.js 15 app with TS and Tailwind"
```

### Task 2: Install runtime and dev dependencies

**Files:**
- Modify: `package.json`

**Step 1: Install runtime deps**

Run:
```bash
npm install zod @supabase/supabase-js openai react-markdown remark-gfm
```

**Step 2: Install dev deps**

Run:
```bash
npm install -D vitest @vitest/ui @types/node tsx @playwright/test
```

**Step 3: Add scripts to `package.json`**

Add under `"scripts"`:
```json
"test": "vitest run",
"test:watch": "vitest",
"test:e2e": "playwright test",
"build:corpus": "tsx scripts/build_corpus.ts",
"preview:replay": "tsx scripts/preview_replay.ts"
```

**Step 4: Create `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: { environment: "node", globals: false, include: ["**/*.test.ts"] },
  resolve: { alias: { "@": path.resolve(__dirname, ".") } },
});
```

**Step 5: Verify tests run**

Run: `npm test`
Expected: "No test files found" (or zero tests) — no crash.

**Step 6: Commit**

```bash
git add -A
git commit -m "chore: add runtime deps (zod, supabase, openai, markdown) and test harness (vitest, playwright)"
```

### Task 3: Environment variables and config loader

**Files:**
- Create: `lib/env.ts`, `lib/env.test.ts`, `.env.example`

**Step 1: Write failing test** — `lib/env.test.ts`

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadEnv } from "./env";

describe("loadEnv", () => {
  const orig = { ...process.env };
  beforeEach(() => { process.env = { ...orig }; });
  afterEach(() => { process.env = orig; });

  it("throws a descriptive error when required vars missing", () => {
    delete process.env.SERPER_API_KEY;
    expect(() => loadEnv()).toThrow(/SERPER_API_KEY/);
  });

  it("returns defaults for model config when not set", () => {
    Object.assign(process.env, {
      SERPER_API_KEY: "x", OPENAI_API_KEY: "x",
      SUPABASE_URL: "http://x", SUPABASE_SERVICE_ROLE_KEY: "x",
      ASSIGN_SECRET: "x", INJECT_SECRET: "x", ADMIN_TOKEN: "x",
      IP_HASH_SALT: "x", ALLOWED_FRAME_ANCESTORS: "*",
    });
    const env = loadEnv();
    expect(env.CHAT_MODEL).toBe("gpt-4o-mini");
    expect(env.EMBEDDING_MODEL).toBe("text-embedding-3-small");
    expect(env.CHAT_TEMPERATURE).toBeCloseTo(0.3);
    expect(env.CHAT_MAX_TOKENS).toBe(800);
  });
});
```

**Step 2: Run, confirm failure**

Run: `npm test`
Expected: import fails (`./env` doesn't exist).

**Step 3: Implement `lib/env.ts`**

```ts
import { z } from "zod";

const Schema = z.object({
  SERPER_API_KEY: z.string().min(1),
  OPENAI_API_KEY: z.string().min(1),
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  ASSIGN_SECRET: z.string().min(8),
  INJECT_SECRET: z.string().min(8),
  ADMIN_TOKEN: z.string().min(8),
  IP_HASH_SALT: z.string().min(8),
  ALLOWED_FRAME_ANCESTORS: z.string().min(1),
  CHAT_MODEL: z.string().default("gpt-4o-mini"),
  CHAT_TEMPERATURE: z.coerce.number().default(0.3),
  CHAT_MAX_TOKENS: z.coerce.number().int().default(800),
  EMBEDDING_MODEL: z.string().default("text-embedding-3-small"),
});

export type AppEnv = z.infer<typeof Schema>;

let cached: AppEnv | null = null;

export function loadEnv(): AppEnv {
  if (cached) return cached;
  const parsed = Schema.safeParse(process.env);
  if (!parsed.success) {
    const missing = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new Error(`Invalid or missing env vars: ${missing}`);
  }
  cached = parsed.data;
  return cached;
}

export function __resetEnvForTest() { cached = null; }
```

Update test to call `__resetEnvForTest()` in `beforeEach`.

**Step 4: `.env.example`**

```
SERPER_API_KEY=
OPENAI_API_KEY=
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
ASSIGN_SECRET=change-me-32-bytes
INJECT_SECRET=change-me-32-bytes
ADMIN_TOKEN=change-me
IP_HASH_SALT=change-me
ALLOWED_FRAME_ANCESTORS=https://*.qualtrics.com
CHAT_MODEL=gpt-4o-mini
CHAT_TEMPERATURE=0.3
CHAT_MAX_TOKENS=800
EMBEDDING_MODEL=text-embedding-3-small
```

**Step 5: Test passes**

Run: `npm test`
Expected: PASS.

**Step 6: Commit**

```bash
git add -A
git commit -m "feat(env): add zod-validated env loader with model-config defaults"
```

### Task 4: Supabase migration

**Files:**
- Create: `supabase/migrations/0001_init.sql`
- Create: `supabase/README.md`

**Step 1: Write `0001_init.sql`** exactly matching the design doc's data layer section (tables `participants`, `sessions`, `events`, `chat_messages`, `search_cache`, `app_config`, plus indexes).

```sql
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
```

**Step 2: README stub (`supabase/README.md`)**

Explain how to apply the migration via Supabase CLI (`supabase db push`) or by pasting into the SQL editor.

**Step 3: Commit**

```bash
git add -A
git commit -m "feat(db): add initial Supabase migration"
```

### Task 5: Supabase client helper

**Files:**
- Create: `lib/supabase.ts`, `lib/supabase.test.ts`

**Step 1: Failing test**

```ts
import { describe, it, expect } from "vitest";
import { getSupabase } from "./supabase";

describe("getSupabase", () => {
  it("returns a singleton", () => {
    process.env.SUPABASE_URL = "http://localhost";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "x";
    const a = getSupabase();
    const b = getSupabase();
    expect(a).toBe(b);
  });
});
```

Run: fail.

**Step 2: Implement `lib/supabase.ts`**

```ts
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { loadEnv } from "./env";

let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (client) return client;
  const env = loadEnv();
  client = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return client;
}

export function __resetSupabaseForTest() { client = null; }
```

**Step 3: Test passes.** Commit.

```bash
git commit -am "feat(db): add supabase server-side client helper"
```

---

## Phase 2 — Core libraries (TDD-heavy)

### Task 6: Condition assignment (HMAC)

**Files:**
- Create: `lib/assignment.ts`, `lib/assignment.test.ts`

**Step 1: Tests**

```ts
import { describe, it, expect } from "vitest";
import { assignCondition, CONDITIONS } from "./assignment";

const SECRET = "test-secret-that-is-long-enough";

describe("assignCondition", () => {
  it("returns one of the four conditions", () => {
    const c = assignCondition("p1", SECRET);
    expect(CONDITIONS).toContain(c);
  });

  it("is deterministic", () => {
    expect(assignCondition("p1", SECRET)).toBe(assignCondition("p1", SECRET));
  });

  it("distributes roughly evenly over 4 buckets across 4000 ids", () => {
    const counts: Record<string, number> = {};
    for (let i = 0; i < 4000; i++) {
      const c = assignCondition(`p${i}`, SECRET);
      counts[c] = (counts[c] ?? 0) + 1;
    }
    for (const c of CONDITIONS) {
      expect(counts[c]).toBeGreaterThan(800); // ~1000 each; loose bound
      expect(counts[c]).toBeLessThan(1200);
    }
  });

  it("differs across different secrets", () => {
    const a = assignCondition("p1", SECRET);
    const b = assignCondition("p1", SECRET + "-other");
    // Not strictly required they differ (1/4 chance same) but we pick a case that does:
    // Seed with two participant IDs to ensure at least one differs:
    const any = [0, 1, 2, 3].some((i) =>
      assignCondition(`q${i}`, SECRET) !== assignCondition(`q${i}`, SECRET + "-other")
    );
    expect(any).toBe(true);
  });
});
```

**Step 2: Implementation**

```ts
import { createHmac } from "node:crypto";

export const CONDITIONS = [
  "vanilla_search",
  "injected_search",
  "vanilla_agent",
  "injected_agent",
] as const;
export type Condition = (typeof CONDITIONS)[number];

export function assignCondition(participantId: string, secret: string): Condition {
  const hmac = createHmac("sha256", secret).update(participantId).digest();
  const idx = hmac.readUInt32BE(0) % CONDITIONS.length;
  return CONDITIONS[idx]!;
}
```

**Step 3: Tests pass. Commit.**

```bash
git commit -am "feat(assignment): HMAC-deterministic 4-way condition assignment"
```

### Task 7: Injection slot picker

**Files:**
- Create: `lib/injection.ts`, `lib/injection.test.ts`

**Step 1: Tests**

```ts
import { describe, it, expect } from "vitest";
import { pickInjectionSlot, applyInjection } from "./injection";

describe("pickInjectionSlot", () => {
  it("returns a number in [0, n)", () => {
    for (let n = 1; n <= 10; n++) {
      const slot = pickInjectionSlot("s", "q", "secret-long-enough", n);
      expect(slot).toBeGreaterThanOrEqual(0);
      expect(slot).toBeLessThan(n);
    }
  });

  it("is deterministic per (session, query, secret)", () => {
    const a = pickInjectionSlot("s1", "q1", "sec-key-1234", 10);
    const b = pickInjectionSlot("s1", "q1", "sec-key-1234", 10);
    expect(a).toBe(b);
  });

  it("differs when session or query changes (in aggregate)", () => {
    const distinct = new Set<number>();
    for (let i = 0; i < 50; i++) distinct.add(pickInjectionSlot(`s${i}`, "q", "sec-key-1234", 10));
    expect(distinct.size).toBeGreaterThan(3);
  });
});

describe("applyInjection", () => {
  const mal = { title: "M", url: "u", displayed_url: "d", snippet: "s", rank: -1 };
  it("replaces the correct slot and updates ranks", () => {
    const results = Array.from({ length: 5 }, (_, i) => ({
      title: `t${i}`, url: `u${i}`, displayed_url: `d${i}`, snippet: `s${i}`, rank: i,
    }));
    const out = applyInjection(results, mal, 2);
    expect(out[2]!.title).toBe("M");
    expect(out[2]!.rank).toBe(2);
    expect(out[0]!.title).toBe("t0");
    expect(out.length).toBe(5);
  });

  it("is a no-op for empty arrays", () => {
    expect(applyInjection([], mal, 0)).toEqual([]);
  });
});
```

**Step 2: Implementation**

```ts
import { createHmac } from "node:crypto";

export function pickInjectionSlot(sessionId: string, query: string, secret: string, n: number): number {
  if (n <= 1) return 0;
  const hmac = createHmac("sha256", secret).update(`${sessionId}|${query}`).digest();
  return hmac.readUInt32BE(0) % n;
}

export interface SearchResult {
  title: string;
  url: string;
  displayed_url: string;
  snippet: string;
  rank: number;
}

export interface MaliciousSource extends Omit<SearchResult, "rank"> {}

export function applyInjection(results: SearchResult[], mal: MaliciousSource, slot: number): SearchResult[] {
  if (results.length === 0) return results;
  const out = results.slice();
  out[slot] = { ...mal, rank: slot };
  return out;
}
```

**Step 3: Commit.**

```bash
git commit -am "feat(injection): deterministic slot picker + injection applier"
```

### Task 8: Corpus types and cosine similarity

**Files:**
- Create: `lib/corpus.ts`, `lib/corpus.test.ts`, `lib/corpus-types.ts`

**Step 1: Tests**

```ts
import { describe, it, expect } from "vitest";
import { cosine, findNearestTopic } from "./corpus";
import type { Corpus } from "./corpus-types";

describe("cosine", () => {
  it("returns 1 for identical vectors", () => {
    expect(cosine([1, 0, 0], [1, 0, 0])).toBeCloseTo(1);
  });
  it("returns 0 for orthogonal", () => {
    expect(cosine([1, 0], [0, 1])).toBeCloseTo(0);
  });
  it("throws on mismatched lengths", () => {
    expect(() => cosine([1], [1, 2])).toThrow();
  });
});

const CORPUS: Corpus = {
  version: "test",
  embedding_model: "m",
  topics: [
    { topic_id: "a", topic_text: "a", topic_embedding: [1, 0, 0], vanilla_timeline: {} as any, injected_timeline: {} as any, malicious_source: {} as any },
    { topic_id: "b", topic_text: "b", topic_embedding: [0, 1, 0], vanilla_timeline: {} as any, injected_timeline: {} as any, malicious_source: {} as any },
  ],
};

describe("findNearestTopic", () => {
  it("returns top-1 with similarity", () => {
    const r = findNearestTopic(CORPUS, [0.9, 0.1, 0]);
    expect(r.topic.topic_id).toBe("a");
    expect(r.similarity).toBeGreaterThan(0.9);
  });

  it("throws on empty corpus", () => {
    expect(() => findNearestTopic({ ...CORPUS, topics: [] }, [1, 0, 0])).toThrow(/empty/i);
  });
});
```

**Step 2: Implement `lib/corpus-types.ts`**

Mirror the schema from the design doc (Corpus, Topic, Timeline, MaliciousSource, Step). Export Zod schemas and inferred TS types.

**Step 3: Implement `lib/corpus.ts`**

```ts
import fs from "node:fs";
import path from "node:path";
import type { Corpus, Topic } from "./corpus-types";

export function cosine(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length) throw new Error("vector length mismatch");
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / Math.sqrt(na * nb);
}

export function findNearestTopic(corpus: Corpus, query: readonly number[]): { topic: Topic; similarity: number } {
  if (corpus.topics.length === 0) throw new Error("corpus is empty");
  let best = corpus.topics[0]!;
  let bestSim = -Infinity;
  for (const t of corpus.topics) {
    const s = cosine(t.topic_embedding, query);
    if (s > bestSim) { bestSim = s; best = t; }
  }
  return { topic: best, similarity: bestSim };
}

let cached: Corpus | null = null;
export async function loadCorpus(): Promise<Corpus> {
  if (cached) return cached;
  const p = path.join(process.cwd(), "app", "data", "corpus.json");
  const raw = await fs.promises.readFile(p, "utf8");
  cached = JSON.parse(raw) as Corpus;
  return cached;
}

export function __resetCorpusForTest() { cached = null; }
```

**Step 4: Commit.**

```bash
git commit -am "feat(corpus): types + cosine similarity + in-memory loader"
```

### Task 9: `app_config` cache + reader

**Files:**
- Create: `lib/config.ts`, `lib/config.test.ts`

Same pattern: test-first. A single `getAppConfig()` that fetches the singleton row from Supabase, caches for 30s, falls back to env defaults if the row is missing. Unit test mocks Supabase.

Commit: `feat(config): app_config reader with 30s in-memory cache and env fallback`.

### Task 10: Event logger helper

**Files:**
- Create: `lib/events.ts`, `lib/events.test.ts`

Implements `logEvent({sessionId, t_ms, type, payload})`. Uses Supabase to insert into `events`. Batches: exposes `logEvents(rows[])` for bulk. Unit test mocks the Supabase insert and asserts the correct payload.

Commit: `feat(events): server-side event logger`.

---

## Phase 3 — Session plumbing

### Task 11: `POST /api/session` — create or resume

**Files:**
- Create: `app/api/session/route.ts`, `app/api/session/route.test.ts`

Behavior (derived from design doc):
- Input: `{ participant_id, topic_id?, condition_override?, user_agent, referrer }`.
- If `sessions` row exists for `participant_id`, return it (idempotent).
- Else: upsert `participants`, compute condition (HMAC or from override w/ admin token), pick `topic_id` (from input or random from corpus topics), insert `sessions` row with snapshotted model config.
- Return `{ session_id, condition, topic_id, topic_text }`.

Tests:
- New participant creates session with HMAC condition.
- Duplicate participant returns same session (idempotent).
- `condition_override` rejected without admin token.
- `condition_override` accepted with valid admin token; `assigned_by = 'researcher_override'`.
- Missing `participant_id` → 400.

Commit: `feat(api): POST /api/session with idempotent create-or-resume`.

### Task 12: `POST /api/events` — bulk ingest

**Files:**
- Create: `app/api/events/route.ts`, `app/api/events/route.test.ts`

Input: `{ session_id, events: [{t_ms, type, payload}] }`. Validate session exists, insert all rows in one Supabase insert. Cap batch at 100. Return `{ inserted: number }`.

Tests: valid batch, unknown session → 404, oversized batch → 400, empty batch → 200 with inserted=0.

Commit: `feat(api): POST /api/events bulk ingestion`.

### Task 13: `POST /api/complete`

**Files:**
- Create: `app/api/complete/route.ts`, `app/api/complete/route.test.ts`
- Create: `lib/completion.ts` (generator for 8-char code), `lib/completion.test.ts`

Input: `{ session_id }`. Set `completed_at = now()`. Generate completion code (crypto-random 8 chars, uppercase alphanumeric excluding O/0/I/1). Store and return it. Idempotent (returns existing code on re-call).

Commit: `feat(api): POST /api/complete with stable completion code`.

### Task 14: Iframe bridge hook

**Files:**
- Create: `app/study/_hooks/useIframeBridge.ts`

Exposes `postComplete({participant_id, completion_code, duration_ms})`, `postHeartbeat()`, `postResize(height)` — all wrapping `window.parent.postMessage`. Also exports a `useResizeObserver` that wires `postResize` on content-height change. No unit tests (thin wrapper), covered in Playwright smoke.

Commit: `feat(study): iframe postMessage bridge hook`.

### Task 15: Client event logger hook

**Files:**
- Create: `app/study/_hooks/useEventLogger.ts`

Buffers events client-side; flushes via `navigator.sendBeacon('/api/events', ...)` every 3s, on buffer ≥ 20 events, on visibility change, and on unload. Exposes `logEvent(type, payload?)`. Integrates `t_ms` relative to session start (passed in as prop).

Commit: `feat(study): client event logger with beacon flush`.

### Task 16: `/study` page skeleton (consent + condition routing + completion)

**Files:**
- Create: `app/study/page.tsx`, `app/study/_components/ConsentPanel.tsx`, `app/study/_components/CompletionPanel.tsx`, `app/study/_components/ErrorPanel.tsx`

Behavior:
1. Server component reads URL search params. Calls `/api/session` via `fetch` (server-side) to get `{session_id, condition, topic_text}`.
2. Renders a client shell that:
   - Shows `ConsentPanel` with topic text and "Begin" button.
   - After Begin, routes to one of four `ConditionView` stubs based on condition. For now they're placeholder panels that say which condition they are.
   - Shows `CompletionPanel` with "Research complete" that calls `/api/complete` and fires `postComplete`.

Commit: `feat(study): page skeleton with consent, condition routing, completion`.

### Task 17: Playwright smoke test for session + completion

**Files:**
- Create: `e2e/study-skeleton.spec.ts`, `playwright.config.ts`

Tests:
- Hitting `/study?participant_id=playwright-1` shows consent panel with topic text.
- Clicking Begin shows a placeholder condition panel.
- Clicking "Research complete" triggers a postMessage captured via `page.evaluate` listener.

(Requires a dev Supabase or test-double; document in `README.md` how to run e2e.)

Commit: `test(e2e): smoke test for study skeleton`.

---

## Phase 4 — Search condition

### Task 18: SERPER client

**Files:**
- Create: `lib/serper.ts`, `lib/serper.test.ts`

`searchSerper({query, page})` → returns `{results: SearchResult[]}`. Uses `fetch` to `https://google.serper.dev/search` with header `X-API-KEY`. Maps `organic` array into `SearchResult`. Zod-validates response shape.

Tests: mock `fetch` via Vitest, assert headers, payload, and mapping. Error case: non-2xx throws. Empty `organic` → empty array.

Commit: `feat(serper): SERPER client with zod validation`.

### Task 19: Search cache

**Files:**
- Create: `lib/search_cache.ts`, `lib/search_cache.test.ts`

`getCached({query, page})`, `setCached({query, page, raw_results, ttlMs})`. Key = `sha256(query|page)`. Honors `expires_at`.

Commit: `feat(search): Postgres-backed search cache with 24h TTL`.

### Task 20: `POST /api/search`

**Files:**
- Create: `app/api/search/route.ts`, `app/api/search/route.test.ts`

Logic per design doc Section 3:
1. Load session → condition, topic_id.
2. Check cache; on miss call SERPER and populate cache.
3. If `injected_search` and `page == 1` and results non-empty: load `malicious_source` from corpus for that topic, pick slot via `pickInjectionSlot`, apply.
4. Log `search_results_served` event.
5. Return `{results, total_pages: 5, injected_rank?}` where `injected_rank` is omitted unless admin preview flag is set.

Tests: vanilla path, injected path on p1 (asserts slot is one of results and rank updated), no injection on p2, zero-results path, SERPER 500 → 502.

Commit: `feat(api): POST /api/search with injection for injected_search condition`.

### Task 21: Malicious landing page route

**Files:**
- Create: `app/ext/[topic_id]/[slug]/page.tsx`, `app/ext/[topic_id]/[slug]/_layout.tsx` (custom header simulating external domain)

Server component reads topic/slug, loads `malicious_source` from corpus. Renders `landing_markdown` via `react-markdown`. Renders a fake browser-style URL bar showing `displayed_url`. Logs `malicious_source_clicked` via a fire-and-forget API call (needs `session_id` in query string from the click handler in `SearchView`).

Commit: `feat(ext): malicious-landing page renderer`.

### Task 22: `SearchView` component

**Files:**
- Create: `app/study/_components/SearchView.tsx`, `app/study/_components/SearchResults.tsx`, `app/study/_components/SearchPagination.tsx`

Google-like layout, Tailwind. Submits to `/api/search`, renders results, wires click logging (intercept with `onClick` that logs then sets `window.open`). Pagination client-side; page change logs `page_changed` event. Dwell ticker logs `dwell_tick` every 10s while `document.visibilityState === 'visible'`.

Commit: `feat(study): SearchView UI with pagination and click logging`.

### Task 23: Wire SearchView into study page and add e2e

**Files:**
- Modify: `app/study/page.tsx` (replace placeholder for `vanilla_search` and `injected_search`)
- Create: `e2e/search-condition.spec.ts`

E2E: force condition via researcher override, submit a query, assert 10 result cards, click a result, assert event post was made.

Commit: `feat(study): wire SearchView + e2e coverage`.

---

## Phase 5 — Corpus build pipeline

### Task 24: Timeline compiler

**Files:**
- Create: `scripts/compile_timeline.ts`, `scripts/compile_timeline.test.ts`

Input: paths to `instance_dump.json`, `log.json`, `report.md`, plus `targetDurationMs` (default 30_000). Output: `{steps, report_tokens, citations}` matching `lib/corpus-types.ts`.

Test against `test_data/health_10452/` to produce a plausible compiled timeline: assert ≥ 4 step types present, total duration ≤ target, `report_tokens.join("")` equals the raw report content, every `[n]` in report resolves in `citations`.

Commit: `feat(build): compile CoSTORM run into replay timeline`.

### Task 25: Topic embedder

**Files:**
- Create: `scripts/embed_topics.ts`, `scripts/embed_topics.test.ts`

Reads a `topics.json` (intermediate artifact), batches calls to OpenAI Embeddings, writes `topic_embedding` back. Idempotent: skips topics whose `topic_text + embedding_model` is unchanged from last run (store hash alongside the embedding). Mock OpenAI in tests.

Commit: `feat(build): idempotent topic embedder`.

### Task 26: Corpus builder orchestrator

**Files:**
- Create: `scripts/build_corpus.ts`, `scripts/build_corpus.test.ts`

Reads `corpus_sources/<topic_id>/{topic.md, vanilla/, injected/, malicious_source.md}`. Calls `compile_timeline` twice per topic. Calls `embed_topics`. Validates with `CorpusSchema`. Writes `app/data/corpus.json`.

Integration test builds a tiny corpus of one topic from `test_data/health_10452/` + a hand-crafted `malicious_source.md` under `corpus_sources/test_seed/` fixture; asserts output validates and `loadCorpus()` can consume it.

Commit: `feat(build): corpus builder orchestrator + seed topic`.

### Task 27: Seed topic from `test_data/health_10452`

**Files:**
- Create: `corpus_sources/health_scars_seed/topic.md`, `corpus_sources/health_scars_seed/vanilla/*` (copy from `test_data/health_10452`), `corpus_sources/health_scars_seed/injected/*` (placeholder variant — copy vanilla report and manually swap one `cited_info` block with a fake "authoritative" source and insert a target claim), `corpus_sources/health_scars_seed/malicious_source.md`.

Run `npm run build:corpus`; commit the generated `app/data/corpus.json` as well (temporarily, for dev ergonomics; if it grows, flip to gitignored per `.gitignore`).

Actually: keep `app/data/corpus.json` gitignored (as set in Task 1). Document in README that devs run `npm run build:corpus` after cloning.

Commit: `feat(corpus): seed topic using test_data/health_10452 as vanilla source`.

### Task 28: `mutate_instance.ts` and `preview_replay.ts`

**Files:**
- Create: `scripts/mutate_instance.ts`, `scripts/preview_replay.ts`

`mutate_instance.ts`: CLI tool that reads a vanilla `instance_dump.json`, applies a YAML/JSON patch (e.g., `{replace_cited_info: [{n: 3, with: {url, title, snippet}}], append_claim: "..."}`) and writes the modified dump + report.md.

`preview_replay.ts`: CLI that loads `corpus.json`, takes `(topic_id, condition)`, and prints the compiled timeline + streams the report tokens to stdout at real timings for human review.

Commit: `feat(build): authoring helpers (mutate_instance, preview_replay)`.

---

## Phase 6 — Agent condition

### Task 29: OpenAI embedding client

**Files:**
- Create: `lib/openai.ts`, `lib/openai.test.ts`

`embedQuery(text, model)` → `number[]`. Thin wrapper around `openai.embeddings.create`. Mock in tests.

Commit: `feat(openai): query embedding helper`.

### Task 30: `POST /api/agent/start`

**Files:**
- Create: `app/api/agent/start/route.ts`, `app/api/agent/start/route.test.ts`

Behavior:
1. Load session → condition, topic_id.
2. Embed query.
3. `findNearestTopic(corpus, embedding)` → `(topic, similarity)`.
4. Update session with `matched_topic_id`, `matched_similarity`, `embedding_model_used`, `chat_model_used`, `chat_temperature_used`.
5. Log `agent_topic_matched` event.
6. Return `{stream_url, matched_topic_id, expected_duration_ms}`.

Tests: happy path, wrong-condition session → 400, embedding failure → 503.

Commit: `feat(api): POST /api/agent/start`.

### Task 31: `GET /api/agent/stream` — SSE replay + token streaming

**Files:**
- Create: `app/api/agent/stream/route.ts`, `app/api/agent/stream/route.test.ts`

Implementation notes:
- Use `NextResponse` returning a `ReadableStream<Uint8Array>` with `Content-Type: text/event-stream`, `Cache-Control: no-cache, no-transform`, `Connection: keep-alive`.
- Stream phases:
  1. Write a `ready` event with total step count + expected duration.
  2. For each step, `await setTimeout(step.t_ms - prev.t_ms)` then write `data: {step}` event.
  3. After steps, for each token, write `data: {token}` event, then sleep 20–40ms jittered.
  4. Write `done` event and close.
- Respect `?resume_from=<t_ms>`: skip steps whose `t_ms < resume_from`, start streaming at next.
- Respect `AbortSignal` from request.

Test: synthetic tiny timeline (2 steps + 3 tokens), collect SSE events and assert order + content. Use `Response.body` reader. Don't assert timings in CI (flaky); assert monotonic timestamps instead.

Commit: `feat(api): SSE agent replay + report streaming`.

### Task 32: `POST /api/agent/skip`

**Files:**
- Create: `app/api/agent/skip/route.ts`

Marks in the session that skip was used and logs `agent_skip_used`. The client uses this as a signal to stop consuming SSE and fetch the complete report in one shot (via `/api/agent/report`), which we'll add:

- Create: `app/api/agent/report/route.ts` — returns `{report_tokens, citations, sources}` for the matched topic + session condition.

Commit: `feat(api): agent skip and full-report fetch`.

### Task 33: `AgentView` UI

**Files:**
- Create: `app/study/_components/AgentView.tsx`, `app/study/_components/AgentActivity.tsx`, `app/study/_components/AgentReport.tsx`

Layout: 2-column (activity | report). Activity panel renders an ordered list of step cards with step-type-specific styling. Report panel progressively renders markdown from streamed tokens using `react-markdown` over `accumulatedText` state. Citations `[n]` are clickable superscripts tied to the `citations` array rendered at the bottom. "Skip simulation" button wires to `/api/agent/skip`.

Commit: `feat(study): AgentView with activity panel + live markdown report`.

### Task 34: Wire AgentView + e2e

**Files:**
- Modify: `app/study/page.tsx`
- Create: `e2e/agent-condition.spec.ts`

E2E: force agent condition, submit query, assert activity panel shows ≥ 1 step, assert report content appears.

Commit: `feat(study): wire AgentView + e2e coverage`.

---

## Phase 7 — Chat

### Task 35: `POST /api/chat` — SSE streaming

**Files:**
- Create: `app/api/chat/route.ts`, `app/api/chat/route.test.ts`

Builds system prompt from shown report + sources (vanilla or injected per session). Persists user turn before calling OpenAI. Streams tokens via SSE. Persists assistant turn after stream completes. Honors `app_config` (cached reader).

Tests: mock OpenAI streaming, assert DB writes, assert event logging.

Commit: `feat(api): streaming chat with report+sources pinned in system prompt`.

### Task 36: `ChatPanel` UI

**Files:**
- Create: `app/study/_components/ChatPanel.tsx`

Appears beneath the agent report after streaming completes (`onReportDone` prop). Input + send button. Renders messages in standard chat-bubble layout. Streams responses token-by-token into the latest assistant bubble. Retry button on error.

Commit: `feat(study): ChatPanel with streaming responses`.

### Task 37: Wire chat into AgentView + e2e

**Files:**
- Modify: `app/study/_components/AgentView.tsx`
- Create: `e2e/chat.spec.ts`

Commit: `feat(study): wire chat panel + e2e`.

---

## Phase 8 — Admin, CSP, overrides

### Task 38: `POST /api/admin/config`

**Files:**
- Create: `app/api/admin/config/route.ts`, `app/api/admin/config/route.test.ts`

Gated by `Authorization: Bearer <ADMIN_TOKEN>`. Accepts partial payload; upserts into `app_config`. Returns new row. Invalidates in-memory cache.

Commit: `feat(admin): POST /api/admin/config for runtime model config`.

### Task 39: `GET /api/admin/export`

**Files:**
- Create: `app/api/admin/export/route.ts`, `app/api/admin/export/route.test.ts`

Admin-gated. `?table=events|sessions|chat_messages&format=csv`. Streams CSV response. Tests: auth gate, shape of CSV header, row streaming.

Commit: `feat(admin): CSV export endpoint`.

### Task 40: Researcher `?condition=` override

**Files:**
- Modify: `app/api/session/route.ts` — accept `condition_override` iff the request carries `Authorization: Bearer <ADMIN_TOKEN>` **or** a pre-signed `token` query param (HMAC of `participant_id|condition` using `ADMIN_TOKEN`, expiring in 24h).
- Create: `scripts/sign_preview_url.ts` — CLI to mint a signed preview URL.

Tests in `app/api/session/route.test.ts` for both paths.

Commit: `feat(admin): pre-signed researcher preview URLs`.

### Task 41: Iframe CSP + responsive sizing

**Files:**
- Create: `middleware.ts`
- Modify: `app/layout.tsx` to include iframe bridge provider and the resize observer

`middleware.ts` sets `Content-Security-Policy: frame-ancestors <env.ALLOWED_FRAME_ANCESTORS>; Referrer-Policy: strict-origin-when-cross-origin` on `/study` and `/ext/*` responses.

Tests: request `/study` with mocked response headers assertion (`next-test-utils` pattern) or lightweight integration using `next dev` + Playwright's `page.request.head()`.

Commit: `feat(security): CSP frame-ancestors and referrer policy on iframe routes`.

---

## Phase 9 — Polish

### Task 42: README

**Files:**
- Modify: `README.md` (overwrite)

Sections: overview, local setup (node, env, supabase, corpus build), build commands, deploy (Vercel env vars), researcher ops (preview URL, condition override, CSV export, config endpoint), integration snippet for Qualtrics.

Commit: `docs: comprehensive README`.

### Task 43: Vercel config

**Files:**
- Create: `vercel.json` (if needed for headers/regions)

Note: most header work is in `middleware.ts`; `vercel.json` only if we need region pinning or edge-runtime declarations.

Commit: `chore: vercel configuration`.

### Task 44: Full-flow Playwright e2e

**Files:**
- Create: `e2e/full-flow.spec.ts`

For each of the 4 conditions (via researcher override):
1. Enter with participant_id.
2. See consent. Begin.
3. Execute the condition-specific interaction.
4. Send one chat turn (agent conditions only).
5. Complete.
6. Assert postMessage received.
7. Assert session row + events in DB (via a small `/api/admin/session_summary` test-only endpoint guarded by `NODE_ENV !== "production"`).

Commit: `test(e2e): full-flow coverage across all 4 conditions`.

### Task 45: Final manual-QA checklist

**Files:**
- Create: `docs/qa-checklist.md`

Ordered list of manual checks a researcher can run before deploying: each condition reachable, injected source appears exactly once on p1 in injected search, streaming actually streams (not batched), skip works, chat maintains injected bias, completion code round-trips to parent survey, CSV export loads in analysis notebook, condition distribution looks balanced across ~40 test participants.

Commit: `docs: manual QA checklist`.

---

## Out of scope (confirm with researcher before adding)

- Admin UI (API-only in v1).
- Hot-swappable corpus via Vercel Blob (corpus lives in-repo build artifact in v1).
- Non-English topics.
- Mobile-optimized layout (desktop-only for v1, acceptable for most survey panels).
- Per-topic chat-model override.

## Open items the researcher must provide before going live

- Final list of study topics + their framings (`topic.md` per folder).
- `malicious_source.md` per topic: realistic fake-domain title, displayed URL, snippet, and landing-page markdown that embodies the target claim.
- Injected variants of the CoSTORM runs (either new CoSTORM runs biased toward the target claim, or hand-authored by mutating the vanilla run with `scripts/mutate_instance.ts`).
- Consent/intro and completion-screen copy.
- Final value for `ALLOWED_FRAME_ANCESTORS`.

---

## Execution

Plan complete and saved to `docs/plans/2026-04-21-storm-human-factors-study-implementation.md`. Two execution options:

**1. Subagent-Driven (this session)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Parallel Session (separate)** — Open a new session with `executing-plans`, batch execution with checkpoints.

Which approach?
