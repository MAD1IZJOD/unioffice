-- Members, roles and workspace access.
--
-- Until now there were no people in the schema. Every request was anonymous,
-- the organization was bound by configuration, and every write was attributed
-- to one seeded requester id. These tables are what an authenticated user is
-- checked against:
--
--   auth user -> organization_members (role, status) -> workspace_members
--
-- organization_members
--   One row per person per organization. A person is identified by their
--   Supabase Auth user once they have signed in; before that, an invitation is
--   keyed by email and has no user yet. Roles are deliberately few:
--     owner  - everything, including other owners and the organization itself
--     admin  - runs the organization, cannot touch owners
--     member - does the work in the workspaces they can reach
--     viewer - reads what they can reach, changes nothing
--
-- workspace_members
--   Which workspaces a member or viewer can reach, and whether there they may
--   act (member) or only read (viewer). Owners and admins reach every
--   workspace and need no rows here. Company-wide resources - those with no
--   workspace - are reachable by every active member of the organization.
--
-- Same posture as every other table: RLS enabled and forced, no policies. The
-- browser never reads these; the API does, with the service role, and applies
-- the authorization itself.

create table if not exists organization_members (
    id uuid primary key default gen_random_uuid(),

    organization_id uuid not null
        references organizations(id)
        on delete cascade,

    -- Null only while an invitation has not been accepted.
    user_id uuid
        references auth.users(id)
        on delete cascade,

    -- Stored lowercased. The identity an invitation is matched on at sign-in.
    email text not null
        check (email = lower(email) and char_length(email) between 3 and 320),

    role text not null
        check (role in ('owner', 'admin', 'member', 'viewer')),

    status text not null default 'active'
        check (status in ('invited', 'active', 'suspended')),

    invited_by uuid
        references auth.users(id)
        on delete set null,

    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    -- Only an invitation may exist without a signed-in user behind it.
    check (status = 'invited' or user_id is not null)
);

create unique index if not exists organization_members_org_email_idx
    on organization_members(organization_id, email);

create unique index if not exists organization_members_org_user_idx
    on organization_members(organization_id, user_id)
    where user_id is not null;

create index if not exists organization_members_user_idx
    on organization_members(user_id)
    where user_id is not null;

create index if not exists organization_members_email_idx
    on organization_members(email)
    where status = 'invited';

create table if not exists workspace_members (
    id uuid primary key default gen_random_uuid(),

    organization_id uuid not null
        references organizations(id)
        on delete cascade,

    workspace_id uuid not null
        references workspaces(id)
        on delete cascade,

    member_id uuid not null
        references organization_members(id)
        on delete cascade,

    access text not null
        check (access in ('member', 'viewer')),

    granted_by uuid
        references auth.users(id)
        on delete set null,

    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    unique (workspace_id, member_id)
);

create index if not exists workspace_members_member_idx
    on workspace_members(member_id);

create index if not exists workspace_members_org_idx
    on workspace_members(organization_id);

-- --------------------------------------------------------------------------
-- An organization never loses its last owner.
--
-- Enforced here as well as in the member service, because the service's check
-- and its write are two statements: two admins demoting the only two owners at
-- the same moment would each see the other still in place. Locking the
-- organization row serializes every owner-affecting change for that
-- organization, so the second one sees the first and is refused.
-- --------------------------------------------------------------------------

create or replace function organization_members_keep_an_owner()
returns trigger
language plpgsql
set search_path = public
as $$
declare
    v_losing_owner boolean;
begin
    v_losing_owner := old.role = 'owner'
        and old.status = 'active'
        and (
            tg_op = 'DELETE'
            or new.role <> 'owner'
            or new.status <> 'active'
        );

    if not v_losing_owner then
        return coalesce(new, old);
    end if;

    perform 1 from organizations where id = old.organization_id for update;

    if not exists (
        select 1
        from organization_members
        where organization_id = old.organization_id
          and role = 'owner'
          and status = 'active'
          and id <> old.id
    ) then
        raise exception 'An organization must keep at least one active owner.'
            using errcode = 'P0001';
    end if;

    return coalesce(new, old);
end;
$$;

drop trigger if exists organization_members_keep_an_owner on organization_members;

create trigger organization_members_keep_an_owner
    before update or delete on organization_members
    for each row
    execute function organization_members_keep_an_owner();

alter table organization_members enable row level security;
alter table organization_members force row level security;
alter table workspace_members enable row level security;
alter table workspace_members force row level security;

grant select, insert, update, delete on table organization_members to service_role;
grant select, insert, update, delete on table workspace_members to service_role;
