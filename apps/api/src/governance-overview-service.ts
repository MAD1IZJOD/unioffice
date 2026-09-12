import type {
  Agent,
  AgentId,
  ApprovalRequest,
  Event,
  OrganizationId,
  Policy,
  PolicyId,
  RiskLevel,
} from "@unioffice/core";

import type {
  AgentRepository,
  ApprovalRepository,
  EventRepository,
  PolicyRepository,
  WorkspaceRepository,
} from "@unioffice/database";

import { effectivePermissions } from "@unioffice/governance";

import type { ToolRegistry } from "@unioffice/tools";

/**
 * What the Governance Center reads.
 *
 * Every number here is counted from a row that exists. There is deliberately
 * no compliance score, no coverage percentage and no health rating: those are
 * the kind of figure that looks authoritative and means nothing, and a
 * control surface that invents reassurance is worse than one that says a
 * company has written no rules yet.
 */

/** One agent, as governance sees it. */
export interface GovernedAgent {
  agentId: AgentId;
  name: string;
  type: Agent["type"];
  status: Agent["status"];
  capabilities: string[];

  /** Every registered tool and what this agent may actually do with it. */
  tools: Array<{
    toolId: string;
    name: string;
    access: "allowed" | "requires_approval" | "denied" | "not_granted";
    risk: RiskLevel;
    policyNames: string[];
    explanation: string;
  }>;

  /** Policies whose scope reaches this agent. */
  policyIds: PolicyId[];

  /** Governance decisions about this agent in the recent log. */
  deniedCount: number;
  approvalRequiredCount: number;
}

/** One tool, as governance sees it. */
export interface GovernedTool {
  toolId: string;
  name: string;
  description: string;
  risk: RiskLevel;
  /** Agents holding a grant for it, before policy narrows anything. */
  grantedAgentCount: number;
  /** Agents that could actually call it once policy is applied. */
  permittedAgentCount: number;
  policyIds: PolicyId[];
  policyNames: string[];
  callCount: number;
  blockedCount: number;
}

/** One governance decision, read back as a sentence. */
export interface GovernanceDecisionRecord {
  eventId: string;
  at: Date;
  outcome: "allowed" | "approval_required" | "denied";
  action: string;
  risk: RiskLevel;
  summary: string;
  policyId?: string;
  policyName?: string;
  agentId?: AgentId;
  agentName?: string;
  workId?: string;
  taskId?: string;
  /** Every policy that took part, for the expanded view. */
  reasons: Array<{
    policyId?: string;
    policyName: string;
    effect: string;
    risk: string;
    explanation: string;
  }>;
}

export interface GovernanceOverview {
  organizationId: OrganizationId;
  generatedAt: Date;

  policies: Policy[];

  counts: {
    active: number;
    draft: number;
    paused: number;
    /** Rules that can stop something outright. */
    denying: number;
    /** Rules that put a person in front of something. */
    gating: number;
    agentsGoverned: number;
    toolsGoverned: number;
    pendingApprovals: number;
    deniedRecently: number;
  };

  agents: GovernedAgent[];
  tools: GovernedTool[];

  /** The most recent governance decisions, newest first. */
  decisions: GovernanceDecisionRecord[];

  /** Policy lifecycle events, newest first. */
  changes: Event[];

  pendingApprovals: ApprovalRequest[];
}

const DECISION_TYPES = new Set([
  "governance.allowed",
  "governance.approval_required",
  "governance.denied",
]);

const POLICY_CHANGE_TYPES = new Set([
  "policy.created",
  "policy.updated",
  "policy.activated",
  "policy.paused",
  "policy.archived",
]);

export class GovernanceOverviewService {
  constructor(
    private readonly policyRepository: PolicyRepository,
    private readonly agentRepository: AgentRepository,
    private readonly approvalRepository: ApprovalRepository,
    private readonly eventRepository: EventRepository,
    private readonly workspaceRepository: WorkspaceRepository,
    private readonly toolRegistry: ToolRegistry,
  ) {}

  async getOverview(
    organizationId: OrganizationId,
    options: { activityLimit?: number } = {},
  ): Promise<GovernanceOverview> {
    const [policies, agents, pendingApprovals, activity] = await Promise.all([
      this.policyRepository.findByOrganization(organizationId),
      this.agentRepository.findByOrganization(organizationId),
      this.approvalRepository.findPendingByOrganization(organizationId),
      // One read of the log, filtered here into decisions and policy changes.
      // Two organization-wide reads to separate them would cost twice as much
      // and could disagree about the window they cover.
      this.eventRepository.findByOrganization(
        organizationId,
        options.activityLimit ?? 200,
      ),
      // Workspaces are read only to confirm a policy's scope is real; the
      // overview does not render them, so nothing waits on this.
      this.workspaceRepository.findByOrganization(organizationId),
    ]);

    const enforced = policies.filter((policy) => policy.status === "active");
    const tools = this.toolRegistry.list();
    const agentsById = new Map(agents.map((agent) => [agent.id, agent]));

    const decisions = activity
      .filter((event) => DECISION_TYPES.has(event.type))
      .map((event) => this.readDecision(event, agentsById));

    const governedAgents = agents.map((agent) =>
      this.governedAgent(agent, enforced, tools, decisions),
    );

    return {
      organizationId,
      generatedAt: new Date(),
      policies,
      counts: {
        active: enforced.length,
        draft: policies.filter((policy) => policy.status === "draft").length,
        paused: policies.filter((policy) => policy.status === "paused").length,
        denying: enforced.filter((policy) => policy.effect === "deny").length,
        gating: enforced.filter(
          (policy) => policy.effect === "require_approval",
        ).length,
        agentsGoverned: governedAgents.filter(
          (agent) => agent.policyIds.length > 0,
        ).length,
        toolsGoverned: new Set(
          enforced.flatMap((policy) => policy.scope.toolIds),
        ).size,
        pendingApprovals: pendingApprovals.length,
        deniedRecently: decisions.filter(
          (decision) => decision.outcome === "denied",
        ).length,
      },
      agents: governedAgents,
      tools: tools.map((tool) =>
        this.governedTool(tool, agents, enforced, governedAgents, activity),
      ),
      decisions,
      changes: activity.filter((event) => POLICY_CHANGE_TYPES.has(event.type)),
      pendingApprovals,
    };
  }

  private governedAgent(
    agent: Agent,
    enforced: Policy[],
    tools: ReturnType<ToolRegistry["list"]>,
    decisions: GovernanceDecisionRecord[],
  ): GovernedAgent {
    const permissions = effectivePermissions({
      grantedToolIds: agent.toolIds,
      capabilities: agent.capabilities,
      agentId: agent.id,
      tools: tools.map((tool) => ({ id: tool.id, risk: tool.risk ?? "low" })),
      policies: enforced,
    });

    const reaching = enforced.filter((policy) =>
      reachesAgent(policy, agent),
    );

    const mine = decisions.filter(
      (decision) => decision.agentId === agent.id,
    );

    return {
      agentId: agent.id,
      name: agent.name,
      type: agent.type,
      status: agent.status,
      capabilities: agent.capabilities,
      tools: permissions.map((permission) => ({
        toolId: permission.toolId,
        name:
          tools.find((tool) => tool.id === permission.toolId)?.name ??
          permission.toolId,
        access: permission.access,
        risk: permission.risk,
        policyNames: permission.policyNames,
        explanation: permission.explanation,
      })),
      policyIds: reaching.map((policy) => policy.id),
      deniedCount: mine.filter((decision) => decision.outcome === "denied")
        .length,
      approvalRequiredCount: mine.filter(
        (decision) => decision.outcome === "approval_required",
      ).length,
    };
  }

  private governedTool(
    tool: ReturnType<ToolRegistry["list"]>[number],
    agents: Agent[],
    enforced: Policy[],
    governedAgents: GovernedAgent[],
    activity: Event[],
  ): GovernedTool {
    const reaching = enforced.filter(
      (policy) =>
        policy.scope.toolIds.length === 0 ||
        policy.scope.toolIds.includes(tool.id),
    );

    return {
      toolId: tool.id,
      name: tool.name,
      description: tool.description,
      risk: tool.risk ?? "low",
      grantedAgentCount: agents.filter((agent) =>
        agent.toolIds.includes(tool.id),
      ).length,
      permittedAgentCount: governedAgents.filter((agent) =>
        agent.tools.some(
          (entry) => entry.toolId === tool.id && entry.access === "allowed",
        ),
      ).length,
      policyIds: reaching.map((policy) => policy.id),
      policyNames: reaching.map((policy) => policy.name),
      callCount: activity.filter(
        (event) =>
          event.type === "tool.completed" && event.payload.toolId === tool.id,
      ).length,
      // A call the executor refused for policy reasons, as opposed to one
      // that simply failed. Read off the same log everything else uses.
      blockedCount: activity.filter(
        (event) =>
          event.type === "governance.denied" &&
          event.payload.action === `Use ${tool.id}`,
      ).length,
    };
  }

  private readDecision(
    event: Event,
    agentsById: Map<AgentId, Agent>,
  ): GovernanceDecisionRecord {
    const payload = event.payload ?? {};

    return {
      eventId: event.id,
      at: event.timestamp,
      outcome:
        event.type === "governance.denied"
          ? "denied"
          : event.type === "governance.approval_required"
            ? "approval_required"
            : "allowed",
      action: textOf(payload.action) ?? "An action",
      risk: (textOf(payload.risk) as RiskLevel) ?? "low",
      summary: textOf(payload.summary) ?? "",
      policyId: textOf(payload.policyId),
      policyName: textOf(payload.policyName),
      agentId: event.agentId,
      agentName: event.agentId
        ? agentsById.get(event.agentId)?.name
        : undefined,
      workId: event.workId,
      taskId: event.taskId,
      reasons: Array.isArray(payload.reasons)
        ? (payload.reasons as Array<Record<string, unknown>>).map((reason) => ({
            policyId: textOf(reason.policyId),
            policyName: textOf(reason.policyName) ?? "A policy",
            effect: textOf(reason.effect) ?? "",
            risk: textOf(reason.risk) ?? "",
            explanation: textOf(reason.explanation) ?? "",
          }))
        : [],
    };
  }
}

/** Whether a policy's scope can reach this agent at all. */
function reachesAgent(policy: Policy, agent: Agent): boolean {
  if (
    policy.scope.agentIds.length > 0 &&
    !policy.scope.agentIds.includes(agent.id)
  ) {
    return false;
  }

  if (
    policy.scope.capabilities.length > 0 &&
    !policy.scope.capabilities.some((capability) =>
      agent.capabilities.includes(capability),
    )
  ) {
    return false;
  }

  // A tool-scoped rule only reaches an agent that actually holds one of the
  // tools it covers. Listing it against an agent that could never trigger it
  // would inflate "governed by" into a number nobody can act on.
  if (
    policy.scope.toolIds.length > 0 &&
    !policy.scope.toolIds.some((toolId) => agent.toolIds.includes(toolId))
  ) {
    return false;
  }

  return true;
}

function textOf(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}
