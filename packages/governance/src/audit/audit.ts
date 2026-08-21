import type {
  AgentId,
  OrganizationId,
  TaskId,
  WorkId,
} from "@unioffice/core";

export type AuditOutcome =
  | "allowed"
  | "denied"
  | "approval_required"
  | "approved"
  | "rejected"
  | "completed"
  | "failed";

export interface AuditRecord {
  id: string;

  organizationId: OrganizationId;

  agentId?: AgentId;

  workId?: WorkId;

  taskId?: TaskId;

  action: string;

  resource: string;

  outcome: AuditOutcome;

  reason?: string;

  createdAt: Date;

  metadata: Record<string, unknown>;
}

export interface AuditLogger {
  record(
    entry: AuditRecord,
  ): Promise<void>;
}