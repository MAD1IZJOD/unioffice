import type {
  MemberId,
  OrganizationId,
  OrganizationMember,
  UserId,
  WorkspaceId,
  WorkspaceMember,
  WorkspaceMemberId,
} from "@unioffice/core";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  LastOwnerError,
  MemberConflictError,
  type MembershipRepository,
} from "./membership-repository.js";

interface MemberRow {
  id: string;
  organization_id: string;
  user_id: string | null;
  email: string;
  role: OrganizationMember["role"];
  status: OrganizationMember["status"];
  invited_by: string | null;
  created_at: string;
  updated_at: string;
}

interface GrantRow {
  id: string;
  organization_id: string;
  workspace_id: string;
  member_id: string;
  access: WorkspaceMember["access"];
  granted_by: string | null;
  created_at: string;
  updated_at: string;
}

const MEMBER_COLUMNS = "id,organization_id,user_id,email,role,status,invited_by,created_at,updated_at";
const GRANT_COLUMNS = "id,organization_id,workspace_id,member_id,access,granted_by,created_at,updated_at";

export class SupabaseMembershipRepository implements MembershipRepository {
  constructor(private readonly client: SupabaseClient) {}

  async findMember(organizationId: OrganizationId, memberId: MemberId): Promise<OrganizationMember | null> {
    const { data, error } = await this.client
      .from("organization_members")
      .select(MEMBER_COLUMNS)
      .eq("organization_id", organizationId)
      .eq("id", memberId)
      .maybeSingle();

    if (error) throw new Error(`Failed to find member: ${error.message}`);
    return data ? toMember(data as MemberRow) : null;
  }

  async findMemberByUser(organizationId: OrganizationId, userId: UserId): Promise<OrganizationMember | null> {
    const { data, error } = await this.client
      .from("organization_members")
      .select(MEMBER_COLUMNS)
      .eq("organization_id", organizationId)
      .eq("user_id", userId)
      .maybeSingle();

    if (error) throw new Error(`Failed to find member: ${error.message}`);
    return data ? toMember(data as MemberRow) : null;
  }

  async findMembershipsForUser(userId: UserId): Promise<OrganizationMember[]> {
    const { data, error } = await this.client
      .from("organization_members")
      .select(MEMBER_COLUMNS)
      .eq("user_id", userId)
      .order("created_at", { ascending: true });

    if (error) throw new Error(`Failed to find memberships: ${error.message}`);
    return ((data ?? []) as MemberRow[]).map(toMember);
  }

  async findInvitationsForEmail(email: string): Promise<OrganizationMember[]> {
    const { data, error } = await this.client
      .from("organization_members")
      .select(MEMBER_COLUMNS)
      .eq("email", email.toLowerCase())
      .eq("status", "invited")
      .is("user_id", null);

    if (error) throw new Error(`Failed to find invitations: ${error.message}`);
    return ((data ?? []) as MemberRow[]).map(toMember);
  }

  async listMembers(organizationId: OrganizationId): Promise<OrganizationMember[]> {
    const { data, error } = await this.client
      .from("organization_members")
      .select(MEMBER_COLUMNS)
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: true })
      .limit(1000);

    if (error) throw new Error(`Failed to list members: ${error.message}`);
    return ((data ?? []) as MemberRow[]).map(toMember);
  }

  async createMember(member: OrganizationMember): Promise<OrganizationMember> {
    const { data, error } = await this.client
      .from("organization_members")
      .insert({
        id: member.id,
        organization_id: member.organizationId,
        user_id: member.userId ?? null,
        email: member.email.toLowerCase(),
        role: member.role,
        status: member.status,
        invited_by: member.invitedBy ?? null,
        created_at: member.createdAt.toISOString(),
        updated_at: member.updatedAt.toISOString(),
      })
      .select(MEMBER_COLUMNS)
      .single();

    if (error) {
      if (error.code === "23505") throw new MemberConflictError();
      throw new Error(`Failed to add member: ${error.message}`);
    }

    return toMember(data as MemberRow);
  }

  async updateMember(member: OrganizationMember): Promise<OrganizationMember> {
    // Only role and status change. The organization and the person a row
    // belongs to are fixed for its lifetime, and are matched rather than set.
    const { data, error } = await this.client
      .from("organization_members")
      .update({
        role: member.role,
        status: member.status,
        updated_at: member.updatedAt.toISOString(),
      })
      .eq("organization_id", member.organizationId)
      .eq("id", member.id)
      .select(MEMBER_COLUMNS)
      .maybeSingle();

    if (error) {
      if (error.code === "P0001") throw new LastOwnerError();
      throw new Error(`Failed to update member: ${error.message}`);
    }

    if (!data) throw new Error("Failed to update member: not found");
    return toMember(data as MemberRow);
  }

  async deleteMember(organizationId: OrganizationId, memberId: MemberId): Promise<void> {
    const { error } = await this.client
      .from("organization_members")
      .delete()
      .eq("organization_id", organizationId)
      .eq("id", memberId);

    if (error) {
      if (error.code === "P0001") throw new LastOwnerError();
      throw new Error(`Failed to remove member: ${error.message}`);
    }
  }

  async claimInvitation(memberId: MemberId, userId: UserId, now: Date): Promise<OrganizationMember | null> {
    // Compare-and-swap on "still an unclaimed invitation", so two sign-ins
    // racing for the same invitation cannot both attach to it.
    const { data, error } = await this.client
      .from("organization_members")
      .update({ user_id: userId, status: "active", updated_at: now.toISOString() })
      .eq("id", memberId)
      .eq("status", "invited")
      .is("user_id", null)
      .select(MEMBER_COLUMNS)
      .maybeSingle();

    if (error) {
      if (error.code === "23505") throw new MemberConflictError();
      throw new Error(`Failed to accept invitation: ${error.message}`);
    }

    return data ? toMember(data as MemberRow) : null;
  }

  async listWorkspaceGrantsForMember(organizationId: OrganizationId, memberId: MemberId): Promise<WorkspaceMember[]> {
    const { data, error } = await this.client
      .from("workspace_members")
      .select(GRANT_COLUMNS)
      .eq("organization_id", organizationId)
      .eq("member_id", memberId);

    if (error) throw new Error(`Failed to read workspace access: ${error.message}`);
    return ((data ?? []) as GrantRow[]).map(toGrant);
  }

  async listWorkspaceGrants(organizationId: OrganizationId): Promise<WorkspaceMember[]> {
    const { data, error } = await this.client
      .from("workspace_members")
      .select(GRANT_COLUMNS)
      .eq("organization_id", organizationId)
      .limit(5000);

    if (error) throw new Error(`Failed to read workspace access: ${error.message}`);
    return ((data ?? []) as GrantRow[]).map(toGrant);
  }

  async grantWorkspace(grant: WorkspaceMember): Promise<WorkspaceMember> {
    const { data, error } = await this.client
      .from("workspace_members")
      .upsert(
        {
          id: grant.id,
          organization_id: grant.organizationId,
          workspace_id: grant.workspaceId,
          member_id: grant.memberId,
          access: grant.access,
          granted_by: grant.grantedBy ?? null,
          created_at: grant.createdAt.toISOString(),
          updated_at: grant.updatedAt.toISOString(),
        },
        // An existing grant keeps its id and creation time; only the level
        // and who last set it change.
        { onConflict: "workspace_id,member_id", ignoreDuplicates: false },
      )
      .select(GRANT_COLUMNS)
      .single();

    if (error) throw new Error(`Failed to grant workspace access: ${error.message}`);
    return toGrant(data as GrantRow);
  }

  async revokeWorkspace(organizationId: OrganizationId, workspaceId: WorkspaceId, memberId: MemberId): Promise<void> {
    const { error } = await this.client
      .from("workspace_members")
      .delete()
      .eq("organization_id", organizationId)
      .eq("workspace_id", workspaceId)
      .eq("member_id", memberId);

    if (error) throw new Error(`Failed to revoke workspace access: ${error.message}`);
  }
}

function toMember(row: MemberRow): OrganizationMember {
  return {
    id: row.id as MemberId,
    organizationId: row.organization_id as OrganizationId,
    userId: row.user_id ? (row.user_id as UserId) : undefined,
    email: row.email,
    role: row.role,
    status: row.status,
    invitedBy: row.invited_by ? (row.invited_by as UserId) : undefined,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

function toGrant(row: GrantRow): WorkspaceMember {
  return {
    id: row.id as WorkspaceMemberId,
    organizationId: row.organization_id as OrganizationId,
    workspaceId: row.workspace_id as WorkspaceId,
    memberId: row.member_id as MemberId,
    access: row.access,
    grantedBy: row.granted_by ? (row.granted_by as UserId) : undefined,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}
