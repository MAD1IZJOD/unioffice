import type { SkillCategory, SkillItem } from "./api";
import type { Tone } from "./tone";

/**
 * How skills are described to people. The data comes from the API; this is
 * only the vocabulary, so every surface that names a skill says the same.
 */

export const CATEGORY_LABEL: Record<SkillCategory, string> = {
  engineering: "Engineering",
  research: "Research",
  finance: "Finance",
  people: "People",
  communication: "Communication",
  operations: "Operations",
};

export const CATEGORY_ORDER: SkillCategory[] = ["engineering", "research", "finance", "people", "communication", "operations"];

/** Where a skill comes from and whether it is in force, in one short label. */
export function skillStanding(skill: Pick<SkillItem, "scope" | "status" | "workspace" | "overriddenBy">): { label: string; tone: Tone } {
  if (skill.status === "archived") return { label: "Archived", tone: "idle" };
  if (skill.status === "draft") return { label: "Draft", tone: "idle" };
  if (skill.scope === "system" && skill.overriddenBy) return { label: "Replaced", tone: "idle" };
  if (skill.scope === "system") return { label: "System", tone: "active" };
  if (skill.scope === "workspace") return { label: skill.workspace ? skill.workspace.name : "Workspace", tone: "live" };
  return { label: "Company", tone: "live" };
}

/** The route for a skill; system skills are addressed as system:<slug>. */
export function skillPath(skill: Pick<SkillItem, "id">): string {
  return `/skills/${encodeURIComponent(skill.id)}`;
}

/** Search across what a person would type to find a skill. */
export function matchesSkill(skill: SkillItem, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;

  return [skill.name, skill.slug, skill.description, ...skill.requiredTools, ...skill.requiredCapabilities]
    .some((value) => value.toLowerCase().includes(needle));
}
