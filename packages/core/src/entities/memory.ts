import type {
  AgentId,
  MemoryId,
  OrganizationId,
  TaskId,
  WorkId,
} from "../types/ids.js";

export type MemoryScope =
  | "company"
  | "agent";

export type MemoryType =
  | "fact"
  | "decision"
  | "preference"
  | "instruction"
  | "experience"
  | "document";

/** A retrievable unit of organizational context: a fact, decision, or past outcome. */
export interface Memory {
  id: MemoryId;

  organizationId: OrganizationId;

  agentId?: AgentId;

  workId?: WorkId;

  taskId?: TaskId;

  scope: MemoryScope;

  type: MemoryType;

  content: string;

  source?: string;

  /** 0-1. Higher-importance memories can surface even without a keyword match. */
  importance: number;

  createdAt: Date;

  updatedAt: Date;

  metadata: Record<string, unknown>;
}
