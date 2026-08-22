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

    return this.workRepository.create(work);
  }
}