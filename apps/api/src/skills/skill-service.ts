import {
  createEntityId,
  SKILL_STATUSES,
  type Agent,
  type OrganizationId,
  type Skill,
  type SkillId,
  type SkillStatus,
  type UserId,
  type Workspace,
  type WorkspaceId,
} from "@unioffice/core";

import {
  SkillConflictError,
  type AgentRepository,
  type SkillRepository,
} from "@unioffice/database";

import {
  resolveSkills,
  skillFit,
  systemSkills,
  validateSkillDraft,
  type SkillDraft,
} from "@unioffice/skills";

import type { ToolRegistry } from "@unioffice/tools";

import { authorize } from "../access/authorize.js";
import { reaches, type Access } from "../access/permissions.js";
import type { EventRecorder } from "../event-recorder.js";

export class SkillNotFoundError extends Error {
  constructor() {
    super("Skill not found.");
    this.name = "SkillNotFoundError";
  }
}

export class SkillValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SkillValidationError";
  }
}

export class SkillStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SkillStateError";
  }
}

/**
 * A skill as people see it: the definition, where it applies, and which
 * agents hold it. Built field by field, never spread from the row.
 */
export interface SkillView {
  id: string;
  scope: Skill["scope"];
  workspace: { id: WorkspaceId; name: string } | null;
  slug: string;
  name: string;
  description: string;
  category: Skill["category"];
  version: number;
  status: SkillStatus;
  instructions: string;
  inputs: Skill["inputs"];
  outputs: Skill["outputs"];
  requiredTools: string[];
  requiredCapabilities: string[];
  approval: Skill["approval"];
  memory: Skill["memory"];
  /** For an organization or workspace skill: the system skill it replaces, if any. */
  overrides: "system" | "organization" | null;
  /** For a system skill: the organization's own version that replaces it company-wide. */
  overriddenBy: { id: string; name: string } | null;
  agents: Array<{ id: string; name: string; fits: boolean; missingTools: string[]; missingCapabilities: string[] }>;
  updatedAt: string;
}

export interface SkillServiceOptions {
  skills: SkillRepository;
  agents: Pick<AgentRepository, "findByOrganization">;
  workspaces: {
    findById(id: WorkspaceId): Promise<Workspace | null>;
    findByOrganization(organizationId: OrganizationId): Promise<Workspace[]>;
  };
  tools: Pick<ToolRegistry, "list">;
  eventRecorder: Pick<EventRecorder, "record">;
  now?: () => Date;
}

const CREATE_FIELDS = ["organizationId", "scope", "workspaceId", "status"] as const;

/**
 * The skills an organization's workforce can use.
 *
 * Everyone who belongs can read the catalogue - what the company knows how to
 * do - narrowed by workspace like everything else. Owners and admins write
 * skills; a workspace skill needs reach into that workspace. Nothing here can
 * give an agent a tool, a capability or a permission: required tools must
 * already exist, and assignment (done on the agent) only succeeds for an
 * agent that already meets every requirement.
 */
export class SkillService {
  private readonly now: () => Date;

  constructor(private readonly options: SkillServiceOptions) {
    this.now = options.now ?? (() => new Date());
  }

  async list(access: Access): Promise<{ skills: SkillView[] }> {
    const [stored, agents, workspaces] = await this.context(access.organizationId);
    const visible = stored.filter((skill) => reaches(access, skill.workspaceId));
    const companyWide = resolveSkills(stored);

    const system = systemSkills().map((skill) => {
      const replacement = companyWide.get(skill.slug);
      return this.view(skill, agents, workspaces, {
        overriddenBy: replacement && replacement.scope !== "system" ? { id: replacement.id, name: replacement.name } : null,
      });
    });

    const own = visible.map((skill) => this.view(skill, agents, workspaces, {
      overrides: this.overrides(skill, stored),
    }));

    return { skills: [...own, ...system] };
  }

  async get(access: Access, reference: string): Promise<SkillView> {
    const [stored, agents, workspaces] = await this.context(access.organizationId);
    const skill = this.find(access, reference, stored);
    const replacement = skill.scope === "system" ? resolveSkills(stored).get(skill.slug) : undefined;

    return this.view(skill, agents, workspaces, {
      overrides: skill.scope === "system" ? null : this.overrides(skill, stored),
      overriddenBy: replacement && replacement.scope !== "system" ? { id: replacement.id, name: replacement.name } : null,
    });
  }

  async create(access: Access, input: unknown): Promise<SkillView> {
    if (typeof input !== "object" || input === null || Array.isArray(input)) {
      throw new SkillValidationError("A skill must be an object.");
    }

    const record = input as Record<string, unknown>;
    const draftFields = Object.fromEntries(
      Object.entries(record).filter(([key]) => !(CREATE_FIELDS as readonly string[]).includes(key)),
    );

    const scope = record.scope ?? "organization";
    if (scope !== "organization" && scope !== "workspace") {
      throw new SkillValidationError("scope must be organization or workspace. System skills ship with the product.");
    }

    const workspaceId = scope === "workspace" ? await this.workspaceFor(access, record.workspaceId) : undefined;
    if (scope === "organization" && record.workspaceId !== undefined && record.workspaceId !== null) {
      throw new SkillValidationError("An organization-wide skill has no workspace.");
    }

    authorize(access, "skills.manage", workspaceId);

    const status = record.status ?? "draft";
    if (status !== "draft" && status !== "active") {
      throw new SkillValidationError("A new skill starts as draft or active.");
    }

    const draft = this.validate(draftFields);
    const now = this.now();

    let created: Skill;

    try {
      created = await this.options.skills.create({
        id: createEntityId<"SkillId">() as SkillId,
        scope,
        organizationId: access.organizationId,
        workspaceId,
        ...draft,
        version: 1,
        status,
        createdBy: access.userId,
        updatedBy: access.userId,
        createdAt: now,
        updatedAt: now,
      });
    } catch (error) {
      if (error instanceof SkillConflictError) throw new SkillStateError(error.message);
      throw error;
    }

    await this.audit(access.userId, created, "skill.created", {});
    return this.get(access, created.id);
  }

  async update(access: Access, skillId: string, input: unknown): Promise<SkillView> {
    const current = await this.stored(access, skillId);
    authorize(access, "skills.manage", current.workspaceId);

    if (typeof input !== "object" || input === null || Array.isArray(input)) {
      throw new SkillValidationError("A skill update must be an object.");
    }

    const { expectedVersion, organizationId: _organizationId, ...changes } = input as Record<string, unknown>;

    if (typeof expectedVersion !== "number" || !Number.isInteger(expectedVersion)) {
      throw new SkillValidationError("expectedVersion is required, so a change never overwrites one you have not seen.");
    }

    if (current.status === "archived") {
      throw new SkillStateError("An archived skill cannot be edited. Restore it first.");
    }

    const draft = this.validate(changes, current);
    return this.save(access, current, { ...draft }, expectedVersion, "skill.updated");
  }

  async setStatus(access: Access, skillId: string, status: unknown, expectedVersion: unknown): Promise<SkillView> {
    const current = await this.stored(access, skillId);
    authorize(access, "skills.manage", current.workspaceId);

    if (!(SKILL_STATUSES as readonly unknown[]).includes(status)) {
      throw new SkillValidationError(`status must be one of ${SKILL_STATUSES.join(", ")}.`);
    }

    if (typeof expectedVersion !== "number" || !Number.isInteger(expectedVersion)) {
      throw new SkillValidationError("expectedVersion is required.");
    }

    if (current.status === status) {
      throw new SkillStateError(`This skill is already ${status}.`);
    }

    const type = status === "archived" ? "skill.archived" : current.status === "archived" ? "skill.restored" : "skill.updated";
    return this.save(access, current, { status: status as SkillStatus }, expectedVersion, type);
  }

  /**
   * The skills that apply to one mission: active ones, narrowest scope first.
   * What execution and planning use - never drafts, never archived.
   */
  async effective(organizationId: OrganizationId, workspaceId?: WorkspaceId): Promise<Map<string, Skill>> {
    return resolveSkills(await this.options.skills.list(organizationId), { workspaceId });
  }

  /**
   * Checks the skills an agent is about to be assigned. Each must resolve to
   * an active skill where the agent works, and the agent must already hold
   * every tool and capability it needs - assignment never makes up the
   * difference.
   */
  async checkAssignment(agent: Agent, slugs: string[]): Promise<void> {
    if (slugs.length > 50) {
      throw new SkillValidationError("An agent can hold at most 50 skills.");
    }

    const effective = await this.effective(agent.organizationId, agent.workspaceId);

    for (const slug of slugs) {
      const skill = effective.get(slug);

      if (!skill) {
        throw new SkillValidationError(`${slug} is not an active skill here.`);
      }

      const fit = skillFit({ ...agent, skills: [slug] }, skill);

      if (!fit.fits) {
        const missing = [
          ...fit.missingTools.map((toolId) => `the ${toolId} tool`),
          ...fit.missingCapabilities.map((capability) => `the ${capability} capability`),
        ];
        throw new SkillValidationError(
          `${agent.name} cannot hold ${skill.name}: it needs ${missing.join(" and ")}, which ${agent.name} does not have.`,
        );
      }
    }
  }

  private async save(
    access: Access,
    current: Skill,
    changes: Partial<SkillDraft> & { status?: SkillStatus },
    expectedVersion: number,
    type: "skill.updated" | "skill.archived" | "skill.restored",
  ): Promise<SkillView> {
    if (expectedVersion !== current.version) {
      throw new SkillStateError("This skill changed since you opened it. Reload it and make your change again.");
    }

    let saved: Skill | null;

    try {
      saved = await this.options.skills.update({
        ...current,
        ...changes,
        version: current.version + 1,
        updatedBy: access.userId,
        updatedAt: this.now(),
      }, expectedVersion);
    } catch (error) {
      if (error instanceof SkillConflictError) throw new SkillStateError(error.message);
      throw error;
    }

    if (!saved) {
      throw new SkillStateError("This skill changed since you opened it. Reload it and make your change again.");
    }

    await this.audit(access.userId, saved, type, { previousVersion: current.version });
    return this.get(access, saved.id);
  }

  private validate(input: Record<string, unknown>, base?: Skill): SkillDraft {
    const knownTools = new Set(this.options.tools.list().map((tool) => tool.id));
    const result = validateSkillDraft(input, { knownTools, partial: base });

    if (!result.valid) {
      throw new SkillValidationError(result.errors.join(" "));
    }

    return result.value;
  }

  private find(access: Access, reference: string, stored: Skill[]): Skill {
    if (reference.startsWith("system:")) {
      const system = systemSkills().find((skill) => skill.id === reference);
      if (system) return system;
      throw new SkillNotFoundError();
    }

    const skill = stored.find((entry) => entry.id === reference);

    if (!skill || !reaches(access, skill.workspaceId)) {
      throw new SkillNotFoundError();
    }

    return skill;
  }

  private async stored(access: Access, skillId: string): Promise<Skill> {
    if (skillId.startsWith("system:")) {
      throw new SkillStateError("System skills ship with the product and cannot be changed. Create an organization skill with the same slug to replace one.");
    }

    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(skillId)) {
      throw new SkillNotFoundError();
    }

    const skill = await this.options.skills.find(access.organizationId, skillId as SkillId);

    if (!skill || !reaches(access, skill.workspaceId)) {
      throw new SkillNotFoundError();
    }

    return skill;
  }

  private async workspaceFor(access: Access, value: unknown): Promise<WorkspaceId> {
    if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
      throw new SkillValidationError("A workspace skill needs a workspaceId.");
    }

    const workspace = await this.options.workspaces.findById(value as WorkspaceId);

    if (!workspace || workspace.organizationId !== access.organizationId || !reaches(access, workspace.id)) {
      throw new SkillNotFoundError();
    }

    if (workspace.status !== "active") {
      throw new SkillStateError("That workspace is archived.");
    }

    return workspace.id;
  }

  private context(organizationId: OrganizationId) {
    return Promise.all([
      this.options.skills.list(organizationId),
      this.options.agents.findByOrganization(organizationId),
      this.options.workspaces.findByOrganization(organizationId),
    ]);
  }

  private overrides(skill: Skill, stored: Skill[]): "system" | "organization" | null {
    if (skill.scope === "workspace" && stored.some((other) => other.scope === "organization" && other.slug === skill.slug && other.status === "active")) {
      return "organization";
    }

    return systemSkills().some((system) => system.slug === skill.slug) ? "system" : null;
  }

  private view(
    skill: Skill,
    agents: Agent[],
    workspaces: Workspace[],
    relation: { overrides?: "system" | "organization" | null; overriddenBy?: { id: string; name: string } | null },
  ): SkillView {
    const workspace = skill.workspaceId ? workspaces.find((entry) => entry.id === skill.workspaceId) : undefined;

    return {
      id: skill.id,
      scope: skill.scope,
      workspace: skill.workspaceId ? { id: skill.workspaceId, name: workspace?.name ?? "Workspace" } : null,
      slug: skill.slug,
      name: skill.name,
      description: skill.description,
      category: skill.category,
      version: skill.version,
      status: skill.status,
      instructions: skill.instructions,
      inputs: skill.inputs,
      outputs: skill.outputs,
      requiredTools: [...skill.requiredTools],
      requiredCapabilities: [...skill.requiredCapabilities],
      approval: skill.approval,
      memory: skill.memory,
      overrides: relation.overrides ?? null,
      overriddenBy: relation.overriddenBy ?? null,
      agents: agents
        .filter((agent) => (agent.skills ?? []).includes(skill.slug))
        .filter((agent) => skill.scope !== "workspace" || !agent.workspaceId || agent.workspaceId === skill.workspaceId)
        .map((agent) => {
          const fit = skillFit(agent, skill);
          return { id: agent.id, name: agent.name, fits: fit.fits, missingTools: fit.missingTools, missingCapabilities: fit.missingCapabilities };
        }),
      updatedAt: skill.updatedAt.toISOString(),
    };
  }

  private async audit(
    userId: UserId,
    skill: Skill,
    type: "skill.created" | "skill.updated" | "skill.archived" | "skill.restored",
    extra: Record<string, unknown>,
  ): Promise<void> {
    // Names and versions only. The instructions are not copied into the log;
    // the skill row is where they live.
    await this.options.eventRecorder.record({
      organizationId: skill.organizationId!,
      type,
      actorType: "user",
      actorId: `user:${userId}`,
      payload: {
        skillId: skill.id,
        slug: skill.slug,
        name: skill.name,
        scope: skill.scope,
        workspaceId: skill.workspaceId ?? null,
        version: skill.version,
        status: skill.status,
        ...extra,
      },
    });
  }
}
