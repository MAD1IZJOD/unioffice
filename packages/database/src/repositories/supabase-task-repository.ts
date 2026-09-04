import type {
  Task,
  TaskId,
  WorkId,
} from "@unioffice/core";

import type {
  SupabaseClient,
} from "@supabase/supabase-js";

import type {
  TaskRepository,
} from "./task-repository.js";

export class SupabaseTaskRepository
  implements TaskRepository
{
  constructor(
    private readonly client: SupabaseClient,
  ) {}

  async create(
    task: Task,
  ): Promise<Task> {
    const { data, error } =
      await this.client
        .from("tasks")
        .insert({
          id: task.id,

          work_id:
            task.workId,

          parent_task_id:
            task.parentTaskId ?? null,

          assigned_agent_id:
            task.assignedAgentId ?? null,

          title:
            task.title,

          description:
            task.description,

          status:
            task.status,

          depends_on:
            task.dependsOn,

          result:
            task.result ?? null,

          created_at:
            task.createdAt.toISOString(),

          updated_at:
            task.updatedAt.toISOString(),

          started_at:
            task.startedAt?.toISOString() ??
            null,

          completed_at:
            task.completedAt?.toISOString() ??
            null,

          metadata:
            task.metadata,
        })
        .select()
        .single();

    if (error) {
      throw new Error(
        `Failed to create task: ${error.message}`,
      );
    }

    return this.mapRow(data);
  }

  async findById(
    id: TaskId,
  ): Promise<Task | null> {
    const { data, error } =
      await this.client
        .from("tasks")
        .select("*")
        .eq("id", id)
        .maybeSingle();

    if (error) {
      throw new Error(
        `Failed to find task: ${error.message}`,
      );
    }

    return data
      ? this.mapRow(data)
      : null;
  }

  async findByWork(
    workId: WorkId,
  ): Promise<Task[]> {
    const { data, error } =
      await this.client
        .from("tasks")
        .select("*")
        .eq("work_id", workId)
        .order("created_at", {
          ascending: true,
        });

    if (error) {
      throw new Error(
        `Failed to find work tasks: ${error.message}`,
      );
    }

    return (data ?? []).map(
      (row) => this.mapRow(row),
    );
  }

  async claimReadyForExecution(
    id: TaskId,
    startedAt: Date,
  ): Promise<Task | null> {
    const { data, error } = await this.client
      .from("tasks")
      .update({
        status: "running",
        started_at: startedAt.toISOString(),
        updated_at: startedAt.toISOString(),
      })
      .eq("id", id)
      .eq("status", "ready")
      .select()
      .maybeSingle();

    if (error) {
      throw new Error(
        `Failed to claim task for execution: ${error.message}`,
      );
    }

    return data ? this.mapRow(data) : null;
  }

  async update(
    task: Task,
  ): Promise<Task> {
    const { data, error } =
      await this.client
        .from("tasks")
        .update({
          work_id:
            task.workId,

          parent_task_id:
            task.parentTaskId ?? null,

          assigned_agent_id:
            task.assignedAgentId ?? null,

          title:
            task.title,

          description:
            task.description,

          status:
            task.status,

          depends_on:
            task.dependsOn,

          result:
            task.result ?? null,

          updated_at:
            task.updatedAt.toISOString(),

          started_at:
            task.startedAt?.toISOString() ??
            null,

          completed_at:
            task.completedAt?.toISOString() ??
            null,

          metadata:
            task.metadata,
        })
        .eq("id", task.id)
        .select()
        .single();

    if (error) {
      throw new Error(
        `Failed to update task: ${error.message}`,
      );
    }

    return this.mapRow(data);
  }

  async delete(
    id: TaskId,
  ): Promise<void> {
    const { error } =
      await this.client
        .from("tasks")
        .delete()
        .eq("id", id);

    if (error) {
      throw new Error(
        `Failed to delete task: ${error.message}`,
      );
    }
  }

  private mapRow(
    row: any,
  ): Task {
    return {
      id:
        row.id as TaskId,

      workId:
        row.work_id as WorkId,

      parentTaskId:
        row.parent_task_id ??
        undefined,

      title:
        row.title,

      description:
        row.description,

      status:
        row.status,

      assignedAgentId:
        row.assigned_agent_id ??
        undefined,

      dependsOn:
        row.depends_on ?? [],

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

      result:
        row.result ?? undefined,
      metadata:
        row.metadata ?? {},
    };
  }
}
