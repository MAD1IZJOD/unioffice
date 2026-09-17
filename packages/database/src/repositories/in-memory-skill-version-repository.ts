import { skillRefOf, type OrganizationId, type Skill, type SkillRef } from "@unioffice/core";

import type { SkillVersionRepository } from "./skill-version-repository.js";

/** Skill versions without a database, with the same write-once behaviour. */
export class InMemorySkillVersionRepository implements SkillVersionRepository {
  readonly versions = new Map<string, Skill>();

  private key(organizationId: OrganizationId, ref: SkillRef, version: number): string {
    return `${organizationId}:${ref}:${version}`;
  }

  async record(organizationId: OrganizationId, skill: Skill): Promise<Skill> {
    const key = this.key(organizationId, skillRefOf(skill), skill.version);
    const existing = this.versions.get(key);

    if (existing) {
      return structuredClone(existing);
    }

    const stored = structuredClone({ ...skill, organizationId });
    this.versions.set(key, stored);
    return structuredClone(stored);
  }

  async find(organizationId: OrganizationId, ref: SkillRef, version: number): Promise<Skill | null> {
    const stored = this.versions.get(this.key(organizationId, ref, version));
    return stored ? structuredClone(stored) : null;
  }

  async history(organizationId: OrganizationId, ref: SkillRef): Promise<Skill[]> {
    return [...this.versions.entries()]
      .filter(([key]) => key.startsWith(`${organizationId}:${ref}:`))
      .map(([, skill]) => structuredClone(skill))
      .sort((left, right) => right.version - left.version);
  }
}
