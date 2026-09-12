import type {
  Policy,
  RiskLevel,
} from "@unioffice/core";

import {
  isPolicyEnforced,
  strongestEffect,
} from "@unioffice/core";

/**
 * What an agent may actually do with a tool.
 *
 * This is the read-only projection the Governance Center renders. It answers
 * the question the interface has - "can Harvey use the calculator, and under
 * what conditions" - without running an evaluation for an action nobody has
 * attempted yet.
 *
 * It is emphatically not an enforcement point. Nothing consults this before
 * executing; the engine does that, at the moment of the call, with the real
 * context. Showing a permission and enforcing one are different jobs, and a
 * projection that drifts is a display bug rather than a security hole.
 */
export type EffectiveAccess =
  | "allowed"
  | "requires_approval"
  | "denied"
  /** The agent was never granted this tool, so no policy needs to say no. */
  | "not_granted";

export interface EffectivePermission {
  toolId: string;

  access: EffectiveAccess;

  risk: RiskLevel;

  /** The policies that shaped this, newest concern first. Often empty. */
  policyIds: string[];
  policyNames: string[];

  /** One line explaining the access, for the interface to show as-is. */
  explanation: string;
}

export interface PermissionInputs {
  /** Tool grants the agent actually holds on its row. */
  grantedToolIds: string[];

  /** Capabilities the agent actually holds. */
  capabilities: string[];

  agentId?: string;

  workspaceId?: string;

  /** Every tool the registry knows about, with its baseline risk. */
  tools: Array<{ id: string; risk: RiskLevel }>;

  /** The organization's policies. Non-active ones are ignored here too. */
  policies: Policy[];
}

/**
 * Projects one agent's effective tool access.
 *
 * Deliberately mirrors the engine's rules rather than sharing its code path:
 * the engine takes an action and a live context, this takes a roster row. The
 * shared part - "strongest effect wins", "an empty scope is company-wide" -
 * lives in core so the two cannot disagree about that much.
 */
export function effectivePermissions(
  inputs: PermissionInputs,
): EffectivePermission[] {
  const enforced = inputs.policies.filter(isPolicyEnforced);

  return inputs.tools.map((tool) => {
    if (!inputs.grantedToolIds.includes(tool.id)) {
      return {
        toolId: tool.id,
        access: "not_granted",
        risk: tool.risk,
        policyIds: [],
        policyNames: [],
        explanation:
          "This agent has not been granted this tool, so it cannot call it.",
      };
    }

    const matching = enforced.filter(
      (policy) =>
        policy.subject === "tool" &&
        scopeCovers(policy, tool.id, inputs),
    );

    if (matching.length === 0) {
      return {
        toolId: tool.id,
        access: "allowed",
        risk: tool.risk,
        policyIds: [],
        policyNames: [],
        explanation: "Granted, and no policy restricts it.",
      };
    }

    const effect = matching.reduce(
      (worst, policy) => strongestEffect(worst, policy.effect),
      "allow" as Policy["effect"],
    );

    const risk = matching.reduce<RiskLevel>(
      (worst, policy) => worseRisk(worst, policy.risk),
      tool.risk,
    );

    const names = matching.map((policy) => policy.name);

    return {
      toolId: tool.id,
      access:
        effect === "deny"
          ? "denied"
          : effect === "require_approval"
            ? "requires_approval"
            : "allowed",
      risk,
      policyIds: matching.map((policy) => policy.id),
      policyNames: names,
      explanation:
        effect === "deny"
          ? `Blocked by ${names.join(", ")}.`
          : effect === "require_approval"
            ? `Allowed, but a person has to approve each use under ${names.join(", ")}.`
            : `Explicitly permitted by ${names.join(", ")}.`,
    };
  });
}

function scopeCovers(
  policy: Policy,
  toolId: string,
  inputs: PermissionInputs,
): boolean {
  const { scope } = policy;

  if (
    scope.agentIds.length > 0 &&
    (!inputs.agentId || !scope.agentIds.includes(inputs.agentId as never))
  ) {
    return false;
  }

  if (
    scope.workspaceIds.length > 0 &&
    (!inputs.workspaceId ||
      !scope.workspaceIds.includes(inputs.workspaceId as never))
  ) {
    return false;
  }

  if (
    scope.capabilities.length > 0 &&
    !scope.capabilities.some((capability) =>
      inputs.capabilities.includes(capability),
    )
  ) {
    return false;
  }

  if (scope.toolIds.length > 0 && !scope.toolIds.includes(toolId)) {
    return false;
  }

  return true;
}

const RISK_ORDER: RiskLevel[] = ["low", "medium", "high", "critical"];

function worseRisk(left: RiskLevel, right: RiskLevel): RiskLevel {
  return RISK_ORDER.indexOf(left) >= RISK_ORDER.indexOf(right) ? left : right;
}
