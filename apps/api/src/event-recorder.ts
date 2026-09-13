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

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class EventRecorder {
  constructor(
    private readonly eventRepository: EventRepository,
  ) {}

  async record(
    input: RecordEventInput,
  ): Promise<Event> {
    const actor = normalizeActor(input.actorId);

    return this.eventRepository.create({
      id: createEntityId<"EventId">() as EventId,
      organizationId: input.organizationId,
      workId: input.workId,
      taskId: input.taskId,
      agentId: input.agentId,
      actorType: input.actorType ?? "system",
      actorId: actor.id,
      type: input.type,
      timestamp: new Date(),
      payload: input.payload ?? {},
      metadata: actor.label
        ? { ...input.metadata, actor: actor.label }
        : (input.metadata ?? {}),
    });
  }
}

/**
 * The events table stores the actor as a uuid, while provenance elsewhere is
 * written as "user:<uuid>" or "agent:<uuid>" so a reader can tell a person
 * from an agent. Handing the typed form to the column made every such write
 * fail - and because the audit line is written after the thing it audits, the
 * thing was left recorded but unaudited.
 *
 * So the column gets the uuid, when there is one, and the full label is kept
 * on the event's metadata. An actor that is neither is kept only as the label:
 * an audit line without a column value is better than no audit line.
 */
export function normalizeActor(actorId: string | undefined): {
  id?: string;
  label?: string;
} {
  if (!actorId) {
    return {};
  }

  if (UUID_PATTERN.test(actorId)) {
    return { id: actorId };
  }

  const separator = actorId.indexOf(":");
  const candidate = separator === -1 ? "" : actorId.slice(separator + 1);

  return UUID_PATTERN.test(candidate)
    ? { id: candidate, label: actorId }
    : { label: actorId.slice(0, 200) };
}
