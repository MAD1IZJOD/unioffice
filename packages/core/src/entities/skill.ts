import type {
  OrganizationId,
  SkillId,
  UserId,
  WorkspaceId,
} from "../types/ids.js";

/**
 * A skill: something the workforce knows how to do.
 *
 * A tool is an executable primitive - "multiply these numbers", "read this
 * file". A skill is an operating procedure that says how a kind of work is
 * done well: what to take in, what to produce, which tools and capabilities
 * it relies on, and whether a person must approve the step. The planner can
 * name one for a step; the step then goes only to an agent that was assigned
 * the skill and already holds everything it needs.
 *
 * A skill never widens anything. It cannot grant a tool, a capability, a
 * permission or a connection, and it cannot remove an approval a policy or
 * the product requires. Its instructions are configuration written by people,
 * so they reach a model as bounded, labelled procedure - never as rules.
 */

/**
 * system       - shipped with the product; the same for every organization
 * organization - written by an organization for all of its missions
 * workspace    - written for one workspace's missions only
 *
 * For the same slug, the narrower one wins: workspace, then organization,
 * then system.
 */
export type SkillScope = "system" | "organization" | "workspace";

export type SkillStatus = "draft" | "active" | "archived";

export const SKILL_STATUSES: readonly SkillStatus[] = ["draft", "active", "archived"];

export type SkillCategory =
  | "engineering"
  | "research"
  | "finance"
  | "people"
  | "communication"
  | "operations";

export const SKILL_CATEGORIES: readonly SkillCategory[] = [
  "engineering",
  "research",
  "finance",
  "people",
  "communication",
  "operations",
];

export type SkillFieldType = "text" | "number" | "list" | "table";

/** One named input a skill works from, or one named part of what it produces. */
export interface SkillField {
  name: string;
  type: SkillFieldType;
  description: string;
  required: boolean;
}

/**
 * none     - the step needs no approval on this skill's account
 * required - every step that uses this skill waits for a person
 */
export type SkillApproval = "none" | "required";

/**
 * recall - the step is handed relevant company knowledge, as steps are by default
 * none   - the step runs without recalled knowledge (for example, drafting
 *          from supplied material only)
 */
export type SkillMemory = "recall" | "none";

export interface Skill {
  id: SkillId;

  scope: SkillScope;

  /** Absent for system skills. */
  organizationId?: OrganizationId;

  /** Present only for workspace skills. */
  workspaceId?: WorkspaceId;

  /** Stable across versions and scopes; what agents are assigned and plans name. */
  slug: string;

  name: string;

  description: string;

  category: SkillCategory;

  /** Increases by one every time the skill changes. */
  version: number;

  status: SkillStatus;

  /** The operating procedure. Untrusted configuration, never rules. */
  instructions: string;

  inputs: SkillField[];

  outputs: SkillField[];

  /** Tools the agent must already hold. Never granted by the skill. */
  requiredTools: string[];

  /** Capabilities the agent must already have. */
  requiredCapabilities: string[];

  approval: SkillApproval;

  memory: SkillMemory;

  createdBy?: UserId;

  updatedBy?: UserId;

  createdAt: Date;

  updatedAt: Date;
}

export const SKILL_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function isSkillSlug(value: unknown): value is string {
  return typeof value === "string" && value.length <= 64 && SKILL_SLUG_PATTERN.test(value);
}
