import type {
  OrganizationId,
  Work,
  WorkId,
} from "@unioffice/core";

import type {
  SupabaseClient,
} from "@supabase/supabase-js";

import type {
  WorkRepository,
} from "./work-repository.js";

export class SupabaseWorkRepository
  implements WorkRepository
{
  constructor(
    private readonly client: SupabaseClient,
  ) {}

  async create(
    work: Work,
  ): Promise<Work> {
    const { data, error } =
      await this.client
        .from("works")
        .insert({
          id: work.id,

          organization_id:
            work.organizationId,

          workspace_id:
            work.workspaceId ?? null,

          requester_id:
            work.requesterId,

          objective:
            work.objective,

          status:
            work.status,

          priority:
            work.priority,

          created_at:
            work.createdAt.toISOString(),

          updated_at:
            work.updatedAt.toISOString(),

          started_at:
            work.startedAt?.toISOString() ??
            null,

          completed_at:
            work.completedAt?.toISOString() ??
            null,

          metadata:
            work.metadata,
        })
        .select()
        .single();

    if (error) {
      throw new Error(
        `Failed to create work: ${error.message}`,
      );
    }

    return this.mapRow(data);
  }

  async findById(
    id: WorkId,
  ): Promise<Work | null> {
    const { data, error } =
      await this.client
        .from("works")
        .select("*")
        .eq("id", id)
        .maybeSingle();

    if (error) {
      throw new Error(
        `Failed to find work: ${error.message}`,
      );
    }

    return data
      ? this.mapRow(data)
      : null;
  }

  async findByOrganization(
    organizationId: OrganizationId,
  ): Promise<Work[]> {
    const { data, error } =
      await this.client
        .from("works")
        .select("*")
        .eq(
          "organization_id",
          organizationId,
        )
        .order("created_at", {
          ascending: false,
        });

    if (error) {
      throw new Error(
        `Failed to find organization work: ${error.message}`,
      );
    }

    return (data ?? []).map(
      (row) => this.mapRow(row),
    );
  }

  async update(
    work: Work,
  ): Promise<Work> {
    const { data, error } =
      await this.client
        .from("works")
        .update({
          organization_id:
            work.organizationId,

          workspace_id:
            work.workspaceId ?? null,

          requester_id:
            work.requesterId,

          objective:
            work.objective,

          status:
            work.status,

          priority:
            work.priority,

          updated_at:
            work.updatedAt.toISOString(),

          started_at:
            work.startedAt?.toISOString() ??
            null,

          completed_at:
            work.completedAt?.toISOString() ??
            null,

          metadata:
            work.metadata,
        })
        .eq("id", work.id)
        .select()
        .single();

    if (error) {
      throw new Error(
        `Failed to update work: ${error.message}`,
      );
    }

    return this.mapRow(data);
  }

  async delete(
    id: WorkId,
  ): Promise<void> {
    const { error } =
      await this.client
        .from("works")
        .delete()
        .eq("id", id);

    if (error) {
      throw new Error(
        `Failed to delete work: ${error.message}`,
      );
    }
  }

  private mapRow(
    row: any,
  ): Work {
    return {
      id: row.id as WorkId,

      organizationId:
        row.organization_id as OrganizationId,

      workspaceId:
        row.workspace_id ?? undefined,

      requesterId:
        row.requester_id,

      objective:
        row.objective,

      status:
        row.status,

      priority:
        row.priority,

      createdAt:
        new Date(row.created_at),

      updatedAt:
        new Date(row.updated_at),

      startedAt:
        row.started_at
          ? new Date(row.started_at)
          : undefined,

      completedAt:
        row.completed_at
          ? new Date(row.completed_at)
          : undefined,

      metadata:
        row.metadata ?? {},
    };
  }
}