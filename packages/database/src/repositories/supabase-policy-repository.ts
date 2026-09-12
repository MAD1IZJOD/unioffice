import type {
  AgentId,
  OrganizationId,
  Policy,
  PolicyId,
  WorkspaceId,
} from "@unioffice/core";

import type {
  SupabaseClient,
} from "@supabase/supabase-js";

import type {
  PolicyQuery,
  PolicyRepository,
} from "./policy-repository.js";

export class SupabasePolicyRepository
  implements PolicyRepository
{
  constructor(
    private readonly client: SupabaseClient,
  ) {}

  async create(policy: Policy): Promise<Policy> {
    const { data, error } =
      await this.client
        .from("policies")
        .insert(toRow(policy))
        .select()
        .single();

    if (error) {
      // The unique index on (organization, name) is a real constraint rather
      // than a race: two rules with one name make an audit line ambiguous
      // about which one fired. Say so in the caller's terms.
      if (error.code === "23505") {
        throw new Error(
          `A policy called "${policy.name}" already exists in this organization.`,
        );
      }

      throw new Error(
        `Failed to create policy: ${error.message}`,
      );
    }

    return this.mapRow(data);
  }

  async findById(id: PolicyId): Promise<Policy | null> {
    const { data, error } =
      await this.client
        .from("policies")
        .select("*")
        .eq("id", id)
        .maybeSingle();

    if (error) {
      throw new Error(
        `Failed to find policy: ${error.message}`,
      );
    }

    return data ? this.mapRow(data) : null;
  }

  async findByOrganization(
    organizationId: OrganizationId,
    query: PolicyQuery = {},
  ): Promise<Policy[]> {
    let request = this.client
      .from("policies")
      .select("*")
      .eq("organization_id", organizationId);

    if (query.subject) {
      request = request.eq("subject", query.subject);
    }

    if (!query.includeArchived) {
      request = request.neq("status", "archived");
    }

    const { data, error } = await request.order("created_at", {
      ascending: false,
    });

    if (error) {
      throw new Error(
        `Failed to list policies: ${error.message}`,
      );
    }

    return (data ?? []).map((row) => this.mapRow(row));
  }

  async findEnforced(
    organizationId: OrganizationId,
  ): Promise<Policy[]> {
    const { data, error } =
      await this.client
        .from("policies")
        .select("*")
        .eq("organization_id", organizationId)
        .eq("status", "active")
        .order("created_at", { ascending: true });

    if (error) {
      throw new Error(
        `Failed to read enforced policies: ${error.message}`,
      );
    }

    return (data ?? []).map((row) => this.mapRow(row));
  }

  async update(policy: Policy): Promise<Policy> {
    const { data, error } =
      await this.client
        .from("policies")
        .update(toRow(policy))
        .eq("id", policy.id)
        .select()
        .single();

    if (error) {
      if (error.code === "23505") {
        throw new Error(
          `A policy called "${policy.name}" already exists in this organization.`,
        );
      }

      throw new Error(
        `Failed to update policy: ${error.message}`,
      );
    }

    return this.mapRow(data);
  }

  private mapRow(row: any): Policy {
    return {
      id: row.id as PolicyId,
      organizationId: row.organization_id,
      name: row.name,
      description: row.description ?? "",
      subject: row.subject,
      scope: {
        agentIds: (row.agent_ids ?? []) as AgentId[],
        toolIds: (row.tool_ids ?? []) as string[],
        workspaceIds: (row.workspace_ids ?? []) as WorkspaceId[],
        capabilities: (row.capabilities ?? []) as string[],
      },
      effect: row.effect,
      risk: row.risk,
      status: row.status,
      approvalPrompt: row.approval_prompt ?? undefined,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
      createdBy: row.created_by ?? undefined,
      metadata: row.metadata ?? {},
    };
  }
}

function toRow(policy: Policy): Record<string, unknown> {
  return {
    id: policy.id,
    organization_id: policy.organizationId,
    name: policy.name,
    description: policy.description,
    subject: policy.subject,
    effect: policy.effect,
    risk: policy.risk,
    status: policy.status,
    agent_ids: policy.scope.agentIds,
    tool_ids: policy.scope.toolIds,
    workspace_ids: policy.scope.workspaceIds,
    capabilities: policy.scope.capabilities,
    approval_prompt: policy.approvalPrompt ?? null,
    created_at: policy.createdAt.toISOString(),
    updated_at: policy.updatedAt.toISOString(),
    created_by: policy.createdBy ?? null,
    metadata: policy.metadata,
  };
}
