import {
  createEntityId,
  type Agent,
  type AgentId,
  type AgentStatus,
  type AgentType,
  type OrganizationId,
  type WorkspaceId,
} from "@unioffice/core";

import type {
  AgentRepository,
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
  /** The job, as the company names it - "Frontend Engineer". Optional. */
  role?: string;
  description: string;
  type: AgentType;
  capabilities: string[];
  toolIds: string[];
  workspaceId?: WorkspaceId;
  /** Skill slugs to assign straight away, checked against the agent being made. */
  skills?: string[];
}

export interface UpdateAgentInput {
  organizationId: OrganizationId;
  agentId: AgentId;
  /** A new role; null or empty clears it; undefined leaves it alone. */
  role?: string | null;
  description?: string;
  capabilities?: string[];
  toolIds?: string[];
  /** null clears the assignment; undefined leaves it alone. */
  workspaceId?: WorkspaceId | null;
  status?: AgentStatus;
  /** Skill slugs, replacing the current set. undefined leaves them alone. */
  skills?: string[];
}

/** Checks skills against the agent as it will be once the change is saved. */
export interface SkillAssignmentCheck {
  checkAssignment(agent: Agent, slugs: string[]): Promise<void>;
}

/**
 * Configuring the workforce. Reading it - who is working, on what, and what
 * each agent has done - is the WorkforceService's.
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
    private readonly toolRegistry: ToolRegistry,
    private readonly eventRecorder: EventRecorder,
    private readonly skillAssignments?: SkillAssignmentCheck,
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

  async createAgent(input: CreateAgentInput): Promise<Agent> {
    const name = requiredText(input.name, "name", 60);
    const role = optionalRole(input.role);
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
    const draft: Agent = {
      id: createEntityId<"AgentId">() as AgentId,
      organizationId: input.organizationId,
      workspaceId,
      name,
      ...(role ? { role } : {}),
      description,
      type,
      status: "active",
      capabilities,
      toolIds,
      skills: [],
      createdAt: now,
      updatedAt: now,
      metadata: {
        // Marks the row as belonging to the person rather than the seed, so
        // the development workforce sync leaves it alone on the next boot.
        userConfigured: true,
        systemInstructions: systemInstructionsFor({
          name,
          role,
          type,
          description,
          toolIds,
        }),
      },
    };

    // Skills given at creation are checked against the agent as it is about
    // to be, exactly as an assignment made afterwards would be.
    if (input.skills !== undefined && input.skills.length > 0) {
      if (!this.skillAssignments) {
        throw new AgentValidationError("Skills cannot be assigned on this server.");
      }

      draft.skills = [...new Set(input.skills.map((slug) => slug.trim()))];
      await this.skillAssignments.checkAssignment(draft, draft.skills);
    }

    const agent = await this.agentRepository.create(draft);

    await this.eventRecorder.record({
      organizationId: agent.organizationId,
      agentId: agent.id,
      actorType: "user",
      type: "agent.created",
      payload: {
        name: agent.name,
        ...(agent.role ? { role: agent.role } : {}),
        type: agent.type,
        capabilities: agent.capabilities,
        toolIds: agent.toolIds,
        skills: agent.skills ?? [],
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

    const role =
      input.role === undefined
        ? current.role
        : input.role === null
          ? undefined
          : optionalRole(input.role);

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

    const skills = input.skills === undefined
      ? current.skills
      : [...new Set(input.skills.map((slug) => slug.trim()))];

    // Checked against the agent as it will be after this change, so removing
    // a tool and assigning a skill that needs it in the same request fails
    // rather than slipping through. Existing assignments are re-checked only
    // when they are part of the change.
    if (input.skills !== undefined) {
      if (!this.skillAssignments) {
        throw new AgentValidationError("Skills cannot be assigned on this server.");
      }

      await this.skillAssignments.checkAssignment(
        { ...current, capabilities, toolIds, workspaceId, skills },
        skills ?? [],
      );
    }

    const { role: _previous, ...unchanged } = current;
    const updated = await this.agentRepository.update({
      ...unchanged,
      ...(role ? { role } : {}),
      description,
      capabilities,
      toolIds,
      skills,
      status,
      workspaceId,
      updatedAt: new Date(),
      metadata: {
        ...current.metadata,
        userConfigured: true,
        systemInstructions: systemInstructionsFor({
          name: current.name,
          role,
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
        ...(updated.role ? { role: updated.role } : {}),
        status: updated.status,
        capabilities: updated.capabilities,
        toolIds: updated.toolIds,
        skills: updated.skills ?? [],
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
/**
 * A role is a short job title: optional, trimmed, and at most 60 characters.
 * Empty is the same as none.
 */
function optionalRole(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw new AgentValidationError("role must be text.");

  const role = value.trim();
  if (!role) return undefined;
  if (role.length > 60) throw new AgentValidationError("role must be at most 60 characters.");
  return role;
}

export function systemInstructionsFor(agent: {
  name: string;
  role?: string;
  type: AgentType;
  description: string;
  toolIds: string[];
}): string {
  return [
    agent.role
      ? `You are ${agent.name}, the UNIOFFICE ${agent.role}.`
      : `You are ${agent.name}, a UNIOFFICE ${agent.type}.`,
    agent.description,
    "Complete the assigned task using the supplied context.",
    "Be concise. Lead with the answer, and surface an assumption only when a different one would change it.",
    agent.toolIds.length > 0
      ? "Use your available tools for calculations or lookups instead of guessing; never claim to have used a tool you did not actually call."
      : "You do not have tools unless they are explicitly listed. Do not claim external tool use.",
  ].join("\n");
}
