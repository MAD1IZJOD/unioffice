import {
  createEntityId,
  type OrganizationId,
  type UserId,
  type Work,
  type WorkId,
  type WorkPriority,
} from "@unioffice/core";

import type {
  WorkRepository,
} from "@unioffice/database";

import type {
  EventRecorder,
} from "./event-recorder.js";

export interface CreateWorkInput {
  organizationId: OrganizationId;

  workspaceId?: Work["workspaceId"];

  requesterId: UserId;

  objective: string;

  priority?: WorkPriority;

  metadata?: Record<string, unknown>;
}

export class WorkApplicationService {
  constructor(
    private readonly workRepository: WorkRepository,
    private readonly eventRecorder: EventRecorder,
  ) {}

  async createWork(
    input: CreateWorkInput,
  ): Promise<Work> {
    const now = new Date();

    const work: Work = {
      id: createEntityId<"WorkId">() as WorkId,

      organizationId:
        input.organizationId,

      workspaceId:
        input.workspaceId,

      requesterId:
        input.requesterId,

      objective:
        input.objective,

      status: "queued",

      priority:
        input.priority ?? "normal",

      createdAt: now,

      updatedAt: now,

      metadata:
        input.metadata ?? {},
    };

    const createdWork =
      await this.workRepository.create(work);

    await this.eventRecorder.record({
      organizationId: createdWork.organizationId,
      workId: createdWork.id,
      actorType: "user",
      actorId: createdWork.requesterId,
      type: "work.created",
      payload: {
        objective: createdWork.objective,
        priority: createdWork.priority,
      },
    });

    return createdWork;
  }
}
