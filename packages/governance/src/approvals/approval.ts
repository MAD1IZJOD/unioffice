import type {
  AgentId,
  OrganizationId,
  WorkId,
  TaskId,
} from "@unioffice/core";

export type ApprovalStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "expired"
  | "cancelled";

export interface ApprovalRequest {
  id: string;

  organizationId: OrganizationId;

  agentId?: AgentId;

  workId?: WorkId;

  taskId?: TaskId;

  action: string;

  resource: string;

  reason: string;

  status: ApprovalStatus;

  createdAt: Date;

  resolvedAt?: Date;

  resolvedBy?: string;

  metadata: Record<string, unknown>;
}

export interface ApprovalService {
  request(
    approval: ApprovalRequest,
  ): Promise<ApprovalRequest>;

  get(
    id: string,
  ): Promise<ApprovalRequest | null>;

  approve(
    id: string,
    resolvedBy: string,
  ): Promise<ApprovalRequest>;

  reject(
    id: string,
    resolvedBy: string,
  ): Promise<ApprovalRequest>;
}