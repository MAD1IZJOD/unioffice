-- Company knowledge. The authoritative history is supabase/migrations
-- (20260905010000_memories.sql, then 20260913000000_company_knowledge.sql and
-- 20260913010000_knowledge_policies.sql); this file is the resulting shape,
-- kept readable in one place.

create extension if not exists vector with schema extensions;

create table if not exists memories (
    id uuid primary key,

    organization_id uuid not null
        references organizations(id)
        on delete cascade,

    -- Null is company-wide. Set, the knowledge is only recalled into work in
    -- that workspace; cascade so losing the workspace never widens it.
    workspace_id uuid
        references workspaces(id)
        on delete cascade,

    agent_id uuid
        references agents(id)
        on delete set null,

    work_id uuid
        references works(id)
        on delete set null,

    task_id uuid
        references tasks(id)
        on delete set null,

    artifact_id uuid
        references artifacts(id)
        on delete set null,

    scope text not null
        check (scope in ('company', 'agent')),

    type text not null
        check (type in ('fact', 'decision', 'insight', 'policy', 'process', 'preference', 'lesson', 'assumption', 'reference', 'experience')),

    status text not null default 'proposed'
        check (status in ('proposed', 'active', 'archived')),

    title text not null
        check (char_length(title) between 1 and 200),

    content text not null
        check (char_length(content) between 1 and 8000),

    source text,

    source_type text not null
        check (source_type in ('mission', 'task', 'artifact', 'user', 'agent', 'approval')),

    importance real not null default 0.5
        check (importance >= 0 and importance <= 1),

    confidence real
        check (confidence is null or (confidence >= 0 and confidence <= 1)),

    created_by text,
    reviewed_by text,
    reviewed_at timestamptz,

    supersedes_id uuid
        references memories(id)
        on delete set null,

    archived_at timestamptz,

    content_hash text,

    embedding extensions.vector(768),
    embedding_model text,
    embedded_at timestamptz,

    search_vector tsvector generated always as (
        setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
        setweight(to_tsvector('english', content), 'B')
    ) stored,

    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    metadata jsonb not null default '{}'::jsonb
);

create index if not exists memories_organization_created_idx on memories(organization_id, created_at desc);
create index if not exists memories_agent_idx on memories(agent_id);
create index if not exists memories_org_status_created_idx on memories(organization_id, status, created_at desc);
create index if not exists memories_org_workspace_idx on memories(organization_id, workspace_id);
create index if not exists memories_work_idx on memories(work_id);
create index if not exists memories_task_idx on memories(task_id);
create index if not exists memories_artifact_idx on memories(artifact_id);
create index if not exists memories_content_hash_idx on memories(organization_id, content_hash);
create index if not exists memories_search_idx on memories using gin(search_vector);
create index if not exists memories_embedding_idx on memories using hnsw (embedding extensions.vector_cosine_ops);

-- Which knowledge was put in front of which work, and why.
create table if not exists knowledge_recalls (
    id uuid primary key,
    organization_id uuid not null references organizations(id) on delete cascade,
    memory_id uuid not null references memories(id) on delete cascade,
    work_id uuid references works(id) on delete cascade,
    task_id uuid references tasks(id) on delete cascade,
    agent_id uuid references agents(id) on delete set null,
    stage text not null check (stage in ('planning', 'execution')),
    rank integer not null check (rank >= 1),
    score real not null,
    reasons jsonb not null default '[]'::jsonb,
    recalled_at timestamptz not null default now()
);

-- Two pieces of knowledge that disagree; one open conflict per pair.
create table if not exists knowledge_conflicts (
    id uuid primary key,
    organization_id uuid not null references organizations(id) on delete cascade,
    memory_id uuid not null references memories(id) on delete cascade,
    conflicting_memory_id uuid not null references memories(id) on delete cascade,
    reason text not null,
    signals jsonb not null default '{}'::jsonb,
    status text not null default 'open' check (status in ('open', 'resolved', 'dismissed')),
    resolution text,
    resolved_by text,
    resolved_at timestamptz,
    detected_at timestamptz not null default now(),
    check (memory_id <> conflicting_memory_id)
);

-- Retrieval candidates come from match_knowledge(organization, statuses,
-- workspace mode, workspace, query embedding, query terms, limit), defined in
-- 20260913000000_company_knowledge.sql. It returns ids and raw signals only;
-- ranking happens in application code.
