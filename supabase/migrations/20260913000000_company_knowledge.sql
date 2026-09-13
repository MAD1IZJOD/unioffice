-- Company knowledge.
--
-- The memories table becomes the company's knowledge layer rather than a
-- second system being built beside it. Until now every task outcome was
-- written here verbatim - "64 times 9 is 576" - and recalled by keyword. That
-- is raw execution data, not knowledge, and a company that remembers
-- everything equally remembers nothing usefully.
--
-- This migration does four things:
--
-- 1. Gives each row the shape of a piece of knowledge: a title, a lifecycle
--    (proposed -> active -> archived), provenance (where it came from and who
--    reviewed it), an optional workspace boundary, and a confidence.
-- 2. Adds retrieval that can scale: a full-text vector and a 768-dimension
--    embedding (produced locally, so company knowledge is never sent to an
--    external service), with a tenant-scoped candidate function over both.
-- 3. Records use. knowledge_recalls says which knowledge was put in front of
--    which mission, step and agent, and why - so the Brain can show what is
--    being used and a mission can show what it was given.
-- 4. Records contradictions. knowledge_conflicts holds pairs the system
--    detected as disagreeing, so neither is silently preferred.
--
-- Existing rows are preserved. The legacy task outcome records are archived,
-- not deleted: they stay readable and restorable, they just stop being
-- recalled into prompts as if a person had vouched for them.

create extension if not exists vector with schema extensions;

-- --------------------------------------------------------------------------
-- memories: the knowledge record
-- --------------------------------------------------------------------------

alter table memories
    add column if not exists title text,

    -- proposed: suggested (by an agent or extraction), not yet vouched for.
    -- active:   current company knowledge.
    -- archived: kept for history, never recalled.
    add column if not exists status text,

    -- A workspace boundary. Null means company-wide. A row with a workspace
    -- is only ever recalled into work running inside that workspace. Cascade
    -- rather than set null: losing the workspace must never widen who can see
    -- what was restricted to it.
    add column if not exists workspace_id uuid
        references workspaces(id)
        on delete cascade,

    add column if not exists artifact_id uuid
        references artifacts(id)
        on delete set null,

    -- What kind of thing produced this. The specific row is named by work_id,
    -- task_id, artifact_id and agent_id, which already exist or are added here.
    add column if not exists source_type text,

    add column if not exists confidence real,

    add column if not exists created_by text,

    add column if not exists reviewed_by text,

    add column if not exists reviewed_at timestamptz,

    add column if not exists supersedes_id uuid
        references memories(id)
        on delete set null,

    add column if not exists archived_at timestamptz,

    -- Normalized content fingerprint, so the same sentence extracted twice is
    -- recognized as a duplicate rather than stored again.
    add column if not exists content_hash text,

    add column if not exists embedding extensions.vector(768),

    add column if not exists embedding_model text,

    add column if not exists embedded_at timestamptz;

-- The type vocabulary changes, so the old check has to go before any row is
-- moved to a new value.
alter table memories drop constraint if exists memories_type_check;

-- Backfill. Every statement is guarded so a re-run changes nothing.
update memories
set title = left(
        btrim(regexp_replace(split_part(content, ': ', 1), '\s+', ' ', 'g')),
        160
    )
where title is null;

update memories set title = left(content, 160) where title is null or title = '';

-- "decision" was how a failed task was labelled. It was never a decision.
update memories
set type = 'experience'
where type = 'decision'
  and metadata ->> 'status' = 'failed';

update memories set type = 'policy' where type = 'instruction';
update memories set type = 'reference' where type = 'document';

update memories
set source_type = case
        when source like 'task:%' then 'task'
        when agent_id is not null then 'agent'
        else 'user'
    end
where source_type is null;

update memories
set content_hash = md5(lower(btrim(regexp_replace(content, '\s+', ' ', 'g'))))
where content_hash is null;

-- Legacy outcome records: archived with the reason written on the row.
update memories
set status = 'archived',
    archived_at = coalesce(archived_at, now()),
    metadata = metadata || jsonb_build_object(
        'archivedReason',
        'Legacy task outcome record: a raw execution trace written for every task, not reviewed knowledge.'
    )
where status is null
  and type = 'experience'
  and source_type = 'task';

update memories set status = 'active' where status is null;

alter table memories alter column title set not null;
alter table memories alter column status set not null;
alter table memories alter column source_type set not null;
alter table memories alter column status set default 'proposed';

alter table memories
    add constraint memories_type_check
    check (type in (
        'fact',
        'decision',
        'insight',
        'policy',
        'process',
        'preference',
        'lesson',
        'assumption',
        'reference',
        'experience'
    ));

alter table memories drop constraint if exists memories_status_check;
alter table memories
    add constraint memories_status_check
    check (status in ('proposed', 'active', 'archived'));

alter table memories drop constraint if exists memories_source_type_check;
alter table memories
    add constraint memories_source_type_check
    check (source_type in ('mission', 'task', 'artifact', 'user', 'agent', 'approval'));

alter table memories drop constraint if exists memories_confidence_check;
alter table memories
    add constraint memories_confidence_check
    check (confidence is null or (confidence >= 0 and confidence <= 1));

alter table memories drop constraint if exists memories_title_length_check;
alter table memories
    add constraint memories_title_length_check
    check (char_length(title) between 1 and 200);

-- Content was unbounded. Knowledge is meant to be concise; a row that is a
-- whole document belongs in an artifact with knowledge derived from it.
alter table memories drop constraint if exists memories_content_length_check;
alter table memories
    add constraint memories_content_length_check
    check (char_length(content) between 1 and 8000);

alter table memories
    add column if not exists search_vector tsvector
    generated always as (
        setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
        setweight(to_tsvector('english', content), 'B')
    ) stored;

-- The access paths retrieval and the Brain actually use.
create index if not exists memories_org_status_created_idx
    on memories(organization_id, status, created_at desc);

create index if not exists memories_org_workspace_idx
    on memories(organization_id, workspace_id);

create index if not exists memories_work_idx
    on memories(work_id);

create index if not exists memories_task_idx
    on memories(task_id);

create index if not exists memories_artifact_idx
    on memories(artifact_id);

create index if not exists memories_content_hash_idx
    on memories(organization_id, content_hash);

create index if not exists memories_search_idx
    on memories using gin(search_vector);

create index if not exists memories_embedding_idx
    on memories using hnsw (embedding extensions.vector_cosine_ops);

-- --------------------------------------------------------------------------
-- knowledge_recalls: which knowledge was put in front of which work
-- --------------------------------------------------------------------------

create table if not exists knowledge_recalls (
    id uuid primary key,

    organization_id uuid not null
        references organizations(id)
        on delete cascade,

    memory_id uuid not null
        references memories(id)
        on delete cascade,

    work_id uuid
        references works(id)
        on delete cascade,

    task_id uuid
        references tasks(id)
        on delete cascade,

    agent_id uuid
        references agents(id)
        on delete set null,

    -- planning: recalled by the orchestrator before the plan was written.
    -- execution: recalled into one step's context before its agent ran.
    stage text not null
        check (stage in ('planning', 'execution')),

    rank integer not null check (rank >= 1),

    score real not null,

    -- Why it was retrieved, as the sentences the ranker produced.
    reasons jsonb not null default '[]'::jsonb,

    recalled_at timestamptz not null default now()
);

create index if not exists knowledge_recalls_memory_idx
    on knowledge_recalls(memory_id, recalled_at desc);

create index if not exists knowledge_recalls_work_idx
    on knowledge_recalls(work_id);

create index if not exists knowledge_recalls_org_idx
    on knowledge_recalls(organization_id, recalled_at desc);

-- --------------------------------------------------------------------------
-- knowledge_conflicts: two pieces of knowledge that disagree
-- --------------------------------------------------------------------------

create table if not exists knowledge_conflicts (
    id uuid primary key,

    organization_id uuid not null
        references organizations(id)
        on delete cascade,

    memory_id uuid not null
        references memories(id)
        on delete cascade,

    conflicting_memory_id uuid not null
        references memories(id)
        on delete cascade,

    -- One sentence: what disagrees.
    reason text not null,

    -- The evidence the detector used: similarity, the differing values.
    signals jsonb not null default '{}'::jsonb,

    status text not null default 'open'
        check (status in ('open', 'resolved', 'dismissed')),

    resolution text,

    resolved_by text,

    resolved_at timestamptz,

    detected_at timestamptz not null default now(),

    check (memory_id <> conflicting_memory_id)
);

-- One open conflict per pair, whichever side was written second.
create unique index if not exists knowledge_conflicts_open_pair_idx
    on knowledge_conflicts(
        organization_id,
        least(memory_id, conflicting_memory_id),
        greatest(memory_id, conflicting_memory_id)
    )
    where status = 'open';

create index if not exists knowledge_conflicts_org_status_idx
    on knowledge_conflicts(organization_id, status, detected_at desc);

create index if not exists knowledge_conflicts_memory_idx
    on knowledge_conflicts(memory_id);

create index if not exists knowledge_conflicts_other_memory_idx
    on knowledge_conflicts(conflicting_memory_id);

-- Same posture as every other table: RLS on and forced, no policies, the
-- server-side service role is the only way in.
alter table knowledge_recalls enable row level security;
alter table knowledge_recalls force row level security;
alter table knowledge_conflicts enable row level security;
alter table knowledge_conflicts force row level security;

grant select, insert, update, delete on table knowledge_recalls to service_role;
grant select, insert, update, delete on table knowledge_conflicts to service_role;

-- --------------------------------------------------------------------------
-- match_knowledge: tenant-scoped retrieval candidates
--
-- Returns ids and raw signals only. Ranking stays in application code where
-- it is deterministic, tested and explainable; this function's job is to find
-- a bounded candidate pool fast and to make it impossible to find one outside
-- the caller's organization, status set or workspace boundary.
--
-- Each branch repeats the filter against the table instead of sharing a CTE,
-- so the planner can use the HNSW and GIN indexes rather than scanning a
-- materialized copy of the organization.
--
-- p_query_terms is pre-sanitized by the caller to alphanumeric words joined
-- with ' | ' (any-word match), so it is always a valid tsquery.
-- --------------------------------------------------------------------------

create or replace function match_knowledge(
    p_organization_id uuid,
    p_statuses text[],
    p_workspace_mode text,
    p_workspace_id uuid,
    p_query_embedding extensions.vector(768),
    p_query_terms text,
    p_candidate_limit integer
)
returns table (
    memory_id uuid,
    semantic_similarity real,
    keyword_rank real
)
language plpgsql
stable
set search_path = public, extensions
as $$
declare
    v_limit integer := least(greatest(coalesce(p_candidate_limit, 40), 1), 200);
    v_query tsquery := null;
begin
    if p_workspace_mode not in ('all', 'company', 'company_and_workspace') then
        raise exception 'invalid workspace mode: %', p_workspace_mode;
    end if;

    if p_workspace_mode = 'company_and_workspace' and p_workspace_id is null then
        raise exception 'a workspace id is required for company_and_workspace';
    end if;

    if coalesce(btrim(p_query_terms), '') <> '' then
        v_query := to_tsquery('english', p_query_terms);
    end if;

    return query
    with semantic as (
        select m.id
        from memories m
        where p_query_embedding is not null
          and m.embedding is not null
          and m.organization_id = p_organization_id
          and m.status = any(p_statuses)
          and (
              p_workspace_mode = 'all'
              or m.workspace_id is null
              or (p_workspace_mode = 'company_and_workspace' and m.workspace_id = p_workspace_id)
          )
        order by m.embedding <=> p_query_embedding
        limit v_limit
    ),
    lexical as (
        select m.id
        from memories m
        where v_query is not null
          and m.search_vector @@ v_query
          and m.organization_id = p_organization_id
          and m.status = any(p_statuses)
          and (
              p_workspace_mode = 'all'
              or m.workspace_id is null
              or (p_workspace_mode = 'company_and_workspace' and m.workspace_id = p_workspace_id)
          )
        order by ts_rank_cd(m.search_vector, v_query, 32) desc
        limit v_limit
    ),
    important as (
        select m.id
        from memories m
        where m.importance >= 0.85
          and m.organization_id = p_organization_id
          and m.status = any(p_statuses)
          and (
              p_workspace_mode = 'all'
              or m.workspace_id is null
              or (p_workspace_mode = 'company_and_workspace' and m.workspace_id = p_workspace_id)
          )
        order by m.importance desc, m.created_at desc
        limit 10
    ),
    pool as (
        select id from semantic
        union
        select id from lexical
        union
        select id from important
    )
    select
        m.id,
        case
            when p_query_embedding is null or m.embedding is null then null
            else (1 - (m.embedding <=> p_query_embedding))::real
        end,
        case
            when v_query is null then 0::real
            else ts_rank_cd(m.search_vector, v_query, 32)::real
        end
    from pool
    join memories m on m.id = pool.id
    -- Re-asserted on the final join. The branches already filter, but this is
    -- the tenant boundary and it is cheap to state twice.
    where m.organization_id = p_organization_id
      and m.status = any(p_statuses);
end;
$$;

revoke all on function match_knowledge(uuid, text[], text, uuid, extensions.vector, text, integer)
    from public, anon, authenticated;

grant execute on function match_knowledge(uuid, text[], text, uuid, extensions.vector, text, integer)
    to service_role;
