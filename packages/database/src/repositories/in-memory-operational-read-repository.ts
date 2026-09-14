import type {
  Event,
  OrganizationId,
  Task,
  Work,
  WorkId,
} from "@unioffice/core";

import {
  summarizeWork,
  type OperationalEventQuery,
  type OperationalReadRepository,
  type TaskSummary,
  type WorkSummary,
} from "./operational-read-repository.js";

/**
 * The operational reads without a database.
 *
 * Holds full rows and projects them the same way the real store does, so a
 * test that passes here is exercising the tenant boundary, the ordering and
 * the bounds rather than a friendlier version of them.
 */
export class InMemoryOperationalReadRepository implements OperationalReadRepository {
  constructor(
    readonly works: Work[] = [],
    readonly tasks: Task[] = [],
    readonly events: Event[] = [],
  ) {}

  async findWorkSummaries(
    organizationId: OrganizationId,
    limit: number,
  ): Promise<WorkSummary[]> {
    return this.works
      .filter((work) => work.organizationId === organizationId)
      .sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime())
      .slice(0, Math.max(0, limit))
      .map((work) => summarizeWork(structuredClone(work)));
  }

  async findTaskSummaries(workIds: WorkId[]): Promise<TaskSummary[]> {
    const wanted = new Set(workIds);

    return this.tasks
      .filter((task) => wanted.has(task.workId))
      .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime())
      .map((task) => ({
        id: task.id,
        workId: task.workId,
        title: task.title,
        status: task.status,
        assignedAgentId: task.assignedAgentId,
        startedAt: task.startedAt,
        completedAt: task.completedAt,
        updatedAt: task.updatedAt,
      }));
  }

  async findEventsByTypes(
    organizationId: OrganizationId,
    query: OperationalEventQuery,
  ): Promise<Event[]> {
    const types = new Set(query.types);
    const works = query.workIds ? new Set(query.workIds) : undefined;

    return this.events
      .filter((event) =>
        event.organizationId === organizationId &&
        types.has(event.type) &&
        (!works || (event.workId !== undefined && works.has(event.workId))))
      .sort((left, right) => right.timestamp.getTime() - left.timestamp.getTime())
      .slice(0, Math.max(0, query.limit))
      .map((event) => structuredClone(event));
  }
}
