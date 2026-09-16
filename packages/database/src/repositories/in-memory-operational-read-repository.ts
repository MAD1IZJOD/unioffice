import type {
  AgentId,
  Artifact,
  Event,
  OrganizationId,
  Task,
  Work,
  WorkId,
} from "@unioffice/core";

import {
  summarizeWork,
  type ArtifactSummary,
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
    readonly artifacts: Artifact[] = [],
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
      .map(toTaskSummary);
  }

  async findWorkSummariesByIds(
    organizationId: OrganizationId,
    workIds: WorkId[],
  ): Promise<WorkSummary[]> {
    const wanted = new Set(workIds);

    return this.works
      .filter((work) => work.organizationId === organizationId && wanted.has(work.id))
      .map((work) => summarizeWork(structuredClone(work)));
  }

  async findTaskSummariesByAgent(agentId: AgentId, limit: number): Promise<TaskSummary[]> {
    return this.tasks
      .filter((task) => task.assignedAgentId === agentId)
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
      .slice(0, Math.max(0, limit))
      .map(toTaskSummary);
  }

  async findArtifactSummariesByAgent(
    organizationId: OrganizationId,
    agentId: AgentId,
    limit: number,
  ): Promise<ArtifactSummary[]> {
    return this.artifacts
      .filter((artifact) => artifact.organizationId === organizationId && artifact.createdByAgentId === agentId)
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
      .slice(0, Math.max(0, limit))
      .map((artifact) => ({
        id: artifact.id,
        organizationId: artifact.organizationId,
        workId: artifact.workId,
        taskId: artifact.taskId,
        name: artifact.name,
        type: artifact.type,
        createdAt: artifact.createdAt,
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
        (!works || (event.workId !== undefined && works.has(event.workId))) &&
        (!query.agentId || event.agentId === query.agentId))
      .sort((left, right) => right.timestamp.getTime() - left.timestamp.getTime())
      .slice(0, Math.max(0, query.limit))
      .map((event) => structuredClone(event));
  }
}

function toTaskSummary(task: Task): TaskSummary {
  return {
    id: task.id,
    workId: task.workId,
    title: task.title,
    status: task.status,
    assignedAgentId: task.assignedAgentId,
    startedAt: task.startedAt,
    completedAt: task.completedAt,
    updatedAt: task.updatedAt,
  };
}
