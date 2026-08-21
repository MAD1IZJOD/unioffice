create table if not exists agents (
    id uuid primary key,

    organization_id uuid not null
        references organizations(id)
        on delete cascade,

    workspace_id uuid
        references workspaces(id)
        on delete set null,

    name text not null,

    description text not null default '',

    type text not null
        check (type in ('specialist', 'manager', 'orchestrator')),

    status text not null default 'active'
        check (status in ('active', 'paused', 'disabled')),

    capabilities jsonb not null default '[]'::jsonb,

    tool_ids jsonb not null default '[]'::jsonb,

    created_at timestamptz not null default now(),

    updated_at timestamptz not null default now(),

    metadata jsonb not null default '{}'::jsonb
);

create index if not exists agents_organization_idx
    on agents(organization_id);

create index if not exists agents_workspace_idx
    on agents(workspace_id);

create index if not exists agents_status_idx
    on agents(status);