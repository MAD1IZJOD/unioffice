create table if not exists organizations (
    id uuid primary key,
    name text not null,
    slug text not null unique,
    status text not null default 'active'
        check (status in ('active', 'suspended', 'archived')),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    metadata jsonb not null default '{}'::jsonb
);

create index if not exists organizations_status_idx
    on organizations(status);