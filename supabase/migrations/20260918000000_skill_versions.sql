-- Immutable skill versions.
--
-- A skill row holds the current version of a skill; editing it replaces what
-- was there. A mission that selected version 1 must keep running version 1,
-- so every version that is published or used is snapshotted here and never
-- changed afterwards.
--
-- `skill_ref` is how a step names a skill for all time: the uuid of an
-- organization or workspace skill, or `system:<slug>` for one that ships with
-- the product. System skills live in code, not in `skills`, so their snapshot
-- is written the first time a mission actually uses that version.
--
-- Nothing updates a row here. A new version is a new row; an edit that
-- somehow repeats a version is refused by the primary key.
--
-- Same posture as every other table: RLS enabled and forced, no policies, no
-- privileges for browser roles.

create table if not exists skill_versions (
    organization_id uuid not null
        references organizations(id)
        on delete cascade,

    -- The skill's identity across versions: a uuid, or system:<slug>.
    skill_ref text not null
        check (char_length(skill_ref) between 1 and 80),

    version integer not null
        check (version >= 1),

    scope text not null
        check (scope in ('system', 'organization', 'workspace')),

    workspace_id uuid
        references workspaces(id)
        on delete cascade,

    slug text not null,
    name text not null,
    description text not null default '',
    category text not null,
    instructions text not null,
    inputs jsonb not null default '[]'::jsonb,
    outputs jsonb not null default '[]'::jsonb,
    required_tools text[] not null default '{}',
    required_capabilities text[] not null default '{}',
    approval text not null
        check (approval in ('none', 'required')),
    memory text not null
        check (memory in ('recall', 'none')),

    recorded_at timestamptz not null default now(),

    primary key (organization_id, skill_ref, version)
);

-- "Every version of this skill", newest first, for an audit of what changed.
create index if not exists skill_versions_skill_idx
    on skill_versions(organization_id, skill_ref, version desc);

create index if not exists skill_versions_workspace_idx
    on skill_versions(workspace_id) where workspace_id is not null;

alter table skill_versions enable row level security;
alter table skill_versions force row level security;

revoke all on table skill_versions from anon, authenticated;
grant select, insert on table skill_versions to service_role;
