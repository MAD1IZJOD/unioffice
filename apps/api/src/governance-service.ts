import {
  createEntityId,
  highestRisk,
  hasPolicyConditions,
  isKnowledgeSubject,
  KNOWLEDGE_TYPES,
  missionStarterOf,
  type Agent,
  type AgentId,
  type OrganizationId,
  type Policy,
  type PolicyConditions,
  type PolicyId,
  type PolicyStatus,
  type Task,
  type Work,
} from "@unioffice/core";

import type {
  PolicyRepository,
} from "@unioffice/database";

import {
  DefaultPolicyEngine,
  type GovernanceAction,
  type GovernanceContext,
  type GovernanceDecision,
  type PolicyEngine,
} from "@unioffice/governance";

import type { ToolRegistry } from "@unioffice/tools";

import type { EventRecorder } from "./event-recorder.js";

/**
 * The company's control layer.
 *
 * One question, asked at the two points where the system can actually be
 * stopped: may this step start, and may this tool run. Everything else in the
 * product reads governance; this is the only thing that decides it.
 *
 * Three properties are deliberate:
 *
 * - Deterministic. The engine is pure and no model is consulted. Asking a
 *   language model whether an action is permitted would make the answer
 *   unreproducible, which is disqualifying for something that has to be
 *   defensible after the fact.
 * - Recorded. Every decision that is not a plain uneventful allow is written
 *   to the event log, so the audit trail is a by-product of enforcement
 *   rather than something maintained alongside it and able to disagree.
 * - Additive. Governance narrows what the tool registry and the agent's own
 *   grants already permit. It can never widen them.
 */

export class PolicyValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PolicyValidationError";
  }
}

export class PolicyNotFoundError extends Error {
  constructor(id: string) {
    super(`Policy not found: ${id}`);
    this.name = "PolicyNotFoundError";
  }
}

export interface CreatePolicyInput {
  organizationId: OrganizationId;
  name: string;
  description: string;
  subject: Policy["subject"];
  effect: Policy["effect"];
  risk: Policy["risk"];
  status?: PolicyStatus;
  scope?: Partial<Policy["scope"]>;
  /** When the rule applies, beyond its scope. Absent is always. */
  conditions?: PolicyConditions;
  approvalPrompt?: string;
  createdBy?: string;
}

export interface UpdatePolicyInput {
  organizationId: OrganizationId;
  policyId: PolicyId;
  name?: string;
  description?: string;
  effect?: Policy["effect"];
  risk?: Policy["risk"];
  status?: PolicyStatus;
  scope?: Partial<Policy["scope"]>;
  /** Replaces the conditions; an empty object clears them. Undefined leaves them. */
  conditions?: PolicyConditions;
  /** null clears the prompt; undefined leaves it alone. */
  approvalPrompt?: string | null;
  /** Who is making the change, for the rule and its audit line. */
  updatedBy?: string;
}

/** What the decision was about, for the audit line. */
export interface DecisionSubject {
  organizationId: OrganizationId;
  workId?: Work["id"];
  taskId?: Task["id"];
  agentId?: AgentId;
  /** "Use calculator" or the step's title. Never raw tool input. */
  action: string;
}

export class GovernanceService {
  private readonly engine: PolicyEngine;

  constructor(
    private readonly policyRepository: PolicyRepository,
    private readonly toolRegistry: ToolRegistry,
    private readonly eventRecorder: EventRecorder,
    engine: PolicyEngine = new DefaultPolicyEngine(),
  ) {
    this.engine = engine;
  }

  /* ----------------------------------------------------------------------
     Evaluation. The execution path.
     ---------------------------------------------------------------------- */

  /**
   * Whether a step may be handed to its agent.
   *
   * Called before the step becomes ready, so a denial stops it before any
   * model is invoked and an approval requirement is raised before work is
   * wasted on something a person may refuse.
   */
  async evaluateTask(
    work: Work,
    task: Task,
    agent: Agent | undefined,
  ): Promise<GovernanceDecision> {
    const policies = await this.policyRepository.findEnforced(
      work.organizationId,
    );

    const decision = this.engine.evaluate(
      {
        kind: "task",
        title: task.title,
        requiredTools: requiredToolsOf(task),
        externalWrites: this.externalWritesFor(task),
      },
      {
        organizationId: work.organizationId,
        agentId: agent?.id,
        agentCapabilities: agent?.capabilities ?? [],
        agentToolIds: agent?.toolIds ?? [],
        workspaceId: work.workspaceId,
        workId: work.id,
        taskId: task.id,
        startedBy: missionStarterOf(work),
      },
      policies,
    );

    return this.withSkillFloor(this.withExternalWriteFloor(decision, task), task);
  }

  /** The skill a step follows, as the server recorded it when routing. */
  skillOf(task: Task): { slug: string; name: string; approval: string } | undefined {
    const routing = task.metadata.routing;
    const skill = typeof routing === "object" && routing !== null
      ? (routing as { skill?: unknown }).skill
      : undefined;

    if (typeof skill !== "object" || skill === null) return undefined;

    const { slug, name, approval } = skill as Record<string, unknown>;
    return typeof slug === "string" && typeof name === "string" && typeof approval === "string"
      ? { slug, name, approval }
      : undefined;
  }

  /**
   * A skill that requires approval holds every step that follows it.
   *
   * Like the external-write floor, a policy cannot lower it and a deny still
   * wins. A skill can only ever add this requirement - there is no setting on
   * a skill that removes an approval something else asked for.
   */
  private withSkillFloor(decision: GovernanceDecision, task: Task): GovernanceDecision {
    const skill = this.skillOf(task);

    if (!skill || skill.approval !== "required" || decision.outcome === "deny") {
      return decision;
    }

    const alreadyRequired = decision.outcome === "require_approval";

    return {
      ...decision,
      outcome: "require_approval",
      risk: highestRisk(decision.risk, "medium"),
      summary: alreadyRequired
        ? decision.summary
        : `“${task.title}” follows the ${skill.name} skill, which needs a person to approve each step.`,
      approvalPrompt: decision.approvalPrompt ??
        `This step follows the ${skill.name} skill, which the company set to need approval every time. Approve only if it should go ahead.`,
    };
  }

  /**
   * The step's tools that change something outside the company.
   *
   * Exposed so the execution path can record, on the approval itself, exactly
   * which external writes a person is being asked to allow.
   */
  externalWritesFor(task: Task): string[] {
    return requiredToolsOf(task).filter(
      (toolId) => this.toolRegistry.get(toolId)?.external?.access === "write",
    );
  }

  /**
   * A step that writes to another system always needs a person.
   *
   * Not a policy the company can pause or archive: an agent opening a pull
   * request or an issue acts in the company's name somewhere others can see,
   * so the floor is part of the product. Policies still apply on top - a
   * deny stays a deny, and a policy's own approval prompt is kept - but no
   * allow, and no absence of rules, can lower it.
   */
  private withExternalWriteFloor(decision: GovernanceDecision, task: Task): GovernanceDecision {
    const writes = this.externalWritesFor(task);

    if (writes.length === 0 || decision.outcome === "deny") {
      return decision;
    }

    const systems = [...new Set(writes.map((toolId) => this.toolRegistry.get(toolId)?.external?.provider ?? "an external system"))]
      .map(systemName)
      .join(" and ");

    return {
      ...decision,
      outcome: "require_approval",
      risk: highestRisk(decision.risk, "high"),
      summary: decision.outcome === "require_approval"
        ? decision.summary
        : `“${task.title}” changes something in ${systems}, so a person must approve it first.`,
      approvalPrompt: decision.approvalPrompt ??
        `This step will use ${writes.join(", ")} to change something in ${systems}. Approve only if that change should happen.`,
    };
  }

  /**
   * Whether one tool call may run.
   *
   * A tool decision is only ever allow or deny at the point of the call - by
   * then the agent is mid-reasoning and there is nothing sensible to suspend.
   * A tool that should need a person is governed at the step instead, which
   * is why require_approval is folded into deny here and says so.
   */
  async evaluateToolCall(input: {
    organizationId: OrganizationId;
    toolId: string;
    agentId?: AgentId;
    agentCapabilities: string[];
    agentToolIds: string[];
    workspaceId?: Work["workspaceId"];
    workId?: Work["id"];
    taskId?: Task["id"];
    /** Who started the mission the call belongs to. Absent is a person. */
    startedBy?: "schedule" | "person";
  }): Promise<GovernanceDecision> {
    const policies = await this.policyRepository.findEnforced(
      input.organizationId,
    );

    const action: GovernanceAction = {
      kind: "tool",
      toolId: input.toolId,
      toolRisk: this.toolRegistry.get(input.toolId)?.risk ?? "low",
      writesExternally: this.toolRegistry.get(input.toolId)?.external?.access === "write",
    };

    const context: GovernanceContext = {
      organizationId: input.organizationId,
      agentId: input.agentId,
      agentCapabilities: input.agentCapabilities,
      agentToolIds: input.agentToolIds,
      workspaceId: input.workspaceId,
      workId: input.workId,
      taskId: input.taskId,
      startedBy: input.startedBy,
    };

    return this.engine.evaluate(action, context, policies);
  }

  /**
   * Writes the decision to the event log.
   *
   * A plain allow with no policy behind it is not recorded. Governance runs
   * on every step and every tool call, and writing "nothing applied" each
   * time would bury the decisions that matter under the ones that do not.
   */
  async recordDecision(
    decision: GovernanceDecision,
    subject: DecisionSubject,
  ): Promise<void> {
    if (decision.outcome === "allow" && decision.reasons.length === 0) {
      return;
    }

    const type =
      decision.outcome === "deny"
        ? "governance.denied"
        : decision.outcome === "require_approval"
          ? "governance.approval_required"
          : "governance.allowed";

    await this.eventRecorder.record({
      organizationId: subject.organizationId,
      workId: subject.workId,
      taskId: subject.taskId,
      agentId: subject.agentId,
      type,
      payload: {
        action: subject.action,
        outcome: decision.outcome,
        risk: decision.risk,
        summary: decision.summary,
        policyId: decision.decidingPolicyId,
        policyName: decision.decidingPolicyName,
        // Every policy that matched, so the record explains the decision
        // rather than only naming the winner. Deliberately no tool input:
        // an audit line must never become a place arguments leak.
        reasons: decision.reasons.map((reason) => ({
          policyId: reason.policyId,
          policyName: reason.policyName,
          effect: reason.effect,
          risk: reason.risk,
          explanation: reason.explanation,
        })),
      },
    });
  }

  /* ----------------------------------------------------------------------
     Authoring. The control surface.
     ---------------------------------------------------------------------- */

  async listPolicies(
    organizationId: OrganizationId,
    options: { includeArchived?: boolean } = {},
  ): Promise<Policy[]> {
    return this.policyRepository.findByOrganization(organizationId, {
      includeArchived: options.includeArchived,
    });
  }

  async getPolicy(
    organizationId: OrganizationId,
    policyId: PolicyId,
  ): Promise<Policy> {
    const policy = await this.policyRepository.findById(policyId);

    // A policy belonging to another organization is not found rather than
    // forbidden - the same shape every other scoped read here uses.
    if (!policy || policy.organizationId !== organizationId) {
      throw new PolicyNotFoundError(policyId);
    }

    return policy;
  }

  async createPolicy(input: CreatePolicyInput): Promise<Policy> {
    const name = requiredText(input.name, "name");
    const scope = normalizeScope(input.scope);
    const conditions = normalizeConditions(input.conditions);

    this.validate({
      name,
      subject: input.subject,
      effect: input.effect,
      scope,
      conditions,
    });

    const now = new Date();
    const policy = await this.policyRepository.create({
      id: createEntityId<"PolicyId">() as PolicyId,
      organizationId: input.organizationId,
      name,
      description: input.description?.trim() ?? "",
      subject: input.subject,
      scope,
      conditions,
      effect: input.effect,
      risk: input.risk,
      // New rules start as drafts. A policy that began enforcing the moment
      // it was typed would make the authoring form a live control surface,
      // and a half-finished scope would stop real work.
      status: input.status ?? "draft",
      approvalPrompt: input.approvalPrompt?.trim() || undefined,
      createdAt: now,
      updatedAt: now,
      createdBy: input.createdBy,
      metadata: {},
    });

    await this.eventRecorder.record({
      organizationId: policy.organizationId,
      actorType: "user",
      actorId: input.createdBy,
      type: "policy.created",
      payload: {
        policyId: policy.id,
        name: policy.name,
        subject: policy.subject,
        effect: policy.effect,
        risk: policy.risk,
        status: policy.status,
        ...(hasPolicyConditions(policy.conditions) ? { conditions: policy.conditions } : {}),
      },
    });

    return policy;
  }

  async updatePolicy(input: UpdatePolicyInput): Promise<Policy> {
    const current = await this.getPolicy(input.organizationId, input.policyId);

    if (current.status === "archived") {
      throw new PolicyValidationError(
        "An archived policy cannot be changed. Create a new one instead.",
      );
    }

    const name =
      input.name === undefined ? current.name : requiredText(input.name, "name");

    const scope =
      input.scope === undefined
        ? current.scope
        : normalizeScope({ ...current.scope, ...input.scope });

    const effect = input.effect ?? current.effect;

    const conditions =
      input.conditions === undefined
        ? normalizeConditions(current.conditions)
        : normalizeConditions(input.conditions);

    this.validate({ name, subject: current.subject, effect, scope, conditions });

    const status = input.status ?? current.status;

    const updated = await this.policyRepository.update({
      ...current,
      name,
      description:
        input.description === undefined
          ? current.description
          : input.description.trim(),
      effect,
      risk: input.risk ?? current.risk,
      status,
      scope,
      conditions,
      approvalPrompt:
        input.approvalPrompt === undefined
          ? current.approvalPrompt
          : (input.approvalPrompt?.trim() || undefined),
      updatedAt: new Date(),
      updatedBy: input.updatedBy ?? current.updatedBy,
    });

    // A lifecycle move is the consequential edit - it is the moment a rule
    // starts or stops constraining real execution - so it gets its own line
    // in the trail rather than being folded into a generic update.
    const lifecycle = lifecycleEvent(current.status, updated.status);

    await this.eventRecorder.record({
      organizationId: updated.organizationId,
      actorType: "user",
      // Who changed a rule is half of what an audit line is for. It used to
      // be left off every update, so the trail said a rule changed and not
      // who changed it.
      actorId: input.updatedBy,
      type: lifecycle ?? "policy.updated",
      payload: {
        policyId: updated.id,
        name: updated.name,
        effect: updated.effect,
        risk: updated.risk,
        status: updated.status,
        previousStatus: current.status,
        ...(hasPolicyConditions(updated.conditions) ? { conditions: updated.conditions } : {}),
        ...(sameConditions(current.conditions, updated.conditions)
          ? {}
          : { previousConditions: normalizeConditions(current.conditions) }),
      },
    });

    return updated;
  }

  /**
   * Refuses configurations that cannot mean anything.
   *
   * Kept here rather than in the route handler so the same rules apply
   * however a policy is written.
   */
  private validate(policy: {
    name: string;
    subject: Policy["subject"];
    effect: Policy["effect"];
    scope: Policy["scope"];
    conditions: PolicyConditions;
  }): void {
    if (policy.name.length > 120) {
      throw new PolicyValidationError("name must be 120 characters or fewer.");
    }

    const unknownTools = policy.scope.toolIds.filter(
      (toolId) => !this.toolRegistry.get(toolId),
    );

    if (unknownTools.length > 0) {
      throw new PolicyValidationError(
        `These tools are not registered: ${unknownTools.join(", ")}.`,
      );
    }

    // A tool rule that requires approval cannot be honoured: by the time a
    // tool call happens the agent is mid-reasoning and there is nothing to
    // suspend. Saying so at authoring time is far better than silently
    // treating it as a denial at three in the morning.
    if (policy.subject === "tool" && policy.effect === "require_approval") {
      throw new PolicyValidationError(
        "A tool policy can only allow or deny. To put a person in front of it, write a task policy instead - approval happens before a step starts, not in the middle of one.",
      );
    }

    const knowledgeTypes = policy.scope.knowledgeTypes ?? [];

    // Each of these would be stored and then never match anything - a rule
    // that looks enforced and is not. The schema refuses them too; this says
    // why in words the author can act on.
    if (isKnowledgeSubject(policy.subject) && policy.scope.toolIds.length > 0) {
      throw new PolicyValidationError(
        "A knowledge policy cannot be narrowed to tools. Narrow it by agent, capability, workspace or kind of knowledge instead.",
      );
    }

    if (!isKnowledgeSubject(policy.subject) && knowledgeTypes.length > 0) {
      throw new PolicyValidationError(
        "Only a knowledge policy can be narrowed to kinds of knowledge.",
      );
    }

    const unknownTypes = knowledgeTypes.filter(
      (type) => !(KNOWLEDGE_TYPES as readonly string[]).includes(type),
    );

    if (unknownTypes.length > 0) {
      throw new PolicyValidationError(
        `These are not kinds of knowledge: ${unknownTypes.join(", ")}.`,
      );
    }

    // Knowledge is recalled and captured outside any one step's tools, and
    // the engine never lets a condition reach it. A conditioned knowledge
    // rule would look enforced and never apply.
    if (isKnowledgeSubject(policy.subject) && hasPolicyConditions(policy.conditions)) {
      throw new PolicyValidationError(
        "A knowledge policy cannot be narrowed to who started the mission or to outside changes. Narrow it by agent, capability, workspace or kind of knowledge instead.",
      );
    }

    if (policy.subject === "knowledge_recall" && policy.effect === "require_approval") {
      throw new PolicyValidationError(
        "A recall policy can only allow or deny - knowledge is recalled as a step starts, with nobody there to ask. To have a person look at knowledge before agents rely on it, write a capture policy that requires approval.",
      );
    }
  }
}

function lifecycleEvent(
  from: PolicyStatus,
  to: PolicyStatus,
): "policy.activated" | "policy.paused" | "policy.archived" | undefined {
  if (from === to) return undefined;
  if (to === "active") return "policy.activated";
  if (to === "paused") return "policy.paused";
  if (to === "archived") return "policy.archived";

  return undefined;
}

function normalizeScope(
  scope: Partial<Policy["scope"]> | undefined,
): Policy["scope"] {
  return {
    agentIds: unique(scope?.agentIds),
    toolIds: unique(scope?.toolIds),
    workspaceIds: unique(scope?.workspaceIds),
    capabilities: unique(scope?.capabilities),
    knowledgeTypes: unique(scope?.knowledgeTypes),
  };
}

/**
 * Only the conditions the engine understands, with anything else dropped, so
 * a stored rule never carries a field that looks like a condition and is not.
 */
function normalizeConditions(conditions: PolicyConditions | undefined): PolicyConditions {
  const normalized: PolicyConditions = {};

  if (conditions?.startedBy === "schedule" || conditions?.startedBy === "person") {
    normalized.startedBy = conditions.startedBy;
  }

  if (typeof conditions?.writesExternally === "boolean") {
    normalized.writesExternally = conditions.writesExternally;
  }

  return normalized;
}

function sameConditions(left: PolicyConditions | undefined, right: PolicyConditions | undefined): boolean {
  const a = normalizeConditions(left);
  const b = normalizeConditions(right);

  return a.startedBy === b.startedBy && a.writesExternally === b.writesExternally;
}

function unique<T>(values: T[] | undefined): T[] {
  return [...new Set(values ?? [])];
}

function requiredText(value: string | undefined, field: string): string {
  const text = value?.trim();

  if (!text) {
    throw new PolicyValidationError(`${field} is required.`);
  }

  return text;
}

function systemName(provider: string): string {
  return provider === "github" ? "GitHub" : provider === "google_drive" ? "Google Drive" : provider;
}

function requiredToolsOf(task: Task): string[] {
  const routing = task.metadata.routing;

  if (typeof routing !== "object" || routing === null) {
    return [];
  }

  const requiredTools = (routing as Record<string, unknown>).requiredTools;

  return Array.isArray(requiredTools)
    ? requiredTools.filter((tool): tool is string => typeof tool === "string")
    : [];
}
