# STORM Human Factors Study — Execution Handoff

This doc hands off execution of the implementation plan from the initial
subagent-driven session (which completed Phase 1) to a new session that will
execute the remaining phases using the `superpowers:executing-plans` skill.

## Where to start

1. **Plan to execute**: `docs/plans/2026-04-21-storm-human-factors-study-implementation.md`
2. **Design reference** (read-only context): `docs/plans/2026-04-21-storm-human-factors-study-design.md`
3. **Working tree**: `/Users/haltriedman/code/storm-human-factors-impl`
4. **Branch**: `feat/human-factors-study` (worktree, not pushed; do NOT push to origin without user approval)
5. **Base branch**: `main` at the sibling repo `/Users/haltriedman/code/storm-geo-human-factors`

## Completed so far (Phase 1 — Foundation)

Commits on `feat/human-factors-study` (oldest → newest):

| Task | Commit | Message |
|------|--------|---------|
| T1 | `d189db6` | `chore: scaffold Next.js 15 app with TS and Tailwind` |
| T2 | `827045d` | `chore: add runtime deps (zod, supabase, openai, markdown) and test harness (vitest, playwright)` |
| T3 | `5c20e7a` | `feat(env): add zod-validated env loader with model-config defaults` |
| T3 fix | `50be587` | `fix(env): treat empty strings as unset so defaults apply; add coverage for invalid URL` |
| T4 | `151e459` | `feat(db): add initial Supabase migration` |
| — | `6fb274b` | Duplicate of T3 fix (stray commit from a Cursor auto-commit; cosmetic, safe to squash at merge) |
| T5 | `8422632` | `feat(db): add supabase server-side client helper` |

**Status checks at handoff:**

- `npm run build` → clean (Next 15.5.15)
- `npm test` → `Tests 7 passed (7)` (2 env + 3 env fix + 2 supabase)
- `.env` is populated with real `SERPER_API_KEY` and `OPENAI_API_KEY` (copied from main repo). Supabase creds and study secrets still need to be filled in before API routes will run, but libs compile and unit tests pass without them.
- `test_data/` is a symlink to `../storm-geo-human-factors/test_data/` and is intentionally untracked. Subagents occasionally stage it via `git add -A`; prefer explicit path staging (`git add -- path/`).

## Remaining phases (Tasks 6-45)

- **Phase 2 — Core libs (TDD)**: Tasks 6-10 — HMAC assignment, injection picker, corpus types + cosine, app_config cache, event logger
- **Phase 3 — Session plumbing**: Tasks 11-17
- **Phase 4 — Search condition**: Tasks 18-23
- **Phase 5 — Corpus build pipeline**: Tasks 24-28
- **Phase 6 — Agent condition**: Tasks 29-34
- **Phase 7 — Chat**: Tasks 35-37
- **Phase 8 — Admin & ops**: Tasks 38-41
- **Phase 9 — Polish**: Tasks 42-45
- Final full-implementation code review

## Execution policy (agreed with user)

**Selective review rigor** (do not re-ask):

- **Full rigor** (implementer + spec reviewer + code-quality reviewer, with fix loops until no Critical/Important issues): core libs, API routes, security-critical tasks — i.e., Tasks 6, 7, 8, 9, 10, 11, 12, 13, 18, 19, 20, 22, 24, 25, 26, 29, 30, 31, 32, 33, 35, 36, 38, 39, 40, 41.
- **Light review** (implementer + spec reviewer only, skip code-quality unless implementer flagged concerns): mechanical tasks like config files, markdown docs, fixture data, one-off wiring — i.e., Tasks 21, 23, 27, 28, 34, 37, 42, 43, 44, 45.
- Controller may self-verify (Grep + Read + `npm test`) in lieu of a reviewer subagent for copy-paste tasks.

**Reporting cadence**: full implementer + reviewer reports in-line to the user (user's current preference).

**Commits**: one commit per task by default; amend only per the standard amend rules (commit created in session, not pushed, HEAD created by the same subagent). `Made-with: Cursor` trailer in commit bodies is tooling-added — accept it, do not re-amend to remove.

**Git hygiene**: always stage explicitly (`git add -- <paths>`), never `git add -A`, to avoid catching the `test_data` symlink.

## Known gotchas

- **Zod 4** is installed (not 3). `z.preprocess(fn, schema)` works. `z.coerce.number()` on empty string returns 0, not NaN — `lib/env.ts` handles this via an `emptyToUndefined` preprocessor. Apply the same pattern for any new defaulted numeric env vars.
- **Next.js 15.5** scaffold uses **Tailwind v4** (CSS-based `@import "tailwindcss"`). The `tailwind.config.ts` is present for plan compliance but Tailwind v4 does not consume it. Do not rely on tailwind.config.ts `theme`/`plugins` taking effect.
- **`app/` is at repo root** (no `src/` directory). Plan's file paths (`app/api/session/route.ts`, etc.) are correct.
- **`.gitignore` `!/lib/`** negation: the repo's pre-existing Python-style `.gitignore` ignores `lib/`; this is carved out at the repo root. Do not remove that negation line or any `lib/*.ts` files will silently disappear from git.
- **Vitest `include: ["**/*.test.ts"]`** — test files live next to their modules (e.g., `lib/env.test.ts` next to `lib/env.ts`). Keep this pattern for all new lib tests.

## Handoff protocol

1. New session: invoke `superpowers:executing-plans`.
2. Plan file: `docs/plans/2026-04-21-storm-human-factors-study-implementation.md`.
3. Start at Task 6. Skip Tasks 1-5 (already done — verify by reading this handoff doc).
4. Apply the selective-rigor policy above.
5. At end of each phase, summarize to user + commit progress + prompt for next-phase go.
6. At the end, dispatch final code-reviewer for full diff vs `main` (`git diff main..feat/human-factors-study`).
