import type {
  AgentId,
  ApprovalId,
  OrganizationId,
  TaskId,
  WorkId,
} from "../types/ids.js";
import type { ApprovalStatus } from "../types/domain.js";

/** A durable human decision gate attached to a task and its work item. */
export interface ApprovalRequest {
  id: ApprovalId;
  organizationId: OrganizationId;
  workId: WorkId;
  taskId: TaskId;
  agentId?: AgentId;
  action: string;
  resource: string;
  reason: string;
  status: ApprovalStatus;
  createdAt: Date;
  resolvedAt?: Date;
  resolvedBy?: string;
  metadata: Record<string, unknown>;
}
