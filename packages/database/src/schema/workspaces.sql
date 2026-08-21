create table if not exists workspaces (
    id uuid primary key,
    organization_id uuid not null
        references organizations(id)
        on delete cascade,

    name text not null,
    slug text not null,
    description text,

    status text not null default 'active'
        check (status in ('active', 'archived')),

    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    metadata jsonb not null default '{}'::jsonb,

    unique (organization_id, slug)
);

create index if not exists workspaces_organization_idx
    on workspaces(organization_id);

create index if not exists workspaces_status_idx
    on workspaces(status);