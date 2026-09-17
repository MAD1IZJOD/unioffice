# 002: Forward-only migrations and a closed database

## Decision

1. Migrations only move forward. An applied migration is never edited; a change
   is a new, idempotent migration. `supabase db reset` is never run against the
   project, and no migration drops data.
2. The browser never reads or writes tables. Every table has row-level security
   enabled and forced with no policies, and `anon` and `authenticated` hold no
   table, sequence or function privileges. Default privileges keep new objects
   closed. Only the API and worker, with the service role, reach data.
3. The posture is checked, not assumed: `supabase/checks/posture.sql` returns a
   row for every violation, and an empty result is the expected state.

## Procedure for a schema change

1. Write `supabase/migrations/<timestamp>_<name>.sql`, idempotent where possible.
2. Dry-run it against the linked project inside a transaction that is rolled
   back (`begin; ... ; rollback;` through `supabase db query --linked`).
3. Apply with `supabase db push`.
4. Run the posture check and the Supabase advisors.

## 2.0 migrations

| Migration | Change | Risk |
| --- | --- | --- |
| `20260917000000_least_privilege` | Revokes browser-role privileges and default privileges; locks function execution; indexes 13 foreign keys | None to data. Anything that relied on the anon key reading tables would stop - nothing did |
| `20260917010000_skills` | Adds `skills` (RLS forced) and `agents.skills` with a size check | Additive |

## State at 2.0

- PostgreSQL 17.6 on Supabase. Extensions: pgvector, pgcrypto,
  pg_stat_statements, supabase_vault, uuid-ossp.
- No Realtime publications: live updates use the API's authenticated event
  stream, which re-checks membership as it runs.
- Remaining advisor warning: leaked password protection is off. It is an Auth
  setting in the Supabase dashboard; the product signs people in with Google or
  an email link and never sets passwords.
