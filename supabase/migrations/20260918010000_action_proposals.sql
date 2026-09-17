-- What a step would do, written down before anyone is asked to allow it.
--
-- An approval used to point at a task: approving it meant "this step is
-- alright", and whatever the step turned out to be when it ran was what got
-- run. A proposal is the concrete thing instead - this agent, this skill at
-- this version, these tools, this mission - and an approval is granted
-- against one of them by id.
--
-- `hash` is a fingerprint of the action. Before a step that was approved
-- runs, the action is described again from the step as it is then and hashed
-- the same way: a different hash means the step is no longer the one that was
-- approved, and it needs approving again rather than going ahead.
--
-- Nothing updates a row here. A changed action is a new proposal, so the
-- record of what was put in front of a person stays exactly as they saw it.
--
-- Same posture as every other table: RLS enabled and forced, no policies, no
-- privileges for browser roles.

create table if not exists action_proposals (
    id uuid primary key,
    organization_id uuid not null references organizations(id) on delete cascade,
    work_id uuid not null references works(id) on delete cascade,
    task_id uuid not null references tasks(id) on delete cascade,
    agent_id uuid references agents(id) on delete set null,
    summary text not null check (char_length(summary) between 1 and 500),
    action jsonb not null,
    hash text not null check (char_length(hash) = 64),
    created_at timestamptz not null default now()
);

-- The two ways a proposal is read: by the step it belongs to, newest first,
-- and by the exact action, to see whether one has already been written.
create index if not exists action_proposals_task_idx
    on action_proposals(task_id, created_at desc);

create index if not exists action_proposals_hash_idx
    on action_proposals(task_id, hash);

create index if not exists action_proposals_organization_idx
    on action_proposals(organization_id, created_at desc);

alter table action_proposals enable row level security;
alter table action_proposals force row level security;

revoke all on table action_proposals from anon, authenticated;
grant select, insert on table action_proposals to service_role;
