import type {
  Agent,
  Artifact,
  Task,
} from "@unioffice/core";

import { loadApiConfig } from "./config.js";
import { createExecutionRuntime } from "./runtime.js";

type Classification =
  | "VERIFIED FUNCTIONAL"
  | "PARTIALLY VERIFIED"
  | "NONFUNCTIONAL"
  | "UNVERIFIED";

interface AgentAudit {
  id: string;
  name: string;
  department: string;
  responsibility: string;
  capabilities: string[];
  tools: string[];
  skills: string[];
  eligibleNow: boolean;
  classification: Classification;
  liveExecution?: LiveExecutionEvidence;
  evidence: string[];
  recommendedNextFix?: string;
}

interface LiveExecutionEvidence {
  taskId: string;
  workId: string;
  completedAt: string;
  artifactIds: string[];
  artifactCreatedAt: string[];
}

const organizationSlug =
  process.env.UNIOFFICE_AUDIT_ORGANIZATION_SLUG ??
  "unioffice-development";

const runtime = createExecutionRuntime(loadApiConfig());
const organization = await runtime.organizationRepository.findBySlug(organizationSlug);

if (!organization) {
  throw new Error(`Organization not found for audit: ${organizationSlug}`);
}

const [agents, workspaces, effectiveSkills] = await Promise.all([
  runtime.agentRepository.findByOrganization(organization.id),
  runtime.workspaceRepository.findByOrganization(organization.id),
  runtime.skillService.effective(organization.id),
]);

const tools = new Set(runtime.toolRegistry.list().map((tool) => tool.id));
const workspaceNames = new Map(workspaces.map((workspace) => [workspace.id, workspace.name]));

const audit = await Promise.all(
  agents.map((agent) => auditAgent(agent)),
);

const counts = audit.reduce<Record<Classification, number>>(
  (current, entry) => ({
    ...current,
    [entry.classification]: current[entry.classification] + 1,
  }),
  {
    "VERIFIED FUNCTIONAL": 0,
    "PARTIALLY VERIFIED": 0,
    "NONFUNCTIONAL": 0,
    "UNVERIFIED": 0,
  },
);

console.log(JSON.stringify({
  generatedAt: new Date().toISOString(),
  organization: {
    id: organization.id,
    slug: organization.slug,
    name: organization.name,
  },
  workforceSize: audit.length,
  classifications: counts,
  agents: audit,
}, null, 2));

async function auditAgent(agent: Agent): Promise<AgentAudit> {
  const missingTools = agent.toolIds.filter((toolId) => !tools.has(toolId));
  const missingSkills = (agent.skills ?? []).filter((slug) => !effectiveSkills.has(slug));
  const workspaceName = agent.workspaceId
    ? workspaceNames.get(agent.workspaceId)
    : "Company-wide";
  const workspaceMissing = agent.workspaceId !== undefined && workspaceName === undefined;
  const tasks = await runtime.taskRepository.findByAgent(agent.id, 50);
  const artifacts = await artifactsForCompletedTasks(tasks);
  const verified = tasks.map((task) => ({
    task,
    artifacts: artifactsForTask(task, agent, artifacts),
  })).find(({ task, artifacts: taskArtifacts }) =>
    task.status === "completed" &&
    hasCompletedExecution(task) &&
    taskUsesAgentCapability(task, agent) &&
    taskArtifacts.some(artifactHasContent),
  );
  const verifiedTask = verified?.task;
  const completedTask = tasks.find((task) =>
    task.status === "completed" &&
    hasCompletedExecution(task) &&
    artifactsForTask(task, agent, artifacts).some(artifactHasContent),
  );

  const evidence = [
    `Status: ${agent.status}.`,
    `Workspace: ${workspaceName ?? "missing"}.`,
    `Registered capabilities: ${agent.capabilities.length}.`,
    `Authorized tools: ${agent.toolIds.length}.`,
    `Assigned skills: ${(agent.skills ?? []).length}.`,
  ];

  if (verifiedTask) {
    const routing = routingEvidence(verifiedTask);

    evidence.push(
      `Live verification: completed task “${verifiedTask.title}” (${routing}) has a persisted non-empty artifact.`,
    );
  }

  if (!verifiedTask && completedTask) {
    evidence.push(
      `A completed task has a persisted artifact, but its recorded routing does not prove this agent held a required capability.`,
    );
  }

  if (missingTools.length > 0) {
    evidence.push(`Missing registered tools: ${missingTools.join(", ")}.`);
  }

  if (missingSkills.length > 0) {
    evidence.push(`Missing effective skills: ${missingSkills.join(", ")}.`);
  }

  if (workspaceMissing) {
    evidence.push("Its configured workspace no longer exists in this organization.");
  }

  const configurationBroken = missingTools.length > 0 || missingSkills.length > 0 || workspaceMissing;
  const classification: Classification = configurationBroken
    ? "NONFUNCTIONAL"
    : verifiedTask
      ? "VERIFIED FUNCTIONAL"
      : agent.status === "active"
        ? "PARTIALLY VERIFIED"
        : "UNVERIFIED";

  return {
    id: agent.id,
    name: agent.name,
    department: workspaceName ?? "Unknown workspace",
    responsibility: agent.role ?? agent.description,
    capabilities: agent.capabilities,
    tools: agent.toolIds,
    skills: agent.skills ?? [],
    eligibleNow: agent.status === "active" && !configurationBroken,
    classification,
    ...(verified?.task.completedAt
      ? {
          liveExecution: {
            taskId: verified.task.id,
            workId: verified.task.workId,
            completedAt: verified.task.completedAt.toISOString(),
            artifactIds: verified.artifacts.map((artifact) => artifact.id),
            artifactCreatedAt: verified.artifacts.map((artifact) => artifact.createdAt.toISOString()),
          },
        }
      : {}),
    evidence,
    ...(classification === "PARTIALLY VERIFIED"
      ? { recommendedNextFix: "Run a bounded representative live task for this agent." }
      : classification === "NONFUNCTIONAL"
        ? { recommendedNextFix: "Repair the missing registry reference before assigning work." }
        : classification === "UNVERIFIED"
          ? { recommendedNextFix: "Confirm whether this inactive agent should be re-enabled, then run a representative task." }
          : {}),
  };
}

async function artifactsForCompletedTasks(tasks: Task[]): Promise<Artifact[]> {
  const completed = tasks.filter((task) => task.status === "completed");
  const byTask = await Promise.all(
    completed.map((task) => runtime.artifactRepository.findByTask(task.id)),
  );

  return byTask.flat();
}

function artifactsForTask(task: Task, agent: Agent, artifacts: Artifact[]): Artifact[] {
  return artifacts.filter((artifact) =>
    artifact.taskId === task.id && artifact.createdByAgentId === agent.id,
  );
}

function hasCompletedExecution(task: Task): boolean {
  const execution = task.metadata.execution;

  return typeof execution === "object" &&
    execution !== null &&
    (execution as { status?: unknown }).status === "completed";
}

function artifactHasContent(artifact: Artifact): boolean {
  const content = artifact.metadata.content;

  return typeof content === "string"
    ? content.trim().length > 0
    : content !== undefined && content !== null;
}

function routingEvidence(task: Task): string {
  const routing = task.metadata.routing;

  if (typeof routing !== "object" || routing === null) {
    return "no recorded routing requirements";
  }

  const values = routing as {
    requiredCapabilities?: unknown;
    requiredTools?: unknown;
  };
  const capabilities = strings(values.requiredCapabilities);
  const requiredTools = strings(values.requiredTools);
  const details = [
    capabilities.length > 0 ? `capabilities: ${capabilities.join(", ")}` : undefined,
    requiredTools.length > 0 ? `tools: ${requiredTools.join(", ")}` : undefined,
  ].filter((detail): detail is string => detail !== undefined);

  return details.length > 0 ? details.join("; ") : "no recorded routing requirements";
}

function taskUsesAgentCapability(task: Task, agent: Agent): boolean {
  const routing = task.metadata.routing;

  if (typeof routing !== "object" || routing === null) {
    return false;
  }

  const requiredCapabilities = strings(
    (routing as { requiredCapabilities?: unknown }).requiredCapabilities,
  );

  return requiredCapabilities.length > 0 && requiredCapabilities.every((capability) =>
    agent.capabilities.some(
      (held) => held.toLocaleLowerCase() === capability.toLocaleLowerCase(),
    ),
  );
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}
