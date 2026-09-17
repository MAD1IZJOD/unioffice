import type {
  OrganizationId,
  Skill,
  SkillRef,
} from "@unioffice/core";

/**
 * Immutable snapshots of skill versions.
 *
 * A step records which skill and which version it uses; this is where that
 * version's definition is kept, unchanged, for as long as the organization
 * exists. Nothing here updates: recording a version that is already stored
 * keeps the stored one, so a snapshot can be written from any number of
 * places without racing.
 */
export interface SkillVersionRepository {
  /**
   * Stores this version if it is not stored yet. Returns the version that is
   * now on record, which is the existing one when there already was one.
   */
  record(organizationId: OrganizationId, skill: Skill): Promise<Skill>;

  /** The exact version, or null when it was never recorded. */
  find(organizationId: OrganizationId, ref: SkillRef, version: number): Promise<Skill | null>;

  /** Every recorded version of one skill, newest first. */
  history(organizationId: OrganizationId, ref: SkillRef): Promise<Skill[]>;
}
