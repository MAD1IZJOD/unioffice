import type {
  Agent,
  AgentId,
  OrganizationId,
} from "@unioffice/core";

import type {
  SupabaseClient,
} from "@supabase/supabase-js";

import type {
  AgentRepository,
} from "./agent-repository.js";

export class SupabaseAgentRepository
  implements AgentRepository
{
  constructor(
    private readonly client: SupabaseClient,
  ) {}

  async create(
    agent: Agent,
  ): Promise<Agent> {
    const { data, error } =
      await this.client
        .from("agents")
        .insert({
          id: agent.id,
          organization_id:
            agent.organizationId,
          workspace_id:
            agent.workspaceId ?? null,
          name: agent.name,
          description:
            agent.description,
          type: agent.type,
          status: agent.status,
          capabilities:
            agent.capabilities,
          tool_ids:
            agent.toolIds,
          created_at:
            agent.createdAt.toISOString(),
          updated_at:
            agent.updatedAt.toISOString(),
          metadata:
            agent.metadata,
        })
        .select()
        .single();

    if (error) {
      throw new Error(
        `Failed to create agent: ${error.message}`,
      );
    }

    return this.mapRow(data);
  }

  async findById(
    id: AgentId,
  ): Promise<Agent | null> {
    const { data, error } =
      await this.client
        .from("agents")
        .select("*")
        .eq("id", id)
        .maybeSingle();

    if (error) {
      throw new Error(
        `Failed to find agent: ${error.message}`,
      );
    }

    return data
      ? this.mapRow(data)
      : null;
  }

  async findByOrganization(
    organizationId: OrganizationId,
  ): Promise<Agent[]> {
    const { data, error } =
      await this.client
        .from("agents")
        .select("*")
        .eq(
          "organization_id",
          organizationId,
        )
        .order("created_at", {
          ascending: true,
        });

    if (error) {
      throw new Error(
        `Failed to find organization agents: ${error.message}`,
      );
    }

    return (data ?? []).map(
      (row) => this.mapRow(row),
    );
  }

  async update(
    agent: Agent,
  ): Promise<Agent> {
    const { data, error } =
      await this.client
        .from("agents")
        .update({
          organization_id:
            agent.organizationId,
          workspace_id:
            agent.workspaceId ?? null,
          name: agent.name,
          description:
            agent.description,
          type: agent.type,
          status: agent.status,
          capabilities:
            agent.capabilities,
          tool_ids:
            agent.toolIds,
          updated_at:
            agent.updatedAt.toISOString(),
          metadata:
            agent.metadata,
        })
        .eq("id", agent.id)
        .select()
        .single();

    if (error) {
      throw new Error(
        `Failed to update agent: ${error.message}`,
      );
    }

    return this.mapRow(data);
  }

  async delete(
    id: AgentId,
  ): Promise<void> {
    const { error } =
      await this.client
        .from("agents")
        .delete()
        .eq("id", id);

    if (error) {
      throw new Error(
        `Failed to delete agent: ${error.message}`,
      );
    }
  }

  private mapRow(
    row: any,
  ): Agent {
    return {
      id: row.id as AgentId,

      organizationId:
        row.organization_id as OrganizationId,

      workspaceId:
        row.workspace_id ?? undefined,

      name: row.name,

      description:
        row.description,

      type: row.type,

      status: row.status,

      capabilities:
        row.capabilities ?? [],

      toolIds:
        row.tool_ids ?? [],

      createdAt:
        new Date(row.created_at),

      updatedAt:
        new Date(row.updated_at),

      metadata:
        row.metadata ?? {},
    };
  }
}