import {
  createEntityId,
  type AgentId,
  type Event,
  type EventId,
  type EventType,
  type OrganizationId,
  type TaskId,
  type WorkId,
} from "@unioffice/core";

import type {
  EventRepository,
} from "@unioffice/database";

export interface RecordEventInput {
  organizationId: OrganizationId;
  type: EventType;
  workId?: WorkId;
  taskId?: TaskId;
  agentId?: AgentId;
  actorType?: Event["actorType"];
  actorId?: string;
  payload?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export class EventRecorder {
  constructor(
    private readonly eventRepository: EventRepository,
  ) {}

  async record(
    input: RecordEventInput,
  ): Promise<Event> {
    return this.eventRepository.create({
      id: createEntityId<"EventId">() as EventId,
      organizationId: input.organizationId,
      workId: input.workId,
      taskId: input.taskId,
      agentId: input.agentId,
      actorType: input.actorType ?? "system",
      actorId: input.actorId,
      type: input.type,
      timestamp: new Date(),
      payload: input.payload ?? {},
      metadata: input.metadata ?? {},
    });
  }
}
