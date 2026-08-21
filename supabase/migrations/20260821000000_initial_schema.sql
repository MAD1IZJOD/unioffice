-- UNI-OFFICE
-- Initial database schema
-- Migration: 001

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


create table if not exists works (
    id uuid primary key,

    organization_id uuid not null
        references organizations(id)
        on delete cascade,

    workspace_id uuid
        references workspaces(id)
        on delete set null,

    requester_id uuid,

    objective text not null,

    status text not null default 'queued'
        check (
            status in (
                'queued',
                'planning',
                'executing',
                'waiting_approval',
                'completed',
                'failed',
                'cancelled'
            )
        ),

    priority text not null default 'normal'
        check (
            priority in (
                'low',
                'normal',
                'high',
                'critical'
            )
        ),

    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    started_at timestamptz,
    completed_at timestamptz,

    metadata jsonb not null default '{}'::jsonb
);

create index if not exists works_organization_idx
    on works(organization_id);

create index if not exists works_workspace_idx
    on works(workspace_id);

create index if not exists works_status_idx
    on works(status);

create index if not exists works_priority_idx
    on works(priority);

create index if not exists works_created_at_idx
    on works(created_at desc);


create table if not exists tasks (
    id uuid primary key,

    work_id uuid not null
        references works(id)
        on delete cascade,

    parent_task_id uuid
        references tasks(id)
        on delete cascade,

    assigned_agent_id uuid
        references agents(id)
        on delete set null,

    title text not null,
    description text not null,

    status text not null default 'pending'
        check (
            status in (
                'pending',
                'ready',
                'running',
                'waiting',
                'completed',
                'failed',
                'cancelled'
            )
        ),

    depends_on jsonb not null default '[]'::jsonb,

    result jsonb,

    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    started_at timestamptz,
    completed_at timestamptz,

    metadata jsonb not null default '{}'::jsonb
);

create index if not exists tasks_work_idx
    on tasks(work_id);

create index if not exists tasks_parent_idx
    on tasks(parent_task_id);

create index if not exists tasks_agent_idx
    on tasks(assigned_agent_id);

create index if not exists tasks_status_idx
    on tasks(status);


create table if not exists workflows (
    id uuid primary key,

    organization_id uuid not null
        references organizations(id)
        on delete cascade,

    work_id uuid not null
        references works(id)
        on delete cascade,

    name text not null,
    description text,

    status text not null default 'draft'
        check (
            status in (
                'draft',
                'ready',
                'running',
                'paused',
                'waiting',
                'completed',
                'failed',
                'cancelled'
            )
        ),

    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    started_at timestamptz,
    completed_at timestamptz,

    metadata jsonb not null default '{}'::jsonb
);

create index if not exists workflows_organization_idx
    on workflows(organization_id);

create index if not exists workflows_work_idx
    on workflows(work_id);

create index if not exists workflows_status_idx
    on workflows(status);


create table if not exists workflow_nodes (
    id uuid primary key,

    workflow_id uuid not null
        references workflows(id)
        on delete cascade,

    type text not null
        check (type in ('task', 'approval', 'condition')),

    name text not null,

    task_id uuid
        references tasks(id)
        on delete set null,

    depends_on jsonb not null default '[]'::jsonb,

    metadata jsonb not null default '{}'::jsonb
);

create index if not exists workflow_nodes_workflow_idx
    on workflow_nodes(workflow_id);

create index if not exists workflow_nodes_task_idx
    on workflow_nodes(task_id);

create index if not exists workflow_nodes_type_idx
    on workflow_nodes(type);


create table if not exists artifacts (
    id uuid primary key,

    organization_id uuid not null
        references organizations(id)
        on delete cascade,

    work_id uuid
        references works(id)
        on delete set null,

    task_id uuid
        references tasks(id)
        on delete set null,

    created_by_agent_id uuid
        references agents(id)
        on delete set null,

    name text not null,

    type text not null
        check (
            type in (
                'document',
                'spreadsheet',
                'presentation',
                'code',
                'dataset',
                'image',
                'analysis',
                'structured_data',
                'other'
            )
        ),

    description text,
    uri text,
    mime_type text,

    version integer not null default 1
        check (version > 0),

    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    metadata jsonb not null default '{}'::jsonb
);

create index if not exists artifacts_organization_idx
    on artifacts(organization_id);

create index if not exists artifacts_work_idx
    on artifacts(work_id);

create index if not exists artifacts_task_idx
    on artifacts(task_id);

create index if not exists artifacts_agent_idx
    on artifacts(created_by_agent_id);

create index if not exists artifacts_type_idx
    on artifacts(type);


create table if not exists events (
    id uuid primary key,

    organization_id uuid not null
        references organizations(id)
        on delete cascade,

    work_id uuid
        references works(id)
        on delete set null,

    task_id uuid
        references tasks(id)
        on delete set null,

    agent_id uuid
        references agents(id)
        on delete set null,

    actor_type text not null
        check (actor_type in ('user', 'agent', 'system')),

    actor_id uuid,

    type text not null,

    timestamp timestamptz not null default now(),

    payload jsonb not null default '{}'::jsonb,

    metadata jsonb not null default '{}'::jsonb
);

create index if not exists events_organization_idx
    on events(organization_id);

create index if not exists events_work_idx
    on events(work_id);

create index if not exists events_task_idx
    on events(task_id);

create index if not exists events_agent_idx
    on events(agent_id);

create index if not exists events_type_idx
    on events(type);

create index if not exists events_timestamp_idx
    on events(timestamp desc);