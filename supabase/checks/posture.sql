-- Database posture check.
--
-- Read-only. Returns one row per violation of the guarantees the application
-- depends on; no rows means the database is in the shape the code assumes.
--
--   pnpm exec supabase db query --linked -f supabase/checks/posture.sql
--
-- Guarantees:
--   1. Every table in public has row-level security enabled and forced.
--   2. No row-level security policy exists in public - nothing is readable
--      through the Data API by any client role.
--   3. anon and authenticated hold no table or sequence privileges.
--   4. anon and authenticated cannot execute any function in public.
--   5. Every foreign key has an index leading with its column.

select 'rls_not_enabled' as violation, c.relname::text as object
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity

union all

select 'rls_not_forced', c.relname::text
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relforcerowsecurity

union all

select 'policy_exists', tablename || '.' || policyname
from pg_policies
where schemaname = 'public'

union all

select 'client_table_grant', table_name || ':' || grantee || ':' || privilege_type
from information_schema.role_table_grants
where table_schema = 'public' and grantee in ('anon', 'authenticated')

union all

select 'client_sequence_grant', c.relname || ':' || r.rolname
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
cross join pg_roles r
where n.nspname = 'public' and c.relkind = 'S'
  and r.rolname in ('anon', 'authenticated')
  and has_sequence_privilege(r.oid, c.oid, 'usage')

union all

select 'client_function_execute', p.proname || ':' || r.rolname
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
cross join pg_roles r
where n.nspname = 'public'
  and r.rolname in ('anon', 'authenticated')
  and has_function_privilege(r.oid, p.oid, 'execute')

union all

select 'unindexed_foreign_key', c.conrelid::regclass::text || '.' || a.attname
from pg_constraint c
join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
where c.contype = 'f'
  and c.connamespace = 'public'::regnamespace
  and not exists (
    select 1 from pg_index i
    where i.indrelid = c.conrelid and i.indkey[0] = c.conkey[1]
  )

order by 1, 2;
