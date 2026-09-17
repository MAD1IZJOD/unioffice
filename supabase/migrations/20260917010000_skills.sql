-- Skills.
--
-- skills
--   Operating procedures an organization writes for its workforce, company-
--   wide or for one workspace. The product's own system skills are not stored
--   here - they ship with the code and are the same everywhere - so this table
--   holds only what an organization chose to add or override. For the same
--   slug, a workspace skill wins over an organization skill, which wins over
--   the system skill.
--
--   A skill grants nothing. required_tools and required_capabilities are
--   requirements an agent must already meet; they are never added to one.
--   instructions is configuration written by people and reaches a model only
--   as bounded, labelled procedure.
--
-- agents.skills
--   The slugs an agent may be given steps for, beside the tools it holds.
--
-- Same posture as every other table: RLS enabled and forced, no policies, no
-- privileges for browser roles. Only the API reads and writes skills.

create table if not exists skills (
    id uuid primary key default gen_random_uuid(),

    organization_id uuid not null
        references organizations(id)
        on delete cascade,

    -- Null for an organization-wide skill.
    workspace_id uuid
        references workspaces(id)
        on delete cascade,

    slug text not null
        check (char_length(slug) between 1 and 64 and slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),

    name text not null
        check (char_length(name) between 1 and 120),

    description text not null default ''
        check (char_length(description) <= 600),

    category text not null
        check (category in ('engineering', 'research', 'finance', 'people', 'communication', 'operations')),

    version integer not null default 1
        check (version >= 1),

    status text not null default 'draft'
        check (status in ('draft', 'active', 'archived')),

    instructions text not null
        check (char_length(instructions) between 1 and 6000),

    inputs jsonb not null default '[]'::jsonb
        check (jsonb_typeof(inputs) = 'array' and jsonb_array_length(inputs) <= 12),

    outputs jsonb not null default '[]'::jsonb
        check (jsonb_typeof(outputs) = 'array' and jsonb_array_length(outputs) <= 12),

    required_tools text[] not null default '{}'
        check (cardinality(required_tools) <= 10),

    required_capabilities text[] not null default '{}'
        check (cardinality(required_capabilities) <= 5),

    approval text not null default 'none'
        check (approval in ('none', 'required')),

    memory text not null default 'recall'
        check (memory in ('recall', 'none')),

    created_by uuid
        references auth.users(id)
        on delete set null,

    updated_by uuid
        references auth.users(id)
        on delete set null,

    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

-- One skill per slug per scope that is not archived. Archiving frees the slug.
create unique index if not exists skills_live_slug_idx
    on skills(
        organization_id,
        coalesce(workspace_id, '00000000-0000-0000-0000-000000000000'::uuid),
        slug
    )
    where status <> 'archived';

create index if not exists skills_organization_idx
    on skills(organization_id, updated_at desc);

create index if not exists skills_workspace_idx
    on skills(workspace_id) where workspace_id is not null;

create index if not exists skills_created_by_idx
    on skills(created_by) where created_by is not null;

create index if not exists skills_updated_by_idx
    on skills(updated_by) where updated_by is not null;

alter table skills enable row level security;
alter table skills force row level security;

revoke all on table skills from anon, authenticated;
grant select, insert, update, delete on table skills to service_role;

alter table agents
    add column if not exists skills jsonb not null default '[]'::jsonb;

do $$
begin
    if not exists (
        select 1 from pg_constraint where conname = 'agents_skills_is_array'
    ) then
        alter table agents
            add constraint agents_skills_is_array
            check (jsonb_typeof(skills) = 'array' and jsonb_array_length(skills) <= 50);
    end if;
end;
$$;
