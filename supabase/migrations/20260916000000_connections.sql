-- Connections to external systems.
--
-- connections
--   An external account the organization has authorized - a GitHub user, a
--   Google Drive. Owned by the organization, optionally narrowed to one
--   workspace, never owned by an agent. Agents reach a connection only through
--   a tool they were granted, and only for what `capabilities` allows.
--
--   `credentials` is an AES-256-GCM envelope sealed by the API with a key that
--   lives in the server's environment, never in this database and never in
--   source. Reading this column without that key yields nothing usable. It is
--   cleared when a connection is disconnected, so a revoked row keeps its
--   history and loses its tokens.
--
-- connection_oauth_states
--   The server's half of an OAuth round trip in flight. The browser holds the
--   state value; this table holds only its SHA-256 hash, who started it, for
--   which organization, and the sealed PKCE verifier. A row is deleted as it is
--   used, so a state can complete at most one connection, and it expires in
--   minutes regardless.
--
-- Same posture as every other table: RLS enabled and forced, no policies. The
-- browser can read and write none of this.

create table if not exists connections (
    id uuid primary key default gen_random_uuid(),

    organization_id uuid not null
        references organizations(id)
        on delete cascade,

    -- Null for a company-wide connection.
    workspace_id uuid
        references workspaces(id)
        on delete cascade,

    provider text not null
        check (provider in ('github', 'google_drive')),

    status text not null default 'active'
        check (status in ('active', 'needs_attention', 'revoked')),

    account_label text
        check (account_label is null or char_length(account_label) <= 320),

    scopes text[] not null default '{}',

    capabilities text[] not null default '{}'
        check (capabilities <@ array['github.read', 'github.write', 'drive.read']::text[]),

    credentials text,

    connected_by uuid
        references auth.users(id)
        on delete set null,

    last_used_at timestamptz,

    last_error_code text
        check (last_error_code is null or char_length(last_error_code) <= 64),

    revoked_at timestamptz,

    revoked_by uuid
        references auth.users(id)
        on delete set null,

    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    -- A live connection always has credentials; a disconnected one never does.
    check (
        (status = 'revoked' and credentials is null and revoked_at is not null)
        or (status <> 'revoked' and credentials is not null)
    )
);

-- One live connection per provider per scope: company-wide, or per workspace.
-- Reconnecting replaces the credentials on the live row rather than adding a
-- second one an agent might pick instead.
create unique index if not exists connections_live_scope_idx
    on connections(
        organization_id,
        provider,
        coalesce(workspace_id, '00000000-0000-0000-0000-000000000000'::uuid)
    )
    where status <> 'revoked';

create index if not exists connections_organization_idx
    on connections(organization_id, created_at desc);

create table if not exists connection_oauth_states (
    id uuid primary key default gen_random_uuid(),

    state_hash text not null unique
        check (char_length(state_hash) = 64),

    organization_id uuid not null
        references organizations(id)
        on delete cascade,

    workspace_id uuid
        references workspaces(id)
        on delete cascade,

    provider text not null
        check (provider in ('github', 'google_drive')),

    user_id uuid not null
        references auth.users(id)
        on delete cascade,

    code_verifier text not null,

    -- Which scopes were asked for, so the callback can record what was
    -- requested rather than trusting a value that came back in the redirect.
    requested_scopes text[] not null default '{}',

    expires_at timestamptz not null,

    created_at timestamptz not null default now()
);

create index if not exists connection_oauth_states_expiry_idx
    on connection_oauth_states(expires_at);

alter table connections enable row level security;
alter table connections force row level security;
alter table connection_oauth_states enable row level security;
alter table connection_oauth_states force row level security;

grant select, insert, update, delete on table connections to service_role;
grant select, insert, update, delete on table connection_oauth_states to service_role;
