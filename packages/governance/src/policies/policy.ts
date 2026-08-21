import type {
  AgentId,
  OrganizationId,
} from "@unioffice/core";

import type {
  PermissionAction,
} from "../permissions/permission.js";

export type PolicyDecision =
  | "allow"
  | "deny"
  | "require_approval";

export interface PolicyContext {
  organizationId: OrganizationId;

  agentId?: AgentId;

  resource: string;

  action: PermissionAction;

  metadata: Record<string, unknown>;
}

export interface Policy {
  id: string;

  name: string;

  description: string;

  evaluate(
    context: PolicyContext,
  ): Promise<PolicyDecision>;
}

export interface PolicyEngine {
  evaluate(
    context: PolicyContext,
  ): Promise<PolicyDecision>;
}