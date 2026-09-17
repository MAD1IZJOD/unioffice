import type {
  OrganizationId,
  Skill,
  SkillId,
} from "@unioffice/core";

import { SkillConflictError, type SkillRepository } from "./skill-repository.js";

/**
 * Skills without a database, holding the migration's lines: one live skill
 * per slug per scope, fixed identity fields, and version-checked updates.
 */
export class InMemorySkillRepository implements SkillRepository {
  readonly skills = new Map<SkillId, Skill>();

  async list(organizationId: OrganizationId): Promise<Skill[]> {
    return [...this.skills.values()]
      .filter((skill) => skill.organizationId === organizationId)
      .sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime())
      .map((skill) => structuredClone(skill));
  }

  async find(organizationId: OrganizationId, skillId: SkillId): Promise<Skill | null> {
    const skill = this.skills.get(skillId);
    return skill && skill.organizationId === organizationId ? structuredClone(skill) : null;
  }

  async create(skill: Skill): Promise<Skill> {
    if (skill.status !== "archived" && this.clashes(skill)) {
      throw new SkillConflictError();
    }

    this.skills.set(skill.id, structuredClone(skill));
    return structuredClone(skill);
  }

  async update(skill: Skill, expectedVersion: number): Promise<Skill | null> {
    const current = this.skills.get(skill.id);

    if (!current || current.organizationId !== skill.organizationId || current.version !== expectedVersion) {
      return null;
    }

    const next: Skill = {
      ...skill,
      organizationId: current.organizationId,
      scope: current.scope,
      workspaceId: current.workspaceId,
      slug: current.slug,
      createdAt: current.createdAt,
      createdBy: current.createdBy,
    };

    if (next.status !== "archived" && this.clashes(next)) {
      throw new SkillConflictError();
    }

    this.skills.set(skill.id, structuredClone(next));
    return structuredClone(next);
  }

  private clashes(skill: Skill): boolean {
    return [...this.skills.values()].some((other) =>
      other.id !== skill.id &&
      other.status !== "archived" &&
      other.organizationId === skill.organizationId &&
      other.workspaceId === skill.workspaceId &&
      other.slug === skill.slug);
  }
}
