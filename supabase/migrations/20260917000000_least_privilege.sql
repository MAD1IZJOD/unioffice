-- Least privilege for the roles a browser can hold.
--
-- Every table already has row-level security enabled and forced with no
-- policies, so `anon` and `authenticated` could read and write nothing. But
-- the project's default grants still handed both roles full table privileges
-- - SELECT through TRUNCATE - on every table, including ones created later.
-- Row-level security was the only thing between the public key and the data.
--
-- This takes the privileges away as well, so the Data API exposes none of
-- these tables to those roles at all. The API reaches the database with the
-- service role, which is untouched. Nothing in the web app queries tables
-- directly; it uses the public key only to sign people in.
--
-- Safe to run more than once. It removes privileges and adds indexes; it does
-- not change or delete any data.

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke execute on all functions in schema public from anon, authenticated, public;

-- Tables, sequences and functions created later by migrations start closed
-- too, rather than open until someone remembers to revoke.
alter default privileges for role postgres in schema public
    revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public
    revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public
    revoke execute on functions from anon, authenticated, public;

-- The service role keeps what it had.
grant select, insert, update, delete on all tables in schema public to service_role;
grant execute on all functions in schema public to service_role;

-- --------------------------------------------------------------------------
-- Foreign keys without an index.
--
-- Each of these is followed by a cascade or set-null when the referenced row
-- is deleted, and some are filtered on. Without an index the delete scans the
-- whole referencing table. All are small today, which is the cheapest time
-- to add them.
-- --------------------------------------------------------------------------

create index if not exists approval_requests_agent_idx
    on approval_requests(agent_id) where agent_id is not null;

create index if not exists connection_oauth_states_organization_idx
    on connection_oauth_states(organization_id);
create index if not exists connection_oauth_states_workspace_idx
    on connection_oauth_states(workspace_id) where workspace_id is not null;
create index if not exists connection_oauth_states_user_idx
    on connection_oauth_states(user_id);

create index if not exists connections_workspace_idx
    on connections(workspace_id) where workspace_id is not null;
create index if not exists connections_connected_by_idx
    on connections(connected_by) where connected_by is not null;
create index if not exists connections_revoked_by_idx
    on connections(revoked_by) where revoked_by is not null;

create index if not exists knowledge_recalls_agent_idx
    on knowledge_recalls(agent_id) where agent_id is not null;
create index if not exists knowledge_recalls_task_idx
    on knowledge_recalls(task_id) where task_id is not null;

create index if not exists memories_workspace_idx
    on memories(workspace_id) where workspace_id is not null;
create index if not exists memories_supersedes_idx
    on memories(supersedes_id) where supersedes_id is not null;

create index if not exists organization_members_invited_by_idx
    on organization_members(invited_by) where invited_by is not null;
create index if not exists workspace_members_granted_by_idx
    on workspace_members(granted_by) where granted_by is not null;
