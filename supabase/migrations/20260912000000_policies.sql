-- Governance policies.
--
-- A policy is a rule the company operates under, written by a person and
-- enforced deterministically by the backend. It lives in a table rather than
-- in code because a rule has to be readable after the fact: shown to the
-- person it constrains, and audited against a decision that has already been
-- taken. A rule expressed as a branch inside the executor cannot be either.
--
-- The audit trail is deliberately not here. Governance decisions are written
-- to the existing events table, because a decision about an action belongs
-- beside the action it was about, and a second history is a second thing to
-- keep in step.

create table if not exists policies (
    id uuid primary key,

    organization_id uuid not null
        references organizations(id)
        on delete cascade,

    name text not null,

    description text not null default '',

    -- What the rule is about. 'tool' governs a single tool call; 'task'
    -- governs a whole step before any agent starts it. Denying a tool leaves
    -- the rest of the step free to proceed without it, so these are kept
    -- apart rather than collapsed into one generic permission.
    subject text not null
        check (subject in ('tool', 'task')),

    -- What happens when the rule matches. Ordered by strength in the engine:
    -- deny beats require_approval beats allow, so a broad permissive rule
    -- added later cannot quietly undo a "never".
    effect text not null
        check (effect in ('allow', 'require_approval', 'deny')),

    risk text not null default 'medium'
        check (risk in ('low', 'medium', 'high', 'critical')),

    status text not null default 'draft'
        check (status in ('draft', 'active', 'paused', 'archived')),

    -- Scope. Every list is an "any of", and an empty list means the policy is
    -- simply not narrowed that way - which is the only reading that makes an
    -- unfilled form mean "company-wide" rather than "matches nothing".
    agent_ids uuid[] not null default '{}',

    tool_ids text[] not null default '{}',

    workspace_ids uuid[] not null default '{}',

    capabilities text[] not null default '{}',

    -- Shown to whoever has to decide, when the effect is require_approval.
    approval_prompt text,

    created_at timestamptz not null default now(),

    updated_at timestamptz not null default now(),

    created_by text,

    metadata jsonb not null default '{}'::jsonb
);

create index if not exists policies_organization_idx
    on policies(organization_id);

-- Every evaluation reads the active policies for one organization, so that
-- is the access path worth an index of its own.
create index if not exists policies_enforced_idx
    on policies(organization_id, subject)
    where status = 'active';

create index if not exists policies_status_idx
    on policies(status);

-- Two policies with the same name in one organization is a mistake rather
-- than a configuration, and it makes an audit line ambiguous about which rule
-- actually fired. Archived ones are excluded so a name can be reused once a
-- rule has been retired.
create unique index if not exists policies_unique_name_idx
    on policies(organization_id, lower(name))
    where status <> 'archived';
