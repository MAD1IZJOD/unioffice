import type {
  Agent,
  AgentId,
  Connection,
  ConnectionProvider,
  EventType,
  Skill,
  OrganizationId,
  PolicyEffect,
  RiskLevel,
  TaskStatus,
  WorkId,
  WorkspaceId,
} from "@unioffice/core";

import type {
  AgentRepository,
  ConnectionRepository,
  OperationalReadRepository,
  PolicyRepository,
  TaskSummary,
  WorkSummary,
  WorkspaceRepository,
} from "@unioffice/database";

import { effectivePermissions } from "@unioffice/governance";

import type { ToolRegistry } from "@unioffice/tools";

import { AgentNotFoundError } from "./agent-directory-service.js";
import { PROVIDER_INFO } from "./connections/connection-providers.js";
import { skillFit } from "@unioffice/skills";
import { reachesAgent } from "./governance-overview-service.js";
import { clip, describeEvent, isTerminal } from "./mission-reading.js";

/**
 * The workforce: who works for the organization, what each of them is doing,
 * what they may use, and what they have done.
 *
 * Everything here is read from the rows execution itself writes - the agent,
 * its task rows, the missions they belong to, the events and artifacts it
 * left - through the lean operational reads, so nothing a person is shown was
 * computed from a second copy of mission state. What leaves this service is
 * what a person may be shown: names, titles, labels and counts. An agent's
 * model instructions, task outputs, tool inputs and raw failure text stay on
 * the server.
 *
 * Someone who reaches only some workspaces sees the agents that work where
 * they can see, and the missions they can open. An agent busy on a mission
 * they cannot open is still shown as working, without saying on what.
 */

/** Only the states the backend actually records. */
export type WorkforcePresence = "working" | "waiting" | "available" | "paused" | "unavailable";

export type Reach = (workspaceId: WorkspaceId | undefined) => boolean;

export interface WorkforceTool {
  id: string;
  name: string;
  description: string;
  /** False when the agent holds a grant for a tool this build no longer registers. */
  registered: boolean;
}

export interface WorkforceCurrentWork {
  missionId: WorkId;
  missionName: string;
  taskTitle: string;
  /** Working: the step is running. Waiting: the step is held for a person's decision. */
  state: "working" | "waiting";
  since?: Date;
}

export interface WorkforceOutcome {
  missionId: WorkId;
  missionName: string;
  taskTitle: string;
  outcome: "completed" | "failed";
  at: Date;
}

export interface WorkforceMember {
  id: AgentId;
  name: string;
  description: string;
  type: Agent["type"];
  /** The agent's own configured status. */
  status: Agent["status"];
  presence: WorkforcePresence;
  capabilities: string[];
  tools: WorkforceTool[];
  workspace?: { id: WorkspaceId; name: string; slug: string };
  current?: WorkforceCurrentWork;
  /** Busy on a mission the caller cannot open. */
  workingElsewhere: boolean;
  /** Steps assigned in open missions that have not started. */
  upcomingSteps: number;
  lastOutcome?: WorkforceOutcome;
  recent: { completed: number; failed: number };
}

export interface Workforce {
  organizationId: OrganizationId;
  generatedAt: Date;
  /** How many of the most recently active missions the counts are read over. */
  missionWindow: number;
  summary: Record<WorkforcePresence, number> & { total: number };
  members: WorkforceMember[];
}

export interface AgentProfile {
  member: WorkforceMember;
  /** The newest steps this agent was given, in missions the caller can open. */
  history: Array<{
    taskId: string;
    taskTitle: string;
    status: TaskStatus;
    missionId: WorkId;
    missionName: string;
    at: Date;
  }>;
  artifacts: Array<{ id: string; name: string; type: string; missionId?: WorkId; createdAt: Date }>;
  activity: Array<{ id: string; type: EventType; at: Date; summary: string; missionId?: WorkId }>;
  /**
   * What governance lets this agent do with each tool it holds. A grant is
   * not a permission: an enforced policy can still put a person in front of a
   * call, or refuse it.
   */
  governance: {
    tools: Array<{
      toolId: string;
      name: string;
      access: "allowed" | "requires_approval" | "denied";
      risk: RiskLevel;
      policyNames: string[];
      explanation: string;
    }>;
    policies: Array<{ id: string; name: string; effect: PolicyEffect; risk: RiskLevel }>;
  };
  /**
   * External systems this agent holds tools for, and whether it can actually
   * use each one now. Only systems the agent was granted a tool for appear -
   * a connection alone gives an agent nothing - and a tool is usable only
   * when a live connection reaches the agent, allows what the tool does, and
   * governance does not refuse it.
   */
  /**
   * The skills the agent was assigned, as they resolve where it works, and
   * whether it can really be given a step for each: an assignment whose tool
   * or capability was later taken away is shown as not usable, not hidden.
   */
  skills: Array<{
    slug: string;
    name: string;
    category: Skill["category"] | null;
    scope: Skill["scope"] | null;
    approval: Skill["approval"] | null;
    usable: boolean;
    note: string;
  }>;
  systems: Array<{
    provider: ConnectionProvider;
    name: string;
    state: "ready" | "not_connected" | "needs_attention" | "not_enabled";
    account?: string;
    scope?: "workspace" | "company";
    tools: Array<{
      toolId: string;
      name: string;
      access: "read" | "write";
      usable: boolean;
      note: string;
    }>;
  }>;
}

export interface WorkforceDependencies {
  agents: Pick<AgentRepository, "findById" | "findByOrganization">;
  reads: OperationalReadRepository;
  workspaces: Pick<WorkspaceRepository, "findByOrganization">;
  policies: Pick<PolicyRepository, "findEnforced">;
  tools: Pick<ToolRegistry, "get" | "list">;
  /** Absent in tests that are not about external systems. */
  connections?: Pick<ConnectionRepository, "list">;
  /** Absent in tests that are not about skills. */
  skills?: { effective(organizationId: OrganizationId, workspaceId?: WorkspaceId): Promise<Map<string, Skill>> };
}

/** Missions the roster's status and recent outcomes are read over. */
const MISSION_WINDOW = 100;
const PROFILE_STEPS = 40;
const PROFILE_HISTORY = 25;
const PROFILE_ARTIFACTS = 12;
const PROFILE_ACTIVITY = 25;

/** What an agent did, as opposed to the machinery that moved around it. */
const AGENT_EVENT_TYPES: EventType[] = [
  "task.started",
  "task.completed",
  "task.failed",
  "approval.requested",
  "governance.denied",
  "governance.approval_required",
  "artifact.created",
  "external.read",
  "external.write",
];

export class WorkforceService {
  constructor(private readonly deps: WorkforceDependencies) {}

  async getWorkforce(organizationId: OrganizationId, options: { reach?: Reach } = {}): Promise<Workforce> {
    const { reach } = options;

    const [agents, works, workspaces] = await Promise.all([
      this.deps.agents.findByOrganization(organizationId),
      this.deps.reads.findWorkSummaries(organizationId, MISSION_WINDOW),
      this.deps.workspaces.findByOrganization(organizationId),
    ]);

    const ownWorks = works.filter((work) => work.organizationId === organizationId);
    const tasks = ownWorks.length > 0 ? await this.deps.reads.findTaskSummaries(ownWorks.map((work) => work.id)) : [];

    const worksById = new Map(ownWorks.map((work) => [work.id, work]));
    const workspacesById = new Map(
      workspaces.filter((workspace) => workspace.organizationId === organizationId).map((workspace) => [workspace.id, workspace]),
    );

    const members = agents
      .filter((agent) => agent.organizationId === organizationId)
      .filter((agent) => !reach || reach(agent.workspaceId))
      .map((agent) =>
        this.member(agent, tasks.filter((task) => task.assignedAgentId === agent.id), worksById, workspacesById, reach));

    const count = (presence: WorkforcePresence) => members.filter((member) => member.presence === presence).length;

    return {
      organizationId,
      generatedAt: new Date(),
      missionWindow: MISSION_WINDOW,
      summary: {
        total: members.length,
        working: count("working"),
        waiting: count("waiting"),
        available: count("available"),
        paused: count("paused"),
        unavailable: count("unavailable"),
      },
      members,
    };
  }

  async getProfile(organizationId: OrganizationId, agentId: AgentId, options: { reach?: Reach } = {}): Promise<AgentProfile> {
    const { reach } = options;
    const agent = await this.deps.agents.findById(agentId);

    // Another organization's agent, and one working in a workspace the caller
    // was not given, read exactly like an id that does not exist.
    if (!agent || agent.organizationId !== organizationId || (reach && !reach(agent.workspaceId))) {
      throw new AgentNotFoundError(`Agent not found: ${agentId}`);
    }

    const [steps, events, artifacts, workspaces, enforced, connections, effectiveSkills] = await Promise.all([
      this.deps.reads.findTaskSummariesByAgent(agent.id, PROFILE_STEPS),
      this.deps.reads.findEventsByTypes(organizationId, { types: AGENT_EVENT_TYPES, agentId: agent.id, limit: PROFILE_ACTIVITY * 2 }),
      this.deps.reads.findArtifactSummariesByAgent(organizationId, agent.id, PROFILE_ARTIFACTS * 2),
      this.deps.workspaces.findByOrganization(organizationId),
      this.deps.policies.findEnforced(organizationId),
      this.agentHoldsExternalTools(agent) && this.deps.connections
        ? this.deps.connections.list(organizationId)
        : Promise.resolve([] as Connection[]),
      (agent.skills ?? []).length > 0 && this.deps.skills
        ? this.deps.skills.effective(organizationId, agent.workspaceId)
        : Promise.resolve(new Map<string, Skill>()),
    ]);

    // Steps carry no organization. Their missions are read back inside this
    // one, and a step whose mission is not found there is not this
    // organization's to show.
    const workIds = [
      ...steps.map((step) => step.workId),
      ...events.flatMap((event) => (event.workId ? [event.workId] : [])),
      ...artifacts.flatMap((artifact) => (artifact.workId ? [artifact.workId] : [])),
    ];
    const works = workIds.length > 0 ? await this.deps.reads.findWorkSummariesByIds(organizationId, workIds) : [];
    const worksById = new Map(
      works.filter((work) => work.organizationId === organizationId).map((work) => [work.id, work]),
    );
    const workspacesById = new Map(
      workspaces.filter((workspace) => workspace.organizationId === organizationId).map((workspace) => [workspace.id, workspace]),
    );

    const ownSteps = steps.filter((step) => worksById.has(step.workId));
    const visible = (workId: WorkId | undefined) => {
      if (!workId) return true;
      const work = worksById.get(workId);
      return work !== undefined && (!reach || reach(work.workspaceId));
    };

    const agentsById = new Map([[agent.id, agent]]);
    const governance = this.governanceOf(agent, enforced.filter((policy) => policy.organizationId === organizationId));

    return {
      member: this.member(agent, ownSteps, worksById, workspacesById, reach),
      history: ownSteps
        .filter((step) => visible(step.workId))
        .slice(0, PROFILE_HISTORY)
        .map((step) => ({
          taskId: step.id,
          taskTitle: clip(step.title, 160),
          status: step.status,
          missionId: step.workId,
          missionName: missionNameOf(worksById.get(step.workId)!),
          at: step.completedAt ?? step.startedAt ?? step.updatedAt,
        })),
      artifacts: artifacts
        .filter((artifact) => visible(artifact.workId))
        .slice(0, PROFILE_ARTIFACTS)
        .map((artifact) => ({
          id: artifact.id,
          name: clip(artifact.name, 160),
          type: artifact.type,
          missionId: artifact.workId,
          createdAt: artifact.createdAt,
        })),
      activity: events
        .filter((event) => event.organizationId === organizationId && event.agentId === agent.id && visible(event.workId))
        .flatMap((event) => {
          const summary = describeEvent(event, agentsById);
          return summary ? [{ id: event.id, type: event.type, at: event.timestamp, summary, missionId: event.workId }] : [];
        })
        .slice(0, PROFILE_ACTIVITY),
      governance,
      skills: (agent.skills ?? []).map((slug) => {
        const skill = effectiveSkills.get(slug);

        if (!skill) {
          return { slug, name: slug, category: null, scope: null, approval: null, usable: false, note: "This skill is no longer active here." };
        }

        const fit = skillFit(agent, skill);
        const missing = [
          ...fit.missingTools.map((toolId) => `the ${toolId} tool`),
          ...fit.missingCapabilities.map((capability) => `the ${capability} capability`),
        ];

        return {
          slug,
          name: skill.name,
          category: skill.category,
          scope: skill.scope,
          approval: skill.approval,
          usable: fit.fits,
          note: fit.fits
            ? skill.approval === "required" ? "Each step waits for an owner or admin to approve it." : "Can be given steps."
            : `Needs ${missing.join(" and ")}.`,
        };
      }),
      systems: this.systemsOf(agent, connections.filter((connection) => connection.organizationId === organizationId), governance),
    };
  }

  private agentHoldsExternalTools(agent: Agent): boolean {
    return agent.toolIds.some((toolId) => this.deps.tools.get(toolId)?.external !== undefined);
  }

  private systemsOf(agent: Agent, connections: Connection[], governance: AgentProfile["governance"]): AgentProfile["systems"] {
    const held = agent.toolIds
      .map((toolId) => this.deps.tools.get(toolId))
      .filter((tool): tool is NonNullable<typeof tool> => tool?.external !== undefined);

    const providers = [...new Set(held.map((tool) => tool.external!.provider))]
      .filter((provider): provider is ConnectionProvider => provider in PROVIDER_INFO);

    return providers.map((provider) => {
      // The connection a call from this agent would resolve to: its own
      // workspace's first, then the company-wide one.
      const live = connections.filter((connection) => connection.provider === provider && connection.status !== "revoked");
      const connection =
        (agent.workspaceId ? live.find((entry) => entry.workspaceId === agent.workspaceId) : undefined) ??
        live.find((entry) => entry.workspaceId === undefined);

      const tools = held
        .filter((tool) => tool.external!.provider === provider)
        .map((tool) => {
          const access = tool.external!.access;
          const capability = PROVIDER_INFO[provider].capabilities.find((entry) => entry.access === access)?.capability;
          const ruled = governance.tools.find((entry) => entry.toolId === tool.id);

          const [usable, note] = !connection
            ? [false, "No connection reaches this agent."]
            : connection.status !== "active"
              ? [false, "The connection needs to be reconnected."]
              : !capability || !connection.capabilities.includes(capability)
                ? [false, "The connection does not allow this."]
                : ruled?.access === "denied"
                  ? [false, "A policy refuses it."]
                  : access === "write"
                    ? [true, "Each use waits for an owner or admin to approve the step."]
                    : [true, "Available."];

          return { toolId: tool.id, name: tool.name, access, usable, note };
        });

      const state: AgentProfile["systems"][number]["state"] = !connection
        ? "not_connected"
        : connection.status !== "active"
          ? "needs_attention"
          : tools.some((tool) => tool.usable)
            ? "ready"
            : "not_enabled";

      return {
        provider,
        name: PROVIDER_INFO[provider].name,
        state,
        ...(connection
          ? { account: connection.accountLabel, scope: connection.workspaceId ? "workspace" as const : "company" as const }
          : {}),
        tools,
      };
    });
  }

  private member(
    agent: Agent,
    steps: TaskSummary[],
    worksById: Map<WorkId, WorkSummary>,
    workspacesById: Map<WorkspaceId, { id: WorkspaceId; name: string; slug: string }>,
    reach: Reach | undefined,
  ): WorkforceMember {
    const open = steps.filter((step) => {
      const work = worksById.get(step.workId);
      return work !== undefined && !isTerminal(work.status);
    });

    const running = open
      .filter((step) => step.status === "running")
      .sort((left, right) => (right.startedAt?.getTime() ?? 0) - (left.startedAt?.getTime() ?? 0));
    const waiting = open.filter((step) => step.status === "waiting");
    const holding = running[0] ?? waiting[0];
    const holdingWork = holding ? worksById.get(holding.workId) : undefined;
    const canSeeHolding = holdingWork !== undefined && (!reach || reach(holdingWork.workspaceId));

    const finished = steps
      .filter((step) => (step.status === "completed" || step.status === "failed") && worksById.has(step.workId))
      .filter((step) => !reach || reach(worksById.get(step.workId)!.workspaceId))
      .sort((left, right) => finishedAt(right).getTime() - finishedAt(left).getTime());

    const last = finished[0];
    const workspace = agent.workspaceId ? workspacesById.get(agent.workspaceId) : undefined;

    return {
      id: agent.id,
      name: agent.name,
      description: agent.description,
      type: agent.type,
      status: agent.status,
      presence: presenceOf(agent, running.length > 0, waiting.length > 0),
      capabilities: [...agent.capabilities],
      tools: agent.toolIds.map((toolId) => {
        const tool = this.deps.tools.get(toolId);
        return tool
          ? { id: tool.id, name: tool.name, description: tool.description, registered: true }
          : { id: toolId, name: toolId, description: "", registered: false };
      }),
      workspace: workspace ? { id: workspace.id, name: workspace.name, slug: workspace.slug } : undefined,
      current: holding && holdingWork && canSeeHolding
        ? {
            missionId: holdingWork.id,
            missionName: missionNameOf(holdingWork),
            taskTitle: clip(holding.title, 160),
            state: holding.status === "running" ? "working" : "waiting",
            since: holding.startedAt ?? holding.updatedAt,
          }
        : undefined,
      workingElsewhere: holding !== undefined && !canSeeHolding,
      upcomingSteps: open.filter((step) => step.status === "pending" || step.status === "ready").length,
      lastOutcome: last
        ? {
            missionId: last.workId,
            missionName: missionNameOf(worksById.get(last.workId)!),
            taskTitle: clip(last.title, 160),
            outcome: last.status === "completed" ? "completed" : "failed",
            at: finishedAt(last),
          }
        : undefined,
      recent: {
        completed: finished.filter((step) => step.status === "completed").length,
        failed: finished.filter((step) => step.status === "failed").length,
      },
    };
  }

  private governanceOf(agent: Agent, enforced: Awaited<ReturnType<PolicyRepository["findEnforced"]>>): AgentProfile["governance"] {
    const registered = this.deps.tools.list();
    const permissions = effectivePermissions({
      grantedToolIds: agent.toolIds,
      capabilities: agent.capabilities,
      agentId: agent.id,
      tools: registered.map((tool) => ({ id: tool.id, risk: tool.risk ?? "low" })),
      policies: enforced,
    });

    return {
      // Only the tools the agent holds. Everything it was never granted it
      // cannot call, whatever governance says, so it is not listed here.
      tools: permissions.flatMap((permission) =>
        permission.access === "not_granted"
          ? []
          : [{
              toolId: permission.toolId,
              name: registered.find((tool) => tool.id === permission.toolId)?.name ?? permission.toolId,
              access: permission.access,
              risk: permission.risk,
              policyNames: permission.policyNames,
              explanation: permission.explanation,
            }]),
      policies: enforced
        .filter((policy) => reachesAgent(policy, agent))
        .map((policy) => ({ id: policy.id, name: policy.name, effect: policy.effect, risk: policy.risk })),
    };
  }
}

function presenceOf(agent: Agent, running: boolean, waiting: boolean): WorkforcePresence {
  // A paused or disabled agent is given no new work, whatever it is finishing.
  if (agent.status === "paused") return "paused";
  if (agent.status === "disabled") return "unavailable";
  if (running) return "working";
  if (waiting) return "waiting";
  return "available";
}

function missionNameOf(work: WorkSummary): string {
  return clip(work.missionName ?? work.objective, 140);
}

function finishedAt(step: TaskSummary): Date {
  return step.completedAt ?? step.updatedAt;
}
