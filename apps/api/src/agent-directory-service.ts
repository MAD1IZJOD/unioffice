import {
  createEntityId,
  type Agent,
  type AgentId,
  type AgentStatus,
  type AgentType,
  type Artifact,
  type Event,
  type OrganizationId,
  type Task,
  type Work,
  type Workspace,
  type WorkspaceId,
} from "@unioffice/core";

import type {
  AgentRepository,
  ArtifactRepository,
  EventRepository,
  TaskRepository,
  WorkRepository,
  WorkspaceRepository,
} from "@unioffice/database";

import type { ToolRegistry } from "@unioffice/tools";

import type { EventRecorder } from "./event-recorder.js";

export class AgentValidationError extends Error {}
export class AgentNotFoundError extends Error {}

const AGENT_TYPES: AgentType[] = ["specialist", "manager", "orchestrator"];
const AGENT_STATUSES: AgentStatus[] = ["active", "paused", "disabled"];

/**
 * Capabilities are the planner's routing vocabulary, so they are lower-cased
 * and trimmed on the way in. "Financial Analysis" and "financial_analysis"
 * being two different capabilities is a routing bug waiting to happen.
 */
const MAX_CAPABILITIES = 12;

export interface CreateAgentInput {
  organizationId: OrganizationId;
  name: string;
  description: string;
  type: AgentType;
  capabilities: string[];
  toolIds: string[];
  workspaceId?: WorkspaceId;
}

export interface UpdateAgentInput {
  organizationId: OrganizationId;
  agentId: AgentId;
  description?: string;
  capabilities?: string[];
  toolIds?: string[];
  /** null clears the assignment; undefined leaves it alone. */
  workspaceId?: WorkspaceId | null;
  status?: AgentStatus;
}

/** One task an agent held, with the mission it belonged to. */
export interface AgentAssignment {
  task: Task;
  work?: Work;
}

export interface AgentDetail {
  agent: Agent;
  workspace?: Workspace;
  /** Tools the agent is authorized for, described from the live registry. */
  tools: Array<{ id: string; name: string; description: string }>;
  /** Tool ids on the agent that no longer exist in the registry. */
  unknownToolIds: string[];
  assignments: AgentAssignment[];
  current?: AgentAssignment;
  artifacts: Artifact[];
  activity: Event[];
  completedCount: number;
  failedCount: number;
}

/**
 * Reading and configuring the workforce.
 *
 * Two rules run through all of it. Everything is organization-scoped, so an
 * agent from another organization is not found rather than forbidden. And an
 * orchestrator is treated as system-critical: the whole pipeline routes
 * through one, so this service will not let the last one be disabled, retyped
 * or stripped of the capabilities the planner selects it by.
 */
export class AgentDirectoryService {
  constructor(
    private readonly agentRepository: AgentRepository,
    private readonly workspaceRepository: WorkspaceRepository,
    private readonly taskRepository: TaskRepository,
    private readonly workRepository: WorkRepository,
    private readonly artifactRepository: ArtifactRepository,
    private readonly eventRepository: EventRepository,
    private readonly toolRegistry: ToolRegistry,
    private readonly eventRecorder: EventRecorder,
  ) {}

  async getAgent(
    organizationId: OrganizationId,
    agentId: AgentId,
  ): Promise<Agent> {
    const agent = await this.agentRepository.findById(agentId);

    if (!agent || agent.organizationId !== organizationId) {
      throw new AgentNotFoundError(`Agent not found: ${agentId}`);
    }

    return agent;
  }

  async getAgentDetail(
    organizationId: OrganizationId,
    agentId: AgentId,
  ): Promise<AgentDetail> {
    const agent = await this.getAgent(organizationId, agentId);

    const [tasks, artifacts, activity, workspace] = await Promise.all([
      this.taskRepository.findByAgent(agentId, 40),
      this.artifactRepository.findByOrganization(organizationId, 200),
      this.eventRepository.findByOrganization(organizationId, 200),
      agent.workspaceId
        ? this.workspaceRepository.findById(agent.workspaceId)
        : Promise.resolve(null),
    ]);

    // One read per distinct mission the agent touched, rather than the whole
    // organization's work to find a handful of objectives.
    const workIds = [...new Set(tasks.map((task) => task.workId))];
    const work = await Promise.all(
      workIds.map((workId) => this.workRepository.findById(workId)),
    );
    const workById = new Map(
      work.filter((item): item is Work => item !== null).map((item) => [
        item.id,
        item,
      ]),
    );

    const assignments: AgentAssignment[] = tasks.map((task) => ({
      task,
      work: workById.get(task.workId),
    }));

    const authorized = agent.toolIds.map((toolId) => ({
      toolId,
      tool: this.toolRegistry.get(toolId),
    }));

    return {
      agent,
      // A workspace that was deleted out from under the agent reads as no
      // workspace rather than as a broken reference.
      workspace: workspace ?? undefined,
      tools: authorized
        .filter((entry) => entry.tool !== null)
        .map((entry) => ({
          id: entry.tool!.id,
          name: entry.tool!.name,
          description: entry.tool!.description,
        })),
      unknownToolIds: authorized
        .filter((entry) => entry.tool === null)
        .map((entry) => entry.toolId),
      assignments,
      current: assignments.find(
        (assignment) => assignment.task.status === "running",
      ),
      artifacts: artifacts
        .filter((artifact) => artifact.createdByAgentId === agentId)
        .slice(0, 20),
      activity: activity
        .filter((event) => event.agentId === agentId)
        .slice(0, 30),
      completedCount: tasks.filter((task) => task.status === "completed")
        .length,
      failedCount: tasks.filter((task) => task.status === "failed").length,
    };
  }

  async createAgent(input: CreateAgentInput): Promise<Agent> {
    const name = requiredText(input.name, "name", 60);
    const description = requiredText(input.description, "description", 600);
    const type = this.parseType(input.type);
    const capabilities = parseCapabilities(input.capabilities);
    const toolIds = this.parseToolIds(input.toolIds);
    const workspaceId = await this.resolveWorkspace(
      input.organizationId,
      input.workspaceId,
    );

    const existing = await this.agentRepository.findByOrganization(
      input.organizationId,
    );

    if (
      existing.some(
        (agent) => agent.name.toLowerCase() === name.toLowerCase(),
      )
    ) {
      throw new AgentValidationError(
        `This organization already has an agent called ${name}.`,
      );
    }

    const now = new Date();
    const agent = await this.agentRepository.create({
      id: createEntityId<"AgentId">() as AgentId,
      organizationId: input.organizationId,
      workspaceId,
      name,
      description,
      type,
      status: "active",
      capabilities,
      toolIds,
      createdAt: now,
      updatedAt: now,
      metadata: {
        // Marks the row as belonging to the person rather than the seed, so
        // the development workforce sync leaves it alone on the next boot.
        userConfigured: true,
        systemInstructions: systemInstructionsFor({
          name,
          type,
          description,
          toolIds,
        }),
      },
    });

    await this.eventRecorder.record({
      organizationId: agent.organizationId,
      agentId: agent.id,
      actorType: "user",
      type: "agent.created",
      payload: {
        name: agent.name,
        type: agent.type,
        capabilities: agent.capabilities,
        toolIds: agent.toolIds,
        workspaceId: agent.workspaceId,
      },
    });

    return agent;
  }

  async updateAgent(input: UpdateAgentInput): Promise<Agent> {
    const current = await this.getAgent(input.organizationId, input.agentId);

    const description =
      input.description === undefined
        ? current.description
        : requiredText(input.description, "description", 600);

    const capabilities =
      input.capabilities === undefined
        ? current.capabilities
        : parseCapabilities(input.capabilities);

    const toolIds =
      input.toolIds === undefined
        ? current.toolIds
        : this.parseToolIds(input.toolIds);

    const status = input.status ?? current.status;

    if (!AGENT_STATUSES.includes(status)) {
      throw new AgentValidationError("status is invalid.");
    }

    const workspaceId =
      input.workspaceId === undefined
        ? current.workspaceId
        : input.workspaceId === null
          ? undefined
          : await this.resolveWorkspace(
              input.organizationId,
              input.workspaceId,
            );

    // The orchestrator is what turns an objective into a plan and routes it.
    // Every one of these edits would leave the pipeline unable to run, and
    // finding that out at the next mission is far too late.
    if (current.type === "orchestrator") {
      if (status !== "active") {
        await this.requireAnotherOrchestrator(current);
      }

      for (const capability of current.capabilities) {
        if (!capabilities.includes(capability)) {
          throw new AgentValidationError(
            `${current.name} orchestrates this organization's work and the planner selects it by its capabilities. "${capability}" cannot be removed.`,
          );
        }
      }
    }

    const updated = await this.agentRepository.update({
      ...current,
      description,
      capabilities,
      toolIds,
      status,
      workspaceId,
      updatedAt: new Date(),
      metadata: {
        ...current.metadata,
        userConfigured: true,
        systemInstructions: systemInstructionsFor({
          name: current.name,
          type: current.type,
          description,
          toolIds,
        }),
      },
    });

    await this.eventRecorder.record({
      organizationId: updated.organizationId,
      agentId: updated.id,
      actorType: "user",
      type: "agent.updated",
      payload: {
        name: updated.name,
        status: updated.status,
        capabilities: updated.capabilities,
        toolIds: updated.toolIds,
        workspaceId: updated.workspaceId,
      },
    });

    return updated;
  }

  private async requireAnotherOrchestrator(current: Agent): Promise<void> {
    const roster = await this.agentRepository.findByOrganization(
      current.organizationId,
    );

    const others = roster.filter(
      (agent) =>
        agent.id !== current.id &&
        agent.type === "orchestrator" &&
        agent.status === "active",
    );

    if (others.length === 0) {
      throw new AgentValidationError(
        `${current.name} is the only active orchestrator. Nothing could plan or route work without it, so it cannot be paused or disabled.`,
      );
    }
  }

  private parseType(value: AgentType): AgentType {
    if (!AGENT_TYPES.includes(value)) {
      throw new AgentValidationError("type is invalid.");
    }

    return value;
  }

  /**
   * Tool authorization is a hard boundary the delegator and the runtime both
   * enforce, so a tool id that is not in the registry is refused here rather
   * than stored and discovered mid-run.
   */
  private parseToolIds(value: string[]): string[] {
    if (!Array.isArray(value)) {
      throw new AgentValidationError("toolIds must be an array.");
    }

    const toolIds = value.map((toolId) => {
      if (typeof toolId !== "string" || !toolId.trim()) {
        throw new AgentValidationError("A tool id must be a non-empty string.");
      }

      return toolId.trim();
    });

    const unique = [...new Set(toolIds)];

    for (const toolId of unique) {
      if (!this.toolRegistry.has(toolId)) {
        throw new AgentValidationError(`No such tool: ${toolId}`);
      }
    }

    return unique;
  }

  private async resolveWorkspace(
    organizationId: OrganizationId,
    workspaceId: WorkspaceId | undefined,
  ): Promise<WorkspaceId | undefined> {
    if (!workspaceId) return undefined;

    const workspace = await this.workspaceRepository.findById(workspaceId);

    if (!workspace || workspace.organizationId !== organizationId) {
      throw new AgentValidationError(
        "That workspace does not belong to this organization.",
      );
    }

    return workspace.id;
  }
}

function requiredText(value: string, field: string, max: number): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new AgentValidationError(`${field} is required.`);
  }

  const text = value.trim();

  if (text.length > max) {
    throw new AgentValidationError(
      `${field} must be ${max} characters or fewer.`,
    );
  }

  return text;
}

function parseCapabilities(value: string[]): string[] {
  if (!Array.isArray(value)) {
    throw new AgentValidationError("capabilities must be an array.");
  }

  const capabilities = value.map((capability) => {
    if (typeof capability !== "string" || !capability.trim()) {
      throw new AgentValidationError(
        "A capability must be a non-empty string.",
      );
    }

    const normalized = capability.trim().toLowerCase().replace(/\s+/g, "_");

    if (!/^[a-z][a-z0-9_]{1,39}$/.test(normalized)) {
      throw new AgentValidationError(
        `"${capability}" is not a usable capability. Use letters, numbers and underscores.`,
      );
    }

    return normalized;
  });

  const unique = [...new Set(capabilities)];

  if (unique.length === 0) {
    throw new AgentValidationError(
      "An agent needs at least one capability, or the delegator can never route anything to it.",
    );
  }

  if (unique.length > MAX_CAPABILITIES) {
    throw new AgentValidationError(
      `An agent can hold at most ${MAX_CAPABILITIES} capabilities.`,
    );
  }

  return unique;
}

/**
 * The prompt preamble the runtime hands the model. Written the same way the
 * seeded workforce writes it, so a user-created agent behaves like a seeded
 * one rather than arriving with no instructions at all.
 */
export function systemInstructionsFor(agent: {
  name: string;
  type: AgentType;
  description: string;
  toolIds: string[];
}): string {
  return [
    `You are ${agent.name}, a UNI-OFFICE ${agent.type}.`,
    agent.description,
    "Complete the assigned task using the supplied context.",
    "Be concise. Lead with the answer, and surface an assumption only when a different one would change it.",
    agent.toolIds.length > 0
      ? "Use your available tools for calculations or lookups instead of guessing; never claim to have used a tool you did not actually call."
      : "You do not have tools unless they are explicitly listed. Do not claim external tool use.",
  ].join("\n");
}
