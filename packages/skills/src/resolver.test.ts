import assert from "node:assert/strict";
import test from "node:test";

import type { Agent, AgentId, OrganizationId, Skill, SkillId, WorkspaceId } from "@unioffice/core";

import { resolveSkill, type SkillCandidateAgent, type SkillRequirement } from "./resolver.js";

const org = "aaaaaaaa-0000-4000-8000-000000000001" as OrganizationId;
const finance = "f0000000-0000-4000-8000-00000000000f" as WorkspaceId;
const now = new Date("2026-09-18T12:00:00.000Z");

function skill(overrides: Partial<Skill> = {}): Skill {
  return {
    id: "c0000000-0000-4000-8000-000000000001" as SkillId,
    scope: "system",
    organizationId: org,
    slug: "financial-analysis",
    name: "Financial analysis",
    description: "Read figures and say what they mean for the business.",
    category: "finance",
    version: 1,
    status: "active",
    instructions: "Work through the numbers.",
    inputs: [],
    outputs: [],
    requiredTools: ["calculator"],
    requiredCapabilities: ["financial_analysis"],
    approval: "none",
    memory: "recall",
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function agent(overrides: Partial<SkillCandidateAgent> = {}): SkillCandidateAgent {
  return {
    id: "d0000000-0000-4000-8000-000000000001" as AgentId,
    name: "Ledger",
    capabilities: ["financial_analysis", "calculation"] as Agent["capabilities"],
    toolIds: ["calculator"],
    skills: ["financial-analysis"],
    ...overrides,
  };
}

function requirement(overrides: Partial<SkillRequirement> = {}): SkillRequirement {
  return { text: "Analyse Q3 expenses", capabilities: [], tools: [], ...overrides };
}

test("a step's own words choose the skill, with reasons anyone can read", () => {
  const resolution = resolveSkill({
    requirement: requirement({ text: "Analyse the Q3 expenses and produce the financial analysis" }),
    skills: [skill()],
    agents: [agent()],
  });

  assert.equal(resolution.outcome, "selected");
  assert.equal(resolution.outcome === "selected" && resolution.match.skill.slug, "financial-analysis");
  assert.ok(resolution.outcome === "selected" && resolution.match.reasons.some((reason) => reason.includes("financial")));
  assert.ok(resolution.outcome === "selected" && resolution.match.reasons.some((reason) => reason.includes("Ledger holds it")));
});

test("the same inputs always give the same answer, whatever order the skills arrive in", () => {
  const skills = [
    skill(),
    skill({ id: "c2" as SkillId, slug: "expense-review", name: "Expense review", category: "finance" }),
    skill({ id: "c3" as SkillId, slug: "budget-plan", name: "Budget plan", category: "finance" }),
  ];
  const agents = [agent({ skills: ["financial-analysis", "expense-review", "budget-plan"] })];
  const req = requirement({ text: "Analyse the Q3 expenses and produce the financial analysis" });

  const forwards = resolveSkill({ requirement: req, skills, agents });
  const backwards = resolveSkill({ requirement: req, skills: [...skills].reverse(), agents });

  assert.equal(forwards.outcome, "selected");
  assert.deepEqual(
    forwards.outcome === "selected" && forwards.match.skill.slug,
    backwards.outcome === "selected" && backwards.match.skill.slug,
  );
});

test("the planner's suggestion is a signal, not a decision", () => {
  const suggested = skill({ id: "c2" as SkillId, slug: "budget-plan", name: "Budget plan", description: "Plan next year." });

  const resolution = resolveSkill({
    requirement: requirement({ text: "Plan next year's budget", suggestedSlug: "budget-plan" }),
    skills: [skill(), suggested],
    agents: [agent({ skills: ["financial-analysis", "budget-plan"] })],
  });

  assert.equal(resolution.outcome === "selected" && resolution.match.skill.slug, "budget-plan");
  assert.ok(resolution.outcome === "selected" && resolution.match.reasons.includes("the planner suggested it"));
});

test("a suggestion the server cannot use is ignored rather than followed", () => {
  const resolution = resolveSkill({
    requirement: requirement({ text: "Write the financial analysis of Q3 expenses", suggestedSlug: "made-up-skill" }),
    skills: [skill()],
    agents: [agent()],
  });

  assert.equal(resolution.outcome === "selected" && resolution.match.skill.slug, "financial-analysis");
});

test("a skill nobody can run is not selected, and the reason says who is short of what", () => {
  const resolution = resolveSkill({
    requirement: requirement({ text: "Write the financial analysis of Q3 expenses", requestedSlug: "financial-analysis" }),
    skills: [skill()],
    agents: [agent({ toolIds: [] })],
  });

  assert.equal(resolution.outcome, "none");
  assert.match(resolution.outcome === "none" ? resolution.reason : "", /Ledger is missing calculator/);
});

test("a skill no available agent holds is not selected", () => {
  const resolution = resolveSkill({
    requirement: requirement({ requestedSlug: "financial-analysis" }),
    skills: [skill()],
    agents: [agent({ skills: [] })],
  });

  assert.equal(resolution.outcome, "none");
  assert.match(resolution.outcome === "none" ? resolution.reason : "", /no agent available to this mission holds it/);
});

test("asking for a skill by name beats everything the step happens to mention", () => {
  const other = skill({ id: "c2" as SkillId, slug: "expense-review", name: "Expense review", description: "Go through expenses." });

  const resolution = resolveSkill({
    requirement: requirement({ text: "Go through the expenses for Q3", requestedSlug: "financial-analysis" }),
    skills: [skill(), other],
    agents: [agent({ skills: ["financial-analysis", "expense-review"] })],
  });

  assert.equal(resolution.outcome === "selected" && resolution.match.skill.slug, "financial-analysis");
  assert.ok(resolution.outcome === "selected" && resolution.match.reasons.includes("it was asked for by name"));
});

test("a workspace's own version of a skill wins over the system one", () => {
  const theirs = skill({
    id: "c2" as SkillId,
    scope: "workspace",
    workspaceId: finance,
    name: "Financial analysis",
    version: 3,
  });

  const resolution = resolveSkill({
    requirement: requirement({ text: "Financial analysis of Q3" }),
    skills: [skill(), theirs],
    agents: [agent()],
  });

  assert.equal(resolution.outcome === "selected" && resolution.match.skill.scope, "workspace");
  assert.ok(resolution.outcome === "selected" && resolution.match.reasons.includes("it is this workspace's own version of the skill"));
});

test("a passing mention is not enough to put a step on a procedure", () => {
  const resolution = resolveSkill({
    requirement: requirement({ text: "Send the finance team a reminder about the offsite" }),
    skills: [skill()],
    agents: [agent()],
  });

  assert.equal(resolution.outcome, "none");
  assert.match(resolution.outcome === "none" ? resolution.reason : "", /closely enough/);
});

test("two skills that match equally well are put back to the person", () => {
  const twin = skill({ id: "c2" as SkillId, slug: "money-analysis", name: "Financial analysis review" });

  const resolution = resolveSkill({
    requirement: requirement({ text: "Q3 analysis", capabilities: ["financial_analysis"], tools: ["calculator"] }),
    skills: [skill(), twin],
    agents: [agent({ skills: ["financial-analysis", "money-analysis"] })],
  });

  assert.equal(resolution.outcome, "ambiguous");
  assert.match(resolution.outcome === "ambiguous" ? resolution.reason : "", /Name one in the request/);
});

test("what the step says it needs counts for more than the words it uses", () => {
  const wordy = skill({
    id: "c2" as SkillId,
    slug: "expense-analysis",
    name: "Expense analysis report",
    requiredTools: [],
    requiredCapabilities: [],
  });

  const resolution = resolveSkill({
    requirement: requirement({
      text: "Expense analysis report",
      capabilities: ["financial_analysis"],
      tools: ["calculator"],
    }),
    skills: [skill(), wordy],
    agents: [agent({ skills: ["financial-analysis", "expense-analysis"] })],
  });

  assert.equal(resolution.outcome === "selected" && resolution.match.skill.slug, "financial-analysis");
});

test("nothing is selected when the organization has no skills here", () => {
  const resolution = resolveSkill({ requirement: requirement(), skills: [], agents: [agent()] });

  assert.equal(resolution.outcome, "none");
  assert.match(resolution.outcome === "none" ? resolution.reason : "", /No skill applies/);
});
