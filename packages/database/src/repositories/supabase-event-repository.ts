import type {
  Event,
  EventId,
  WorkId,
} from "@unioffice/core";

import type {
  SupabaseClient,
} from "@supabase/supabase-js";

import type {
  EventRepository,
} from "./event-repository.js";

export class SupabaseEventRepository
  implements EventRepository
{
  constructor(
    private readonly client: SupabaseClient,
  ) {}

  async create(event: Event): Promise<Event> {
    const { data, error } =
      await this.client
        .from("events")
        .insert({
          id: event.id,
          organization_id: event.organizationId,
          work_id: event.workId ?? null,
          task_id: event.taskId ?? null,
          agent_id: event.agentId ?? null,
          actor_type: event.actorType,
          actor_id: event.actorId ?? null,
          type: event.type,
          timestamp: event.timestamp.toISOString(),
          payload: event.payload,
          metadata: event.metadata,
        })
        .select()
        .single();

    if (error) {
      throw new Error(
        `Failed to create event: ${error.message}`,
      );
    }

    return this.mapRow(data);
  }

  async findByWork(workId: WorkId): Promise<Event[]> {
    const { data, error } =
      await this.client
        .from("events")
        .select("*")
        .eq("work_id", workId)
        .order("timestamp", { ascending: true });

    if (error) {
      throw new Error(
        `Failed to find work events: ${error.message}`,
      );
    }

    return (data ?? []).map(
      (row) => this.mapRow(row),
    );
  }

  private mapRow(row: any): Event {
    return {
      id: row.id as EventId,
      organizationId: row.organization_id,
      workId: row.work_id ?? undefined,
      taskId: row.task_id ?? undefined,
      agentId: row.agent_id ?? undefined,
      actorType: row.actor_type,
      actorId: row.actor_id ?? undefined,
      type: row.type,
      timestamp: new Date(row.timestamp),
      payload: row.payload ?? {},
      metadata: row.metadata ?? {},
    };
  }
}
