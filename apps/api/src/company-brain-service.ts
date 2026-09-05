import {
  createEntityId,
  type AgentId,
  type Memory,
  type MemoryId,
  type OrganizationId,
  type TaskId,
  type WorkId,
} from "@unioffice/core";

import type {
  MemoryRepository,
} from "@unioffice/database";

import type {
  MemoryRetriever,
} from "@unioffice/memory";

export interface TaskOutcomeMemory {
  organizationId: OrganizationId;

  agentId?: AgentId;

  workId: WorkId;

  taskId: TaskId;

  title: string;

  status: "completed" | "failed";

  summary: string;
}

export interface RelevantMemoryQuery {
  organizationId: OrganizationId;

  agentId?: AgentId;

  query: string;

  limit?: number;
}

const MAX_SUMMARY_CHARS = 500;

/**
 * The company's small, queryable record of what happened and why. Every
 * completed or failed task leaves a memory; agents retrieve relevant prior
 * memories before executing a new task instead of starting from nothing.
 */
export class CompanyBrainService {
  constructor(
    private readonly memoryRepository: MemoryRepository,
    private readonly memoryRetriever: MemoryRetriever,
  ) {}

  async recordTaskOutcome(outcome: TaskOutcomeMemory): Promise<Memory> {
    const now = new Date();

    return this.memoryRepository.create({
      id: createEntityId<"MemoryId">() as MemoryId,
      organizationId: outcome.organizationId,
      agentId: outcome.agentId,
      workId: outcome.workId,
      taskId: outcome.taskId,
      scope: "company",
      type: outcome.status === "completed" ? "experience" : "decision",
      content: `Task "${outcome.title}" ${outcome.status}: ${truncate(outcome.summary, MAX_SUMMARY_CHARS)}`,
      source: `task:${outcome.taskId}`,
      importance: outcome.status === "failed" ? 0.7 : 0.5,
      createdAt: now,
      updatedAt: now,
      metadata: { status: outcome.status },
    });
  }

  async retrieveRelevant(query: RelevantMemoryQuery): Promise<Memory[]> {
    return this.memoryRetriever.retrieve(query);
  }

  async listByOrganization(organizationId: OrganizationId): Promise<Memory[]> {
    return this.memoryRepository.query({ organizationId, limit: 100 });
  }
}

function truncate(value: string, maxChars: number): string {
  return value.length <= maxChars ? value : `${value.slice(0, maxChars)}…`;
}
