import type {
  AgentId,
  OrganizationId,
} from "@unioffice/core";

export type PermissionAction =
  | "read"
  | "write"
  | "execute"
  | "delete"
  | "approve";

export interface Permission {
  resource: string;

  action: PermissionAction;
}

export interface PermissionContext {
  organizationId: OrganizationId;

  agentId?: AgentId;

  resource: string;

  action: PermissionAction;

  metadata: Record<string, unknown>;
}

export interface PermissionChecker {
  check(
    context: PermissionContext,
  ): Promise<boolean>;
}