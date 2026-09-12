import type {
  ActivityEvent,
  GovernanceDecisionRecord,
  PolicyEffect,
  PolicyItem,
  PolicyStatus,
  RiskLevel,
  ToolAccess,
} from "./api";

import type { Tone } from "./tone";

/**
 * Reading governance.
 *
 * The backend decides everything - what a policy does, what it stopped, what
 * risk it carries. This file only chooses how to say it: which colour a state
 * wears and which words go on a label. Nothing here re-derives a decision, so
 * the interface cannot come to a different conclusion than the engine did.
 */

/**
 * Colour carries the same meaning here as everywhere else in the product.
 * Red is a person being needed or something being stopped; blue is the system
 * working; green is quiet approval. Risk deliberately does not colour
 * anything red on its own - a high-risk action that a policy permits is not
 * an alarm, and treating it as one teaches people to ignore the colour.
 */
export function effectTone(effect: PolicyEffect): Tone {
  switch (effect) {
    case "deny":
      return "error";
    case "require_approval":
      return "warning";
    default:
      return "live";
  }
}

export function statusTone(status: PolicyStatus): Tone {
  switch (status) {
    case "active":
      return "active";
    case "paused":
      return "warning";
    case "archived":
      return "idle";
    default:
      return "idle";
  }
}

export function accessTone(access: ToolAccess): Tone {
  switch (access) {
    case "allowed":
      return "live";
    case "requires_approval":
      return "warning";
    case "denied":
      return "error";
    default:
      return "idle";
  }
}

export function decisionTone(
  outcome: GovernanceDecisionRecord["outcome"],
): Tone {
  switch (outcome) {
    case "denied":
      return "error";
    case "approval_required":
      return "warning";
    default:
      return "live";
  }
}

/** Risk reads as weight, not as alarm. */
export function riskTone(risk: RiskLevel): Tone {
  switch (risk) {
    case "critical":
      return "error";
    case "high":
      return "warning";
    case "medium":
      return "active";
    default:
      return "idle";
  }
}

/** What a rule does, in the fewest words that stay true. */
export function effectLabel(effect: PolicyEffect): string {
  switch (effect) {
    case "deny":
      return "Never";
    case "require_approval":
      return "Ask a person";
    default:
      return "Allow";
  }
}

export function accessLabel(access: ToolAccess): string {
  switch (access) {
    case "allowed":
      return "allowed";
    case "requires_approval":
      return "needs approval";
    case "denied":
      return "blocked";
    default:
      return "not granted";
  }
}

export function outcomeLabel(
  outcome: GovernanceDecisionRecord["outcome"],
): string {
  switch (outcome) {
    case "denied":
      return "blocked";
    case "approval_required":
      return "sent to a person";
    default:
      return "allowed";
  }
}

/**
 * A policy's scope as a sentence.
 *
 * An empty scope is the whole company, which is the single most important
 * thing to state plainly - a reader who assumes an unfilled form means
 * "nothing" has the rule exactly backwards.
 */
export function scopeSentence(policy: PolicyItem): string {
  const parts: string[] = [];

  if (policy.scope.agentIds.length > 0) {
    parts.push(
      `${policy.scope.agentIds.length} named ${
        policy.scope.agentIds.length === 1 ? "agent" : "agents"
      }`,
    );
  }

  if (policy.scope.capabilities.length > 0) {
    parts.push(
      `anyone who does ${policy.scope.capabilities
        .map(readableCapability)
        .join(" or ")}`,
    );
  }

  if (policy.scope.toolIds.length > 0) {
    parts.push(
      policy.subject === "tool"
        ? `calls to ${policy.scope.toolIds.join(", ")}`
        : `steps that need ${policy.scope.toolIds.join(", ")}`,
    );
  }

  if (policy.scope.workspaceIds.length > 0) {
    parts.push(
      `${policy.scope.workspaceIds.length} ${
        policy.scope.workspaceIds.length === 1 ? "workspace" : "workspaces"
      }`,
    );
  }

  if (parts.length === 0) {
    return "Everything the company does";
  }

  return capitalize(parts.join(", and "));
}

/**
 * The whole rule as one readable line: who it covers, and what happens.
 *
 * This is what makes a policy understandable without opening it, and it is
 * built from the same fields the engine matches on - so what a reader sees is
 * what the backend will actually do.
 */
export function policySentence(policy: PolicyItem): string {
  const scope = scopeSentence(policy).toLowerCase();

  switch (policy.effect) {
    case "deny":
      return `${capitalize(scope)} — never permitted.`;
    case "require_approval":
      return `${capitalize(scope)} — stops for a person first.`;
    default:
      return `${capitalize(scope)} — explicitly permitted.`;
  }
}

export function readableCapability(capability: string): string {
  return capability.replace(/_/g, " ");
}

/** Policies a reader should look at first: what is live, then what is not. */
export function orderPolicies(policies: PolicyItem[]): PolicyItem[] {
  const rank: Record<PolicyStatus, number> = {
    active: 0,
    draft: 1,
    paused: 2,
    archived: 3,
  };

  return [...policies].sort((left, right) => {
    const byStatus = rank[left.status] - rank[right.status];
    if (byStatus !== 0) return byStatus;

    // Within a status, the rules that stop things come before the rules that
    // permit them - a reader scanning for what constrains the company should
    // not have to read past the permissions to find it.
    const strength: Record<PolicyEffect, number> = {
      deny: 0,
      require_approval: 1,
      allow: 2,
    };

    const byEffect = strength[left.effect] - strength[right.effect];
    if (byEffect !== 0) return byEffect;

    return left.name.localeCompare(right.name);
  });
}

/** What this policy governs, named for a person rather than for the schema. */
export function subjectLabel(policy: PolicyItem): string {
  return policy.subject === "tool" ? "Tool calls" : "Whole steps";
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export interface MissionGovernanceSummary {
  allowed: number;
  approvalRequired: number;
  denied: number;
  /** The rules that took part, newest first, de-duplicated. */
  policyNames: string[];
  /** What was blocked, if anything was. */
  blocked: Array<{ action: string; policyName?: string; summary: string }>;
}

/**
 * What governance did to one mission, counted from its own event log.
 *
 * Read from the mission's own record rather than from a governance query, so
 * the numbers describe this operation and cannot disagree with the timeline
 * printed beside them.
 */
export function summarizeGovernance(
  events: ActivityEvent[],
): MissionGovernanceSummary {
  const summary: MissionGovernanceSummary = {
    allowed: 0,
    approvalRequired: 0,
    denied: 0,
    policyNames: [],
    blocked: [],
  };

  const names = new Set<string>();

  for (const event of events) {
    if (!event.type.startsWith("governance.")) continue;

    const payload = event.payload ?? {};
    const policyName =
      typeof payload.policyName === "string" ? payload.policyName : undefined;

    if (policyName) names.add(policyName);

    if (event.type === "governance.denied") {
      summary.denied += 1;
      summary.blocked.push({
        action:
          typeof payload.action === "string" ? payload.action : "An action",
        policyName,
        summary:
          typeof payload.summary === "string"
            ? payload.summary
            : "A policy refused this.",
      });
    } else if (event.type === "governance.approval_required") {
      summary.approvalRequired += 1;
    } else {
      summary.allowed += 1;
    }
  }

  summary.policyNames = [...names];

  return summary;
}
