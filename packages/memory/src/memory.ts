import type {
  AgentId,
  OrganizationId,
} from "@unioffice/core";

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

export interface Memory {
  id: string;

  organizationId: OrganizationId;

  agentId?: AgentId;

  scope: MemoryScope;

  type: MemoryType;

  content: string;

  source?: string;

  importance: number;

  createdAt: Date;

  updatedAt: Date;

  metadata: Record<string, unknown>;
}