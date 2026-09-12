-- Make row-level security explicit on every application table.
--
-- The tables were already protected - Supabase enables RLS by default and,
-- with no policies attached, that is a default-deny for the anon and
-- authenticated roles the browser could ever hold. The application reaches
-- the database only through the server-side service-role key, which bypasses
-- RLS by design, so this posture is intended: the browser can touch nothing
-- directly, and all access goes through the API where organization scoping is
-- enforced.
--
-- What was missing was making that guarantee ours rather than the platform's.
-- Relying on a project-level default means a table restored, branched, or
-- recreated somewhere with a different default would silently become world-
-- readable. Enabling RLS here, in a migration, pins the guarantee to the
-- schema. Every statement is idempotent: on a database where RLS is already
-- on, it changes nothing.
--
-- No policies are added on purpose. Adding a permissive policy would open a
-- direct browser path to the data that does not exist today; the service-role
-- key is, and must remain, the only way in.

alter table organizations     enable row level security;
alter table workspaces         enable row level security;
alter table agents             enable row level security;
alter table works              enable row level security;
alter table tasks              enable row level security;
alter table artifacts          enable row level security;
alter table events             enable row level security;
alter table approval_requests  enable row level security;
alter table memories           enable row level security;
alter table execution_jobs     enable row level security;
alter table policies           enable row level security;
alter table workflows          enable row level security;
alter table workflow_nodes     enable row level security;

-- force applies RLS even to the table owner, so a future connection that is
-- not the service role (a migration run as a lesser role, a pooled owner
-- session) cannot accidentally read around it.
alter table organizations     force row level security;
alter table workspaces         force row level security;
alter table agents             force row level security;
alter table works              force row level security;
alter table tasks              force row level security;
alter table artifacts          force row level security;
alter table events             force row level security;
alter table approval_requests  force row level security;
alter table memories           force row level security;
alter table execution_jobs     force row level security;
alter table policies           force row level security;
alter table workflows          force row level security;
alter table workflow_nodes     force row level security;
