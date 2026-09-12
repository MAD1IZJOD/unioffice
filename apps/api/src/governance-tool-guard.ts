import type {
  AgentId,
  OrganizationId,
  TaskId,
  WorkId,
  WorkspaceId,
} from "@unioffice/core";

import type {
  ToolExecutionContext,
  ToolGuard,
  ToolGuardDecision,
} from "@unioffice/tools";

import type { GovernanceService } from "./governance-service.js";

/**
 * Governance, at the moment a tool is about to run.
 *
 * The tools package cannot answer this for itself - policies live in the
 * database and that package has no database - so this is the seam between the
 * two. It is deliberately thin: it translates a tool context into a
 * governance question, asks the service, records what was decided, and
 * translates the answer back.
 *
 * It never widens anything. By the time this runs the registry has confirmed
 * the tool exists and the agent's own grants have confirmed it may hold it;
 * all this can do is take that away.
 */
export class GovernanceToolGuard implements ToolGuard {
  constructor(private readonly governance: GovernanceService) {}

  async check(
    toolId: string,
    context: ToolExecutionContext,
  ): Promise<ToolGuardDecision> {
    const decision = await this.governance.evaluateToolCall({
      organizationId: context.organizationId as OrganizationId,
      toolId,
      agentId: context.agentId as AgentId | undefined,
      agentCapabilities: stringsOf(context.metadata.agentCapabilities),
      agentToolIds: context.authorizedToolIds,
      workspaceId: textOf(context.metadata.workspaceId) as
        | WorkspaceId
        | undefined,
      workId: context.workId as WorkId | undefined,
      taskId: context.taskId as TaskId | undefined,
    });

    // A tool rule can only allow or deny - the service refuses to save one
    // that requires approval, because there is nothing to suspend once an
    // agent is mid-reasoning. Anything short of an allow stops the call, and
    // the reason says which it was rather than pretending it was a plain
    // refusal.
    const allowed = decision.outcome === "allow";

    await this.governance.recordDecision(decision, {
      organizationId: context.organizationId as OrganizationId,
      workId: context.workId as WorkId | undefined,
      taskId: context.taskId as TaskId | undefined,
      agentId: context.agentId as AgentId | undefined,
      action: `Use ${toolId}`,
    });

    return {
      outcome: allowed ? "allow" : "deny",
      reason: decision.summary,
      policyId: decision.decidingPolicyId,
      policyName: decision.decidingPolicyName,
      risk: decision.risk,
    };
  }
}

function stringsOf(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function textOf(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}
