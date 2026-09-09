import type {
  OrganizationId,
  Workspace,
  WorkspaceId,
} from "@unioffice/core";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { WorkspaceRepository } from "./workspace-repository.js";

interface WorkspaceRow {
  id: string;
  organization_id: string;
  name: string;
  slug: string;
  description: string | null;
  status: Workspace["status"];
  created_at: string;
  updated_at: string;
  metadata: Record<string, unknown> | null;
}

export class SupabaseWorkspaceRepository implements WorkspaceRepository {
  constructor(private readonly client: SupabaseClient) {}

  async create(workspace: Workspace): Promise<Workspace> {
    const { data, error } = await this.client
      .from("workspaces")
      .insert({
        id: workspace.id,
        organization_id: workspace.organizationId,
        name: workspace.name,
        slug: workspace.slug,
        description: workspace.description ?? null,
        status: workspace.status,
        created_at: workspace.createdAt.toISOString(),
        updated_at: workspace.updatedAt.toISOString(),
        metadata: workspace.metadata,
      })
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to create workspace: ${error.message}`);
    }

    return toWorkspace(data as WorkspaceRow);
  }

  async findById(id: WorkspaceId): Promise<Workspace | null> {
    const { data, error } = await this.client
      .from("workspaces")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to find workspace: ${error.message}`);
    }

    return data ? toWorkspace(data as WorkspaceRow) : null;
  }

  async findByOrganization(
    organizationId: OrganizationId,
  ): Promise<Workspace[]> {
    const { data, error } = await this.client
      .from("workspaces")
      .select("*")
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: true });

    if (error) {
      throw new Error(
        `Failed to find organization workspaces: ${error.message}`,
      );
    }

    return ((data as WorkspaceRow[]) ?? []).map(toWorkspace);
  }

  async findBySlug(
    organizationId: OrganizationId,
    slug: string,
  ): Promise<Workspace | null> {
    const { data, error } = await this.client
      .from("workspaces")
      .select("*")
      .eq("organization_id", organizationId)
      .eq("slug", slug)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to find workspace by slug: ${error.message}`);
    }

    return data ? toWorkspace(data as WorkspaceRow) : null;
  }

  async update(workspace: Workspace): Promise<Workspace> {
    // The organization is deliberately not in the update set. A workspace
    // moving between organizations would orphan every agent and work item
    // pointing at it, so that is not an edit this repository can express.
    const { data, error } = await this.client
      .from("workspaces")
      .update({
        name: workspace.name,
        slug: workspace.slug,
        description: workspace.description ?? null,
        status: workspace.status,
        updated_at: workspace.updatedAt.toISOString(),
        metadata: workspace.metadata,
      })
      .eq("id", workspace.id)
      .eq("organization_id", workspace.organizationId)
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to update workspace: ${error.message}`);
    }

    return toWorkspace(data as WorkspaceRow);
  }

  async delete(id: WorkspaceId): Promise<void> {
    const { error } = await this.client
      .from("workspaces")
      .delete()
      .eq("id", id);

    if (error) {
      throw new Error(`Failed to delete workspace: ${error.message}`);
    }
  }
}

function toWorkspace(row: WorkspaceRow): Workspace {
  return {
    id: row.id as WorkspaceId,
    organizationId: row.organization_id as OrganizationId,
    name: row.name,
    slug: row.slug,
    description: row.description ?? undefined,
    status: row.status,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    metadata: row.metadata ?? {},
  };
}
