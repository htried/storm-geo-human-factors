# Deploying under Cornell credentials, locked down

This runbook moves the backend off personal (gmail) accounts onto accounts
owned by a cornell.edu identity and locks study data down so only the server
and named researchers can read it.

> **Platform decision:** stay on Supabase + Vercel under cornell.edu-owned
> accounts. The study collects no direct identifiers (participant_id is the
> Qualtrics ResponseID; IPs are only stored salted-and-hashed), and access is
> locked down as below. If the IRB later classifies the data as Confidential
> under Cornell Policy 4.12, the app talks to Postgres only through
> `lib/supabase.ts` and the route handlers, so moving to a Cornell-contracted
> platform (e.g. CIT's AWS program) is a contained change.

## 1. Accounts (do these yourself, signed in as your @cornell.edu identity)

| Service  | What to create | Settings |
|----------|----------------|----------|
| Supabase | New **organization** owned by your cornell.edu login, then a project in `us-east-1` | Enable MFA on your account; Org → Security → **Require MFA** for all members. Invite collaborators by their cornell.edu address with the least role they need (Read-only for analysts). |
| Vercel   | New **team** owned by your cornell.edu login | Enable 2FA. Git integration: connect only this repo. |
| OpenAI   | (later, once off mock data) a project under a Cornell-billed org | Project-scoped key; set a monthly budget cap. |
| SERPER   | Only needed if you re-enable the search arms | — |

Rotate *everything* that was ever created under the old gmail accounts:
`ASSIGN_SECRET`, `INJECT_SECRET`, `ADMIN_TOKEN`, `IP_HASH_SALT`, and the
Supabase keys. Generate new values with `openssl rand -hex 32`. Changing
`ASSIGN_SECRET` reshuffles assignment for *new* participants only.

## 2. Database lockdown

Apply migrations in order (`supabase link --project-ref <ref> && supabase db push`):

- `0001_init.sql`: schema.
- `0002_lockdown.sql`: enables RLS on every table with **no policies**, revokes
  all privileges from `anon`/`authenticated` (including default privileges for
  future tables). The public anon/publishable key can then read or write
  nothing. The server uses the secret (service_role) key, which bypasses RLS.

Then in the Supabase dashboard:

1. **Settings → API → Exposed schemas**: remove `graphql_public` (the app only
   uses PostgREST on `public`). Optionally disable the `pg_graphql` extension.
2. **Settings → Database → Network restrictions**: restrict direct Postgres
   connections to Cornell VPN egress ranges. The app uses HTTPS (PostgREST),
   so this doesn't affect it. It closes the direct-DB path.
3. **Settings → Database → SSL enforcement**: on.
4. **Auth**: disable all sign-up providers (the app has no end-user auth).
5. **Backups / PITR**: enable per your data-management plan, and decide a
   retention/deletion date for raw data.
6. Verify the lockdown from your laptop with the anon key. It should return
   `401`/`42501` or an empty array, never rows:

   ```bash
   curl "$SUPABASE_URL/rest/v1/participants?select=*" -H "apikey: $ANON_KEY"
   ```

## 3. App-level lockdown (already in code)

- `ADMIN_API_ENABLED` defaults **off**: `/api/admin/*` returns 404. Pull data
  from the Supabase dashboard / `psql` instead. If you turn it on temporarily,
  `ADMIN_TOKEN` must be ≥32 chars in production and is compared in constant time.
- `/api/admin/session_summary` is additionally disabled in production.
- Postgres error text is stripped from API responses in production (logged
  server-side only).
- `participant_id` is restricted to `[A-Za-z0-9_.:-]{1,128}`.
- Only `/study` and `/ext/*` can be framed, and only by
  `ALLOWED_FRAME_ANCESTORS`; every other route sends `frame-ancestors 'none'`.
  All routes send `X-Robots-Tag: noindex`.
- IP addresses are never stored; only a salted SHA-256 (`ip_hash`).
- The service key is server-only (no `NEXT_PUBLIC_` env vars exist).

What the app does **not** do: the participant-facing endpoints
(`/api/session`, `/api/events`, …) are necessarily public, so anyone with the
study URL can create junk sessions. Filter analysis to sessions whose
`participant_id` matches a real Qualtrics ResponseID.

## 4. Vercel env

Set in Project → Settings → Environment Variables (Production *and* Preview):

```
ENABLED_CONDITIONS=vanilla_agent,injected_agent
MOCK_EXTERNAL_APIS=1            # until topics are final
ALLOWED_FRAME_ANCESTORS=https://<your-cornell-qualtrics-host>
SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...   # mark "Sensitive"
ASSIGN_SECRET / INJECT_SECRET / ADMIN_TOKEN / IP_HASH_SALT   # mark "Sensitive"
ADMIN_API_ENABLED=0
```

Use a **separate Supabase project for Preview deployments** so test traffic
never lands in the production dataset. Do not enable Vercel Deployment
Protection on the production domain: Qualtrics must be able to load it.

## 5. Qualtrics

See [`docs/qualtrics/question.js`](qualtrics/question.js) for the question
JavaScript and setup steps, and [`docs/qualtrics/harness.html`](qualtrics/harness.html)
to test the embed locally before touching the real survey.
