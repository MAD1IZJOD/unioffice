import type {
  AgentId,
  OrganizationId,
  WorkspaceId,
} from "../types/ids.js";

export type AgentStatus =
  | "active"
  | "paused"
  | "disabled";

export type AgentType =
  | "specialist"
  | "manager"
  | "orchestrator";

export interface Agent {
  id: AgentId;

  organizationId: OrganizationId;

  workspaceId?: WorkspaceId;

  name: string;

  description: string;

  type: AgentType;

  status: AgentStatus;

  capabilities: string[];

  toolIds: string[];

  createdAt: Date;

  updatedAt: Date;

  metadata: Record<string, unknown>;
}