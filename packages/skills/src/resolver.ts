import type { Agent, Skill } from "@unioffice/core";

import { skillFit } from "./skills.js";

/**
 * Which skill a step should follow, decided by the server.
 *
 * The planner may suggest a skill and a person may ask for one by name, but
 * neither decides: both are signals into a deterministic ranking the server
 * performs over the skills that actually apply here. The same inputs always
 * give the same answer, and the answer carries the reasons it was reached, so
 * a selection can be explained to whoever reads the mission.
 *
 * Nothing here can invent a skill, a scope, a tool grant or a capability. It
 * only ranks skills it was handed - already narrowed to the organization and
 * workspace - against agents as they actually are.
 */

export interface SkillRequirement {
  /** The step's own words: title, description, and the mission's objective. */
  text: string;

  /** Capabilities the step says it needs. */
  capabilities: string[];

  /** Tools the step says it needs. */
  tools: string[];

  /** A skill named explicitly by a person. Decisive, if it can be used. */
  requestedSlug?: string;

  /** A skill the planner suggested. A strong hint, not a decision. */
  suggestedSlug?: string;
}

export type SkillCandidateAgent = Pick<Agent, "id" | "name" | "capabilities" | "toolIds" | "skills">;

export interface SkillMatch {
  skill: Skill;
  score: number;
  /** Why this skill ranked where it did, in a person's words. */
  reasons: string[];
  /** Agents that hold it and meet everything it needs. */
  agents: Array<{ id: string; name: string }>;
}

export type SkillResolution =
  | { outcome: "selected"; match: SkillMatch; alternatives: SkillMatch[] }
  /** Nothing was chosen. `reason` says why, for the mission's record. */
  | { outcome: "none"; reason: string; alternatives: SkillMatch[] }
  /** Several fit equally well and nothing distinguishes them. */
  | { outcome: "ambiguous"; reason: string; alternatives: SkillMatch[] };

const SCORE = {
  requested: 1_000,
  suggested: 200,
  capability: 40,
  tool: 40,
  nameWord: 25,
  category: 15,
  descriptionWord: 5,
} as const;

/**
 * How much evidence an unprompted match needs before the server picks it.
 *
 * Forty is one thing the step said it needs, or two words of the skill's own
 * name, or one of those words with the category or the description behind it.
 * A single stray word is never enough to put a step on a procedure.
 */
const MIN_UNPROMPTED_SCORE = 40;

const MAX_DESCRIPTION_POINTS = 20;

/** Words too common to mean anything when they match. */
const STOP_WORDS = new Set([
  "about", "after", "again", "against", "and", "any", "are", "because", "been", "before",
  "being", "between", "both", "but", "can", "does", "each", "for", "from", "have", "how", "into",
  "its", "more", "most", "not", "off", "once", "only", "other", "our", "out", "over", "own", "same",
  "should", "some", "such", "than", "that", "the", "their", "them", "then", "there", "these", "they",
  "this", "those", "through", "under", "until", "very", "was", "were", "what", "when", "where",
  "which", "while", "who", "why", "will", "with", "your", "step", "task", "work", "please", "using",
  "use", "used", "make", "made", "give", "given", "need", "needs", "want", "wants",
]);

const SCOPE_RANK = { workspace: 3, organization: 2, system: 1 } as const;

export function resolveSkill(input: {
  requirement: SkillRequirement;
  /** Skills that apply here already: active, in scope, narrowest first. */
  skills: Skill[];
  /** The agents this step could be given to. */
  agents: SkillCandidateAgent[];
}): SkillResolution {
  const words = significantWords(input.requirement.text);
  const capabilities = new Set(input.requirement.capabilities.map(normalize));
  const tools = new Set(input.requirement.tools);

  const matches: SkillMatch[] = [];
  const unusable = new Map<string, string>();

  for (const skill of input.skills) {
    const ready = input.agents
      .filter((agent) => skillFit(agent, skill).fits)
      .map((agent) => ({ id: agent.id, name: agent.name }));

    if (ready.length === 0) {
      unusable.set(skill.slug, whyUnusable(skill, input.agents));
      continue;
    }

    const reasons: string[] = [];
    let score = 0;

    if (input.requirement.requestedSlug === skill.slug) {
      score += SCORE.requested;
      reasons.push("it was asked for by name");
    }

    if (input.requirement.suggestedSlug === skill.slug) {
      score += SCORE.suggested;
      reasons.push("the planner suggested it");
    }

    const matchedCapabilities = skill.requiredCapabilities.filter((capability) => capabilities.has(normalize(capability)));
    if (matchedCapabilities.length > 0) {
      score += SCORE.capability * matchedCapabilities.length;
      reasons.push(`the step needs ${matchedCapabilities.join(", ")}, which it uses`);
    }

    const matchedTools = skill.requiredTools.filter((tool) => tools.has(tool));
    if (matchedTools.length > 0) {
      score += SCORE.tool * matchedTools.length;
      reasons.push(`the step needs ${matchedTools.join(", ")}, which it uses`);
    }

    const nameWords = [...new Set([...significantWords(skill.name), ...significantWords(skill.slug)])];
    const matchedName = nameWords.filter((word) => words.has(word));
    if (matchedName.length > 0) {
      score += SCORE.nameWord * matchedName.length;
      reasons.push(`the step mentions ${matchedName.join(", ")}`);
    }

    if (words.has(singular(normalize(skill.category)))) {
      score += SCORE.category;
      reasons.push(`the step is ${skill.category} work`);
    }

    const matchedDescription = [...significantWords(skill.description)].filter(
      (word) => words.has(word) && !matchedName.includes(word),
    );
    if (matchedDescription.length > 0) {
      score += Math.min(SCORE.descriptionWord * matchedDescription.length, MAX_DESCRIPTION_POINTS);
      reasons.push(`what it is for matches the step (${matchedDescription.slice(0, 4).join(", ")})`);
    }

    if (score === 0) continue;

    reasons.push(ready.length === 1
      ? `${ready[0]!.name} holds it with everything it needs`
      : `${ready.length} agents hold it with everything they need`);
    reasons.push(scopeReason(skill));

    matches.push({ skill, score, reasons, agents: ready });
  }

  matches.sort(compare);

  const requested = input.requirement.requestedSlug;

  if (requested && !matches.some((match) => match.skill.slug === requested)) {
    return {
      outcome: "none",
      reason: unusable.get(requested)
        ?? `${requested} is not an active skill here, so the step runs without one.`,
      alternatives: matches.slice(0, 3),
    };
  }

  const best = matches[0];

  if (!best) {
    return {
      outcome: "none",
      reason: input.skills.length === 0
        ? "No skill applies to this organization here."
        : "No skill matches what this step asks for.",
      alternatives: [],
    };
  }

  const prompted = best.score >= SCORE.suggested;

  if (!prompted && best.score < MIN_UNPROMPTED_SCORE) {
    return {
      outcome: "none",
      reason: `Nothing matched this step closely enough to choose a skill for it (closest: ${best.skill.name}).`,
      alternatives: matches.slice(0, 3),
    };
  }

  const runnerUp = matches[1];

  if (!prompted && runnerUp && runnerUp.score === best.score && SCOPE_RANK[runnerUp.skill.scope] === SCOPE_RANK[best.skill.scope]) {
    return {
      outcome: "ambiguous",
      reason: `${best.skill.name} and ${runnerUp.skill.name} match this step equally well. Name one in the request to use it.`,
      alternatives: matches.slice(0, 3),
    };
  }

  return { outcome: "selected", match: best, alternatives: matches.slice(1, 3) };
}

/** The sentence a mission's record carries about why nothing could use a skill. */
function whyUnusable(skill: Skill, agents: SkillCandidateAgent[]): string {
  const assigned = agents.filter((agent) => (agent.skills ?? []).includes(skill.slug));

  if (assigned.length === 0) {
    return `${skill.name} is active, but no agent available to this mission holds it.`;
  }

  const shortfalls = assigned.map((agent) => {
    const fit = skillFit(agent, skill);
    return `${agent.name} is missing ${[...fit.missingTools, ...fit.missingCapabilities].join(" and ")}`;
  });

  return `${skill.name} cannot be used here: ${shortfalls.join("; ")}.`;
}

function scopeReason(skill: Skill): string {
  switch (skill.scope) {
    case "workspace":
      return "it is this workspace's own version of the skill";
    case "organization":
      return "it is the company's own version of the skill";
    default:
      return "it is active and applies here";
  }
}

/**
 * Highest score first; then the narrowest scope, because an organization
 * wrote its own version of a skill in order to use it; then the skill that
 * asks for more, which is the more specific one; then the slug, so the order
 * never depends on how the rows arrived.
 */
function compare(left: SkillMatch, right: SkillMatch): number {
  return right.score - left.score ||
    SCOPE_RANK[right.skill.scope] - SCOPE_RANK[left.skill.scope] ||
    (right.skill.requiredTools.length + right.skill.requiredCapabilities.length) -
      (left.skill.requiredTools.length + left.skill.requiredCapabilities.length) ||
    left.skill.slug.localeCompare(right.skill.slug);
}

function significantWords(text: string): Set<string> {
  return new Set(
    normalize(text)
      .split(/[^a-z0-9]+/)
      .filter((word) => word.length >= 4 && !STOP_WORDS.has(word))
      .map(singular),
  );
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/_/g, " ");
}

/** Crude but predictable: "expenses" and "expense" are the same word here. */
function singular(word: string): string {
  return word.length > 4 && word.endsWith("s") && !word.endsWith("ss") ? word.slice(0, -1) : word;
}
