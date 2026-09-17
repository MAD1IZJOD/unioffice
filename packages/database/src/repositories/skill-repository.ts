import type {
  OrganizationId,
  Skill,
  SkillId,
} from "@unioffice/core";

/**
 * An organization's own skills - organization-wide and per workspace, of any
 * status. System skills are not stored; they ship with the product.
 *
 * Every lookup is inside one organization: a skill id from another
 * organization reads as absent.
 */

/** Raised when a skill that is not archived already uses the slug in that scope. */
export class SkillConflictError extends Error {
  constructor() {
    super("A skill with this slug already exists here. Archive it or choose another slug.");
    this.name = "SkillConflictError";
  }
}

export interface SkillRepository {
  list(organizationId: OrganizationId): Promise<Skill[]>;

  find(organizationId: OrganizationId, skillId: SkillId): Promise<Skill | null>;

  /** Throws SkillConflictError for a slug already live in the same scope. */
  create(skill: Skill): Promise<Skill>;

  /**
   * Writes content, status and version. Never the organization, scope,
   * workspace or slug, which are fixed when a skill is created. Null when the
   * row changed underneath - the version seen is no longer the current one.
   */
  update(skill: Skill, expectedVersion: number): Promise<Skill | null>;
}
