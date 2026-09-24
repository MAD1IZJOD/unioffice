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
  | "task"
  /**
   * Whether an agent may be handed a piece of company knowledge. Decided per
   * item at recall, so it can only allow or deny.
   */
  | "knowledge_recall"
  /**
   * What happens to knowledge extraction proposes: allow records it as
   * active, require_approval records it as a proposal a person reviews, deny
   * discards it.
   */
  | "knowledge_capture";

export function isKnowledgeSubject(subject: PolicySubject): boolean {
  return subject === "knowledge_recall" || subject === "knowledge_capture";
}

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

  /**
   * Kinds of knowledge this applies to, for knowledge policies. Empty or
   * absent means every kind. Optional so every policy written before
   * knowledge existed still reads as what it always was.
   */
  knowledgeTypes?: string[];
}

/**
 * Who started the mission a step belongs to.
 *
 * "schedule" is a continuous mission's run, started with nobody watching;
 * "person" is everything else. A mission carries no mark unless a schedule
 * started it, so the absence of one reads as a person.
 */
export type MissionStarter = "schedule" | "person";

/**
 * The circumstances a policy is narrowed to, beyond who and what.
 *
 * Scope says which agents, tools and workspaces a rule is about. Conditions
 * say when: only for work a schedule started, only for a step that changes
 * something outside the company. Every condition is a fact the server
 * establishes for itself - who started the mission is on the mission row, and
 * whether a tool writes outside is the tool registry's answer - so a model
 * can neither satisfy one nor talk its way out of one.
 *
 * Like scope, an absent condition means "not narrowed this way", and every
 * condition present must hold for the policy to apply.
 */
export interface PolicyConditions {
  /** Only when the mission was started this way. */
  startedBy?: MissionStarter;

  /** Only when the step, or the tool call, writes to a system outside the company. */
  writesExternally?: boolean;
}

/** Whether a policy is narrowed by any condition at all. */
export function hasPolicyConditions(conditions: PolicyConditions | undefined): boolean {
  return Boolean(conditions && (conditions.startedBy !== undefined || conditions.writesExternally !== undefined));
}

export interface Policy {
  id: PolicyId;

  organizationId: OrganizationId;

  name: string;

  /** Why this rule exists, in the author's words. Shown wherever it fires. */
  description: string;

  subject: PolicySubject;

  scope: PolicyScope;

  /**
   * When the rule applies, beyond its scope. Optional so every policy written
   * before conditions existed still reads as what it always was.
   */
  conditions?: PolicyConditions;

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

  /** Who last changed it. Absent until someone does. */
  updatedBy?: string;

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
