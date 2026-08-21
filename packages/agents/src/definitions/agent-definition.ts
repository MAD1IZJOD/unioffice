import type {
  AgentType,
} from "@unioffice/core";

export interface AgentDefinition {
  id: string;

  name: string;

  description: string;

  type: AgentType;

  systemInstructions: string;

  capabilities: string[];

  toolIds: string[];

  constraints: AgentConstraints;

  metadata: Record<string, unknown>;
}

export interface AgentConstraints {
  maxSteps?: number;

  requiresApprovalFor?: string[];

  allowedDomains?: string[];

  blockedDomains?: string[];
}