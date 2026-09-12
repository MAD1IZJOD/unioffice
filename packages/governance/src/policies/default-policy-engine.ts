import {
  highestRisk,
  isPolicyEnforced,
  POLICY_EFFECT_STRENGTH,
  RISK_STRENGTH,
  type Policy,
  type RiskLevel,
} from "@unioffice/core";

import {
  subjectMatches,
  type GovernanceAction,
  type GovernanceContext,
  type GovernanceDecision,
  type GovernanceReason,
  type PolicyEngine,
} from "./policy.js";

/**
 * The company's rules, applied.
 *
 * Three properties matter more than anything this file does cleverly, and it
 * is deliberately dull in order to keep them:
 *
 * 1. Deterministic. No model, no clock, no randomness. The same policies and
 *    the same context always give the same answer, which is the only reason a
 *    recorded decision can be trusted after the fact.
 * 2. Strongest wins. A conflict resolves to the most restrictive effect, not
 *    the newest or the narrowest policy. Someone adding a broad permissive
 *    rule must not be able to quietly undo a "never".
 * 3. Additive only. Governance can restrict what an agent may do; it can
 *    never grant something the tool registry has not already granted. The
 *    registry stays authoritative and this sits on top of it.
 */
export class DefaultPolicyEngine implements PolicyEngine {
  evaluate(
    action: GovernanceAction,
    context: GovernanceContext,
    policies: Policy[],
  ): GovernanceDecision {
    const matched = policies
      .filter(isPolicyEnforced)
      .filter((policy) => policy.organizationId === context.organizationId)
      .filter((policy) => subjectMatches(policy.subject, action))
      .filter((policy) => scopeMatches(policy, action, context));

    if (matched.length === 0) {
      return this.ungoverned(action);
    }

    // Strongest effect first, then highest risk, then id - so two policies of
    // equal weight always resolve the same way rather than in whatever order
    // the database happened to return them.
    const ordered = [...matched].sort((left, right) => {
      const byEffect =
        POLICY_EFFECT_STRENGTH[right.effect] -
        POLICY_EFFECT_STRENGTH[left.effect];
      if (byEffect !== 0) return byEffect;

      const byRisk = RISK_STRENGTH[right.risk] - RISK_STRENGTH[left.risk];
      if (byRisk !== 0) return byRisk;

      return left.id.localeCompare(right.id);
    });

    const deciding = ordered[0]!;

    const risk = ordered.reduce<RiskLevel>(
      (worst, policy) => highestRisk(worst, policy.risk),
      baselineRisk(action),
    );

    const reasons: GovernanceReason[] = ordered.map((policy) => ({
      policyId: policy.id,
      policyName: policy.name,
      effect: policy.effect,
      risk: policy.risk,
      explanation: explain(policy, action, context),
    }));

    return {
      outcome: deciding.effect,
      risk,
      reasons,
      decidingPolicyId: deciding.id,
      decidingPolicyName: deciding.name,
      summary: summarize(deciding, action, ordered.length),
      approvalPrompt:
        deciding.effect === "require_approval"
          ? (deciding.approvalPrompt?.trim() || deciding.description)
          : undefined,
    };
  }

  /**
   * Nothing the company has written applies here.
   *
   * That is an allow, and it is stated as one rather than dressed up as a
   * policy decision - an audit trail that invents a rule to explain an
   * unremarkable action is worse than one that says plainly that no rule
   * applied.
   */
  private ungoverned(action: GovernanceAction): GovernanceDecision {
    return {
      outcome: "allow",
      risk: baselineRisk(action),
      reasons: [],
      summary:
        action.kind === "tool"
          ? `No policy restricts ${action.toolId}, and the agent is authorized for it.`
          : "No policy applies to this step.",
    };
  }
}

/**
 * A tool's own risk when no policy has an opinion. A step with no tools is
 * low risk by default; nothing it can do has reach outside the company.
 */
function baselineRisk(action: GovernanceAction): RiskLevel {
  return action.kind === "tool" ? (action.toolRisk ?? "low") : "low";
}

/**
 * Whether a policy's scope covers this action.
 *
 * Every dimension is an "any of", and dimensions combine with "and". An empty
 * list means the policy is simply not narrowed that way - which is the only
 * reading that makes an unfilled form mean "company-wide" rather than
 * "matches nothing".
 */
function scopeMatches(
  policy: Policy,
  action: GovernanceAction,
  context: GovernanceContext,
): boolean {
  const { scope } = policy;

  if (
    scope.agentIds.length > 0 &&
    (!context.agentId || !scope.agentIds.includes(context.agentId))
  ) {
    return false;
  }

  if (
    scope.workspaceIds.length > 0 &&
    (!context.workspaceId || !scope.workspaceIds.includes(context.workspaceId))
  ) {
    return false;
  }

  if (
    scope.capabilities.length > 0 &&
    !scope.capabilities.some((capability) =>
      context.agentCapabilities.includes(capability),
    )
  ) {
    return false;
  }

  if (scope.toolIds.length > 0) {
    // For a tool call this is the tool being called. For a step it is the
    // tools the plan says the step needs - so "no financial tools in the
    // engineering workspace" can stop the step before an agent starts it,
    // rather than only stopping the call once it is under way.
    const tools =
      action.kind === "tool" ? [action.toolId] : action.requiredTools;

    if (!tools.some((toolId) => scope.toolIds.includes(toolId))) {
      return false;
    }
  }

  return true;
}

/** Why this policy matched, in terms of the thing being evaluated. */
function explain(
  policy: Policy,
  action: GovernanceAction,
  context: GovernanceContext,
): string {
  const parts: string[] = [];

  if (policy.scope.agentIds.length > 0) {
    parts.push("this agent is named in its scope");
  }

  if (policy.scope.capabilities.length > 0) {
    const matching = policy.scope.capabilities.filter((capability) =>
      context.agentCapabilities.includes(capability),
    );

    if (matching.length > 0) {
      parts.push(`the agent holds ${matching.join(", ")}`);
    }
  }

  if (policy.scope.workspaceIds.length > 0) {
    parts.push("it runs in a workspace the policy covers");
  }

  if (policy.scope.toolIds.length > 0) {
    parts.push(
      action.kind === "tool"
        ? `${action.toolId} is covered by the policy`
        : "this step needs a tool the policy covers",
    );
  }

  if (parts.length === 0) {
    return "it applies across the whole company";
  }

  return parts.join(" and ");
}

function summarize(
  policy: Policy,
  action: GovernanceAction,
  matchedCount: number,
): string {
  const subject =
    action.kind === "tool" ? `Using ${action.toolId}` : `“${action.title}”`;

  const also =
    matchedCount > 1
      ? ` ${matchedCount - 1} other ${
          matchedCount === 2 ? "policy" : "policies"
        } also applied.`
      : "";

  switch (policy.effect) {
    case "deny":
      return `${subject} is not permitted by ${policy.name}.${also}`;
    case "require_approval":
      return `${subject} needs a person to approve it under ${policy.name}.${also}`;
    default:
      return `${subject} is permitted by ${policy.name}.${also}`;
  }
}
