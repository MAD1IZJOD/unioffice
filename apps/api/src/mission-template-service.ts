import {
  isPolicyEnforced,
  type Agent,
  type OrganizationId,
  type Policy,
  type UserId,
  type Work,
  type WorkPriority,
  type WorkspaceId,
} from "@unioffice/core";

import type {
  AgentRepository,
  PolicyRepository,
  WorkspaceRepository,
} from "@unioffice/database";

import { sanitizeKnowledgeText } from "@unioffice/memory";

import type { WorkApplicationService } from "./application.js";

import {
  findMissionTemplate,
  MISSION_TEMPLATES,
  type MissionTemplate,
} from "./mission-templates.js";

import { WorkspaceNotFoundError } from "./workspace-service.js";

/**
 * Starting a mission from a template.
 *
 * This is deliberately thin. It turns a template and the person's answers into
 * a normal work item - a clear objective and a structured briefing - through
 * the same application service a mission typed from scratch uses. It does not
 * plan, pick agents, queue execution or consider approvals: all of that
 * happens afterwards, on the one path every mission takes.
 */

export class MissionTemplateNotFoundError extends Error {
  constructor() {
    super("Mission template not found.");
    this.name = "MissionTemplateNotFoundError";
  }
}

export class MissionTemplateValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MissionTemplateValidationError";
  }
}

export interface TemplateTeamMember {
  agentId: Agent["id"];
  name: string;
  type: Agent["type"];
  /** The template's disciplines this agent actually holds. */
  matchedCapabilities: string[];
}

export interface TemplateGovernanceSignal {
  /**
   * Active rules that could stop a step or a tool for this team. Whether one
   * actually fires depends on the plan the orchestrator writes.
   */
  gatingPolicies: Array<{ id: Policy["id"]; name: string; effect: Policy["effect"] }>;
}

export interface MissionTemplateView {
  template: MissionTemplate;
  /** Real agents from the roster, strongest match first. */
  likelyTeam: TemplateTeamMember[];
  /** The orchestrator that will plan, when the roster has one. */
  planner?: TemplateTeamMember;
  governance: TemplateGovernanceSignal;
}

export interface StartTemplateMissionInput {
  organizationId: OrganizationId;
  requesterId: UserId;
  templateId: string;
  name?: string;
  objective: string;
  context?: string;
  desiredOutcome: string;
  constraints?: string;
  priority?: WorkPriority;
  workspaceId?: WorkspaceId;
}

/** Bounds on what a person may type. The briefing overall is capped too. */
export const TEMPLATE_INPUT_LIMITS = {
  name: 120,
  objective: 1_000,
  context: 1_800,
  desiredOutcome: 600,
  constraints: 600,
} as const;

const MIN_OBJECTIVE_CHARS = 8;
const MIN_OUTCOME_CHARS = 4;

/** The existing briefing limit on a work item. */
const MAX_BRIEFING_CHARS = 4_000;

const TEAM_SIZE = 4;

export class MissionTemplateService {
  constructor(
    private readonly applicationService: Pick<WorkApplicationService, "createWork">,
    private readonly agentRepository: AgentRepository,
    private readonly workspaceRepository: WorkspaceRepository,
    private readonly policyRepository: PolicyRepository,
  ) {}

  async listTemplates(organizationId: OrganizationId): Promise<MissionTemplateView[]> {
    const [agents, policies] = await Promise.all([
      this.agentRepository.findByOrganization(organizationId),
      this.policyRepository.findEnforced(organizationId),
    ]);

    return MISSION_TEMPLATES.map((template) => this.describe(template, agents, policies, organizationId));
  }

  async getTemplate(organizationId: OrganizationId, templateId: string): Promise<MissionTemplateView> {
    const template = findMissionTemplate(templateId);

    if (!template) {
      throw new MissionTemplateNotFoundError();
    }

    const [agents, policies] = await Promise.all([
      this.agentRepository.findByOrganization(organizationId),
      this.policyRepository.findEnforced(organizationId),
    ]);

    return this.describe(template, agents, policies, organizationId);
  }

  /**
   * Creates the mission. Every input is validated here, whatever the client
   * already checked, and only the fields listed on the input are ever read -
   * the caller cannot attach agents, tools, tasks or approval state.
   */
  async startMission(input: StartTemplateMissionInput): Promise<Work> {
    const template = findMissionTemplate(input.templateId);

    if (!template) {
      throw new MissionTemplateNotFoundError();
    }

    const name = optionalField(input.name, "name", TEMPLATE_INPUT_LIMITS.name);
    const objective = requiredField(input.objective, "objective", TEMPLATE_INPUT_LIMITS.objective, MIN_OBJECTIVE_CHARS);
    const desiredOutcome = requiredField(input.desiredOutcome, "desiredOutcome", TEMPLATE_INPUT_LIMITS.desiredOutcome, MIN_OUTCOME_CHARS);
    const context = optionalField(input.context, "context", TEMPLATE_INPUT_LIMITS.context);
    const constraints = optionalField(input.constraints, "constraints", TEMPLATE_INPUT_LIMITS.constraints);

    if (input.workspaceId) {
      await this.requireActiveWorkspace(input.organizationId, input.workspaceId);
    }

    const briefing = composeBriefing(template, { name, desiredOutcome, context, constraints });

    return this.applicationService.createWork({
      organizationId: input.organizationId,
      requesterId: input.requesterId,
      objective,
      priority: input.priority,
      workspaceId: input.workspaceId,
      metadata: {
        briefing,
        // Which template, and which version of it, briefed this mission - so
        // a mission can always be traced back to what shaped it, even after
        // the template changes.
        template: {
          id: template.id,
          version: template.version,
          name: template.name,
        },
        ...(name ? { missionName: name } : {}),
      },
    });
  }

  private describe(
    template: MissionTemplate,
    agents: Agent[],
    policies: Policy[],
    organizationId: OrganizationId,
  ): MissionTemplateView {
    const active = agents.filter((agent) => agent.status === "active" && agent.organizationId === organizationId);

    const likelyTeam = active
      .filter((agent) => agent.type !== "orchestrator")
      .map((agent) => ({
        agentId: agent.id,
        name: agent.name,
        type: agent.type,
        matchedCapabilities: template.capabilities.filter((capability) => agent.capabilities.includes(capability)),
      }))
      .filter((member) => member.matchedCapabilities.length > 0)
      .sort((left, right) =>
        right.matchedCapabilities.length - left.matchedCapabilities.length ||
        left.name.localeCompare(right.name))
      .slice(0, TEAM_SIZE);

    const orchestrator = active.find((agent) => agent.type === "orchestrator");

    const teamAgents = active.filter((agent) =>
      likelyTeam.some((member) => member.agentId === agent.id) || agent.id === orchestrator?.id);

    return {
      template,
      likelyTeam,
      planner: orchestrator
        ? { agentId: orchestrator.id, name: orchestrator.name, type: orchestrator.type, matchedCapabilities: [] }
        : undefined,
      governance: {
        gatingPolicies: policies
          .filter(isPolicyEnforced)
          .filter((policy) => policy.organizationId === organizationId)
          .filter((policy) => policy.subject === "task" || policy.subject === "tool")
          .filter((policy) => policy.effect === "require_approval" || policy.effect === "deny")
          .filter((policy) => teamAgents.some((agent) => couldReach(policy, agent)))
          .map((policy) => ({ id: policy.id, name: policy.name, effect: policy.effect })),
      },
    };
  }

  private async requireActiveWorkspace(organizationId: OrganizationId, workspaceId: WorkspaceId): Promise<void> {
    const workspace = await this.workspaceRepository.findById(workspaceId);

    // A workspace in another organization reads exactly like one that does not
    // exist, so the id space is not probeable through this route.
    if (!workspace || workspace.organizationId !== organizationId) {
      throw new WorkspaceNotFoundError("Workspace not found.");
    }

    if (workspace.status !== "active") {
      throw new MissionTemplateValidationError("That workspace is archived and cannot run new missions.");
    }
  }
}

/**
 * The briefing the planner reads. Each part is labelled so the planner can
 * tell the person's own words from the template's guidance, and the whole
 * thing is kept inside the existing briefing limit.
 */
export function composeBriefing(
  template: MissionTemplate,
  parts: { name?: string; desiredOutcome: string; context?: string; constraints?: string },
): string {
  const sections = [
    `Mission type: ${template.name}.`,
    parts.name ? `Mission name: ${parts.name}` : "",
    `Desired outcome: ${parts.desiredOutcome}`,
    parts.context ? `Context from the requester:\n${parts.context}` : "",
    parts.constraints ? `Constraints (binding):\n${parts.constraints}` : "",
    `What this kind of mission usually covers (guidance, not a fixed plan): ${template.planningGuidance}`,
  ].filter((section) => section !== "");

  const briefing = sections.join("\n\n");

  return briefing.length <= MAX_BRIEFING_CHARS
    ? briefing
    : `${briefing.slice(0, MAX_BRIEFING_CHARS - 1)}…`;
}

/** Whether a policy's scope could apply to this agent at all. */
function couldReach(policy: Policy, agent: Agent): boolean {
  const { scope } = policy;

  if (scope.agentIds.length > 0 && !scope.agentIds.includes(agent.id)) return false;

  if (scope.capabilities.length > 0 && !scope.capabilities.some((capability) => agent.capabilities.includes(capability))) {
    return false;
  }

  if (policy.subject === "tool" && scope.toolIds.length > 0 && !scope.toolIds.some((toolId) => agent.toolIds.includes(toolId))) {
    return false;
  }

  return true;
}

function requiredField(value: string | undefined, field: string, maxChars: number, minChars: number): string {
  const text = clean(value, field, maxChars);

  if (!text || text.length < minChars) {
    throw new MissionTemplateValidationError(`${field} is required.`);
  }

  return text;
}

function optionalField(value: string | undefined, field: string, maxChars: number): string | undefined {
  return clean(value, field, maxChars) || undefined;
}

/**
 * Normalizes what a person typed. Invisible and control characters are removed
 * - they are how an instruction hides from a reader - and anything over the
 * limit is refused rather than silently cut, so the person knows.
 */
function clean(value: string | undefined, field: string, maxChars: number): string {
  if (value === undefined || value === null) return "";

  if (typeof value !== "string") {
    throw new MissionTemplateValidationError(`${field} must be text.`);
  }

  if (value.length > maxChars * 2) {
    throw new MissionTemplateValidationError(`${field} must be ${maxChars} characters or fewer.`);
  }

  const text = sanitizeKnowledgeText(value, Number.MAX_SAFE_INTEGER);

  if (text.length > maxChars) {
    throw new MissionTemplateValidationError(`${field} must be ${maxChars} characters or fewer.`);
  }

  return text;
}
