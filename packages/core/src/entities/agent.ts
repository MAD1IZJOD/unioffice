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

  /**
   * The job, as the company names it - "Frontend Engineer". Distinct from
   * the discipline the product reads from the agent's capabilities
   * ("Engineering"), and from `type`, which is how the pipeline uses it.
   * Absent when none was given.
   */
  role?: string;

  description: string;

  type: AgentType;

  status: AgentStatus;

  capabilities: string[];

  toolIds: string[];

  /**
   * Slugs of the skills this agent may be given steps for. Resolved per
   * mission - a workspace's own version of a skill wins over the
   * organization's, which wins over the system's. Assigning a skill grants
   * nothing the agent does not already hold.
   */
  skills?: string[];

  createdAt: Date;

  updatedAt: Date;

  metadata: Record<string, unknown>;
}