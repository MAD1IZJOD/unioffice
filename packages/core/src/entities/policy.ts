import type {
  AgentId,
  OrganizationId,
  PolicyId,
  WorkspaceId,
} from "../types/ids.js";

/**
 * A rule the company operates under.
 *
 * Governance answers one question - may this agent take this action right now
 * - and a policy is a persisted, human-authored piece of that answer. It is
 * deliberately data rather than code: a rule expressed as a row can be read
 * back, shown to the person it constrains, and audited against a decision
 * that has already been taken. A rule expressed as a branch inside the
 * executor cannot.
 */

/**
 * What happens when a policy matches.
 *
 * These are ordered by strength, and the engine resolves a conflict by taking
 * the strongest rather than the most recent. A company that has said "never"
 * about something should not have that reversed by someone adding a broader
 * permissive rule afterwards.
 */
export type PolicyEffect =
  | "allow"
  | "require_approval"
  | "deny";

/**
 * How much is at stake when the action goes ahead.
 *
 * Risk does not decide anything on its own - the effect does that. It is what
 * a person reads to understand why the effect is what it is, and what the
 * interface uses to decide how loudly to say it.
 */
export type RiskLevel =
  | "low"
  | "medium"
  | "high"
  | "critical";

export type PolicyStatus =
  | "draft"
  | "active"
  | "paused"
  | "archived";

/**
 * What a policy is about.
 *
 * `tool` governs a specific tool call. `task` governs a whole step before any
 * agent starts it. Keeping them apart matters: denying a tool leaves the rest
 * of the step free to proceed without it, while denying a task stops the step.
 */
export type PolicySubject =
  | "tool"
  | "task";

/**
 * Who and what a policy applies to.
 *
 * Every list is an "any of", and an empty list means "not narrowed by this",
 * not "matches nothing" - so a policy with an empty scope applies to the whole
 * organization, which is the only reading that makes an empty form safe.
 */
export interface PolicyScope {
  /** Agents this applies to. Empty means every agent. */
  agentIds: AgentId[];

  /** Tools this applies to. Empty means every tool. */
  toolIds: string[];

  /** Workspaces this applies to. Empty means every workspace. */
  workspaceIds: WorkspaceId[];

  /**
   * Agent capabilities this applies to, matched against what the delegator
   * actually granted the agent. Lets a rule follow a discipline rather than a
   * roster, so it keeps applying when the workforce changes.
   */
  capabilities: string[];
}

export interface Policy {
  id: PolicyId;

  organizationId: OrganizationId;

  name: string;

  /** Why this rule exists, in the author's words. Shown wherever it fires. */
  description: string;

  subject: PolicySubject;

  scope: PolicyScope;

  effect: PolicyEffect;

  risk: RiskLevel;

  status: PolicyStatus;

  /**
   * Shown to the person who has to decide, when the effect is
   * require_approval. Falls back to the description when absent.
   */
  approvalPrompt?: string;

  createdAt: Date;

  updatedAt: Date;

  createdBy?: string;

  metadata: Record<string, unknown>;
}

/** Only an active policy takes part in a decision. */
export function isPolicyEnforced(policy: Policy): boolean {
  return policy.status === "active";
}

/** Strength order, used to resolve two policies that both match. */
export const POLICY_EFFECT_STRENGTH: Record<PolicyEffect, number> = {
  allow: 0,
  require_approval: 1,
  deny: 2,
};

export const RISK_STRENGTH: Record<RiskLevel, number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
};

export function strongestEffect(
  left: PolicyEffect,
  right: PolicyEffect,
): PolicyEffect {
  return POLICY_EFFECT_STRENGTH[left] >= POLICY_EFFECT_STRENGTH[right]
    ? left
    : right;
}

export function highestRisk(left: RiskLevel, right: RiskLevel): RiskLevel {
  return RISK_STRENGTH[left] >= RISK_STRENGTH[right] ? left : right;
}
