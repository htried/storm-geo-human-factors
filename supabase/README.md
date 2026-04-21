# Supabase migrations (STORM Human Factors study)

This folder holds SQL migrations for the STORM study app database (participants, sessions, events, chat, search cache, and app config).

## Applying migrations

**Supabase CLI (recommended for local/linked projects)**

1. Link the project: `supabase link --project-ref <your-project-ref>`
2. Push schema: `supabase db push`

**Supabase Dashboard**

Open **SQL** → **New query**, paste the contents of the migration file(s), and run. Use the same order as the numbered files.

## Ordering

Migrations are numbered (`0001_init.sql` runs first). Add new files in sequence (`0002_…`, `0003_…`) so changes stay reproducible and reviewable.

## Initial seed

The first migration inserts a single row into `app_config` with defaults: `gpt-4o-mini`, temperature `0.3`, max tokens `800`, and `text-embedding-3-small` for embeddings. Adjust via SQL or your admin flow after deploy if needed.
