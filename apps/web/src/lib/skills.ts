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

/**
 * Whether the company can actually use a skill right now, and why not.
 *
 * A skill is only real when an agent holds it and already has everything it
 * needs. "Held by Ledger" is not the same as "Ledger can run it", and the
 * difference is the whole point of the catalogue, so it is said plainly
 * rather than left to be worked out from a list of tools.
 */
export function skillReadiness(skill: Pick<SkillItem, "status" | "agents" | "overriddenBy">): {
  ready: boolean;
  line: string;
  tone: Tone;
} {
  if (skill.status !== "active") {
    return { ready: false, line: "Not in force, so no step can use it", tone: "idle" };
  }

  if (skill.overriddenBy) {
    return { ready: false, line: `Replaced by ${skill.overriddenBy.name}`, tone: "idle" };
  }

  const ready = skill.agents.filter((agent) => agent.fits);

  if (ready.length > 0) {
    return {
      ready: true,
      line: ready.length === 1 ? `${ready[0]!.name} can run it` : `${ready.length} agents can run it`,
      tone: "live",
    };
  }

  if (skill.agents.length === 0) {
    return { ready: false, line: "No agent holds it", tone: "warning" };
  }

  const short = skill.agents[0]!;
  const missing = [...short.missingTools, ...short.missingCapabilities.map((entry) => entry.replace(/_/g, " "))];

  return {
    ready: false,
    line: `${short.name} holds it but is missing ${missing.join(" and ")}`,
    tone: "warning",
  };
}
