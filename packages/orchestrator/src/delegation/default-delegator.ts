import type {
  Agent,
  AgentType,
} from "@unioffice/core";

import type {
  AgentRepository,
} from "@unioffice/database";

import type {
  DelegatedTask,
  DelegationContext,
  Delegator,
} from "./delegator.js";

/**
 * Routes a task to an active agent using a deterministic, explainable rank.
 * Workspace affinity takes precedence over capability count, role suitability,
 * and reported load. Agent IDs provide a stable final tie-breaker.
 */
export class DefaultDelegator implements Delegator {
  constructor(
    private readonly agentRepository: AgentRepository,
  ) {}

  async delegate(
    context: DelegationContext,
  ): Promise<DelegatedTask> {
    const agents = await this.agentRepository.findByOrganization(
      context.organizationId,
    );
    const availableAgentIds = new Set(context.availableAgentIds);
    const requiredCapabilities = normalizeCapabilities(
      context.task.requiredCapabilities,
    );
    const requiredTools = normalizeTools(
      context.task.requiredTools,
    );
    const eligibleAgents = agents.filter(
      (agent) =>
        availableAgentIds.has(agent.id) &&
        agent.status === "active" &&
        isWorkspaceCompatible(agent, context.workspaceId) &&
        hasCapabilities(agent, requiredCapabilities) &&
        hasTools(agent, requiredTools),
    );

    if (context.task.assignedAgentId) {
      const assignedAgent = eligibleAgents.find(
        (agent) => agent.id === context.task.assignedAgentId,
      );

      if (!assignedAgent) {
        throw new Error(
          `Assigned agent is unavailable: ${context.task.assignedAgentId}`,
        );
      }

      return {
        taskId: context.task.id,
        agentId: assignedAgent.id,
        metadata: {
          delegation: "explicit",
          selectionReason:
            "The planner explicitly assigned this active, compatible agent.",
          requiredCapabilities,
          requiredTools,
          score: this.score(assignedAgent, context, requiredCapabilities, requiredTools),
        },
      };
    }

    const rankedAgents = eligibleAgents
      .map((agent) => ({
        agent,
        score: this.score(agent, context, requiredCapabilities, requiredTools),
      }))
      .sort(compareCandidates);
    const candidate = rankedAgents[0];

    if (!candidate) {
      throw new Error(
        requiredTools.length > 0
          ? `No eligible agent is authorized for the required tool(s): ${requiredTools.join(", ")} (task: ${context.task.id})`
          : `No eligible agents available for task: ${context.task.id}`,
      );
    }

    return {
      taskId: context.task.id,
      agentId: candidate.agent.id,
      metadata: {
        delegation: "capability_ranked",
        selectionReason: this.selectionReason(
          candidate.score,
          requiredCapabilities,
          requiredTools,
        ),
        requiredCapabilities,
        requiredTools,
        score: candidate.score,
        consideredAgentCount: rankedAgents.length,
      },
    };
  }

  private score(
    agent: Agent,
    context: DelegationContext,
    requiredCapabilities: string[],
    requiredTools: string[],
  ): DelegationScore {
    const matchedCapabilities = requiredCapabilities.filter((capability) =>
      agent.capabilities.some(
        (agentCapability) =>
          agentCapability.toLocaleLowerCase() === capability,
      ),
    );

    return {
      workspace: workspaceRank(agent, context.workspaceId),
      capabilities: matchedCapabilities.length,
      agentType: agentTypeRank(
        agent.type,
        context.task.suggestedAgentType,
      ),
      availability: availabilityRank(agent),
      matchedCapabilities,
      workspaceCompatibility: workspaceCompatibility(
        agent,
        context.workspaceId,
      ),
      agentTypeSuitability: agent.type === context.task.suggestedAgentType
        ? "preferred"
        : "compatible",
    };
  }

  private selectionReason(
    score: DelegationScore,
    requiredCapabilities: string[],
    requiredTools: string[],
  ): string {
    const capabilityDetail = requiredCapabilities.length
      ? ` It satisfies: ${score.matchedCapabilities.join(", ")}.`
      : " No mandatory capability was specified.";
    const toolDetail = requiredTools.length
      ? ` It is authorized for the required tool(s): ${requiredTools.join(", ")}.`
      : "";

    return [
      `Selected by deterministic rank: ${score.workspaceCompatibility} workspace compatibility,`,
      `${score.capabilities} required capability matches, ${score.agentTypeSuitability} agent type,`,
      `and availability score ${score.availability}.`,
      capabilityDetail,
      toolDetail,
    ].join(" ");
  }
}

interface DelegationScore {
  workspace: number;
  capabilities: number;
  agentType: number;
  availability: number;
  matchedCapabilities: string[];
  workspaceCompatibility: "exact" | "organization-wide" | "not-scoped";
  agentTypeSuitability: "preferred" | "compatible";
}

function compareCandidates(
  left: { agent: Agent; score: DelegationScore },
  right: { agent: Agent; score: DelegationScore },
): number {
  const rankDifference =
    right.score.workspace - left.score.workspace ||
    right.score.capabilities - left.score.capabilities ||
    right.score.agentType - left.score.agentType ||
    right.score.availability - left.score.availability;

  return rankDifference !== 0
    ? rankDifference
    : left.agent.id.localeCompare(right.agent.id);
}

function normalizeCapabilities(
  capabilities: string[] | undefined,
): string[] {
  return [...new Set(
    (capabilities ?? [])
      .map((capability) => capability.trim().toLocaleLowerCase())
      .filter(Boolean),
  )];
}

function hasCapabilities(agent: Agent, requiredCapabilities: string[]): boolean {
  const agentCapabilities = new Set(
    agent.capabilities.map((capability) => capability.toLocaleLowerCase()),
  );

  return requiredCapabilities.every((capability) =>
    agentCapabilities.has(capability),
  );
}

function normalizeTools(
  tools: string[] | undefined,
): string[] {
  return [...new Set(
    (tools ?? [])
      .map((tool) => tool.trim())
      .filter(Boolean),
  )];
}

/**
 * Unlike capabilities (freeform strings the planner asserts an agent has),
 * tool authorization is a hard boundary enforced by ToolExecutor. A task
 * that requires a tool can only go to an agent actually granted it - this
 * is what keeps a deterministic-computation task from silently landing on
 * an agent that will just have the model guess instead of using the tool.
 */
function hasTools(agent: Agent, requiredTools: string[]): boolean {
  const agentToolIds = new Set(agent.toolIds);

  return requiredTools.every((tool) => agentToolIds.has(tool));
}

function isWorkspaceCompatible(
  agent: Agent,
  workspaceId: DelegationContext["workspaceId"],
): boolean {
  return !workspaceId || !agent.workspaceId || agent.workspaceId === workspaceId;
}

function workspaceRank(
  agent: Agent,
  workspaceId: DelegationContext["workspaceId"],
): number {
  if (!workspaceId) return 1;
  return agent.workspaceId === workspaceId ? 2 : 1;
}

function workspaceCompatibility(
  agent: Agent,
  workspaceId: DelegationContext["workspaceId"],
): DelegationScore["workspaceCompatibility"] {
  if (!workspaceId) return "not-scoped";
  return agent.workspaceId === workspaceId ? "exact" : "organization-wide";
}

function agentTypeRank(
  agentType: AgentType,
  suggestedAgentType: AgentType | undefined,
): number {
  return suggestedAgentType === agentType ? 1 : 0;
}

function availabilityRank(agent: Agent): number {
  const currentLoad = agent.metadata.currentLoad;
  if (typeof currentLoad !== "number" || !Number.isFinite(currentLoad)) {
    return 100;
  }
  return Math.max(0, 100 - currentLoad);
}
