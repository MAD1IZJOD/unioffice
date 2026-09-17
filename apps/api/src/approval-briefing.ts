import type {
  Agent,
  AgentId,
  ApprovalRequest,
  RiskLevel,
  Task,
  TaskId,
  Work,
  WorkId,
  Workspace,
  WorkspaceId,
} from "@unioffice/core";

import type { ToolRegistry } from "@unioffice/tools";

import { canDecideApproval, type Access } from "./access/permissions.js";
import { clip } from "./mission-reading.js";
import { isGovernedByPolicy } from "./work-approval-service.js";

/**
 * Everything a person needs to decide an approval, in one read.
 *
 * What is being approved, why it stopped, who is waiting, which rule asked,
 * what happens either way, and whether this person may decide it at all.
 * The last is the server's answer, computed with the same rule that refuses
 * a decision, so the page never needs to re-derive authorization itself.
 *
 * Only names and short text leave here - never tool input, task output or an
 * agent's instructions.
 */
export interface ApprovalBriefing {
  mission: { id: WorkId; objective: string; workspace: string | null } | null;
  step: { title: string; description: string } | null;
  agent: { id: AgentId; name: string } | null;
  /** Why a person is needed, most specific first. */
  requestedBy: "external_write" | "skill" | "policy" | "planner";
  policy: { id: string; name: string } | null;
  skill: string | null;
  /** External systems the step will change, by tool name. */
  externalWrites: string[];
  /** Every tool the step needs. */
  tools: string[];
  risk: RiskLevel | null;
  onApprove: string;
  onReject: string;
  /** Who may decide it, and whether the person asking may. */
  decidedBy: "owners_and_admins" | "members";
  youCanDecide: boolean;
}

export interface ApprovalBriefingDependencies {
  tasks: { findById(id: TaskId): Promise<Task | null> };
  works: { findById(id: WorkId): Promise<Work | null> };
  agents: { findById(id: AgentId): Promise<Agent | null> };
  workspaces: { findById(id: WorkspaceId): Promise<Workspace | null> };
  tools: Pick<ToolRegistry, "get">;
}

export async function briefApprovals(
  dependencies: ApprovalBriefingDependencies,
  access: Access,
  approvals: ApprovalRequest[],
): Promise<Array<ApprovalRequest & { briefing: ApprovalBriefing }>> {
  // Pending approvals are few, and each read is cached for the call, so a
  // mission with several stopped steps costs one read of it, not several.
  const memo = <K, V>(load: (key: K) => Promise<V>) => {
    const cache = new Map<K, Promise<V>>();
    return (key: K) => {
      if (!cache.has(key)) cache.set(key, load(key).catch(() => null as V));
      return cache.get(key)!;
    };
  };

  const task = memo((id: TaskId) => dependencies.tasks.findById(id));
  const work = memo((id: WorkId) => dependencies.works.findById(id));
  const agent = memo((id: AgentId) => dependencies.agents.findById(id));
  const workspace = memo((id: WorkspaceId) => dependencies.workspaces.findById(id));

  return Promise.all(approvals.map(async (approval) => {
    const [step, mission, assignee] = await Promise.all([
      approval.taskId ? task(approval.taskId) : Promise.resolve(null),
      work(approval.workId),
      approval.agentId ? agent(approval.agentId) : Promise.resolve(null),
    ]);

    // Nothing from another organization is ever described, even if an id
    // somehow pointed at it.
    const ownMission = mission && mission.organizationId === access.organizationId ? mission : null;
    const ownAgent = assignee && assignee.organizationId === access.organizationId ? assignee : null;
    const ownStep = step && ownMission && step.workId === ownMission.id ? step : null;
    const place = ownMission?.workspaceId ? await workspace(ownMission.workspaceId) : null;

    const metadata = approval.metadata ?? {};
    const governance = (ownStep?.metadata.governance ?? {}) as { risk?: unknown; policyName?: unknown };
    const routing = (ownStep?.metadata.routing ?? {}) as { requiredTools?: unknown };

    const externalWrites = stringsOf(metadata.externalWrites);
    const skill = typeof metadata.skill === "string" ? metadata.skill : null;
    const policyId = typeof metadata.policyId === "string" ? metadata.policyId : null;
    const policyName = typeof metadata.policyName === "string"
      ? metadata.policyName
      : typeof governance.policyName === "string" ? governance.policyName : null;

    const toolName = (toolId: string) => toolNameOf(dependencies.tools, toolId);

    const requestedBy: ApprovalBriefing["requestedBy"] = externalWrites.length > 0
      ? "external_write"
      : skill ? "skill" : policyId ? "policy" : "planner";

    const governed = isGovernedByPolicy(approval, ownStep);
    const workspaceId = ownMission?.workspaceId;

    return {
      ...approval,
      briefing: {
        mission: ownMission
          ? { id: ownMission.id, objective: clip(ownMission.objective, 240), workspace: place?.name ?? null }
          : null,
        step: ownStep ? { title: clip(ownStep.title, 160), description: clip(ownStep.description, 400) } : null,
        agent: ownAgent ? { id: ownAgent.id, name: ownAgent.name } : null,
        requestedBy,
        policy: policyId ? { id: policyId, name: policyName ?? "A policy" } : null,
        skill,
        externalWrites: externalWrites.map(toolName),
        tools: stringsOf(routing.requiredTools).map(toolName),
        risk: isRisk(metadata.risk) ? metadata.risk : isRisk(governance.risk) ? governance.risk : null,
        onApprove: externalWrites.length > 0
          ? `${ownAgent?.name ?? "The agent"} runs this step and may use ${externalWrites.map(toolName).join(", ")} once, changing something outside the company. Steps that depend on it continue.`
          : `${ownAgent?.name ?? "The agent"} runs this step, and the steps that depend on it continue.`,
        onReject: "The step does not run and the mission stops here. The decision is recorded; nothing is deleted, and the mission can be retried later.",
        decidedBy: governed ? "owners_and_admins" : "members",
        youCanDecide: canDecideApproval(access, { workspaceId, governedByPolicy: governed }),
      },
    };
  }));
}

function toolNameOf(tools: Pick<ToolRegistry, "get">, toolId: string): string {
  return tools.get(toolId)?.name ?? toolId;
}

function stringsOf(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function isRisk(value: unknown): value is RiskLevel {
  return value === "low" || value === "medium" || value === "high" || value === "critical";
}
