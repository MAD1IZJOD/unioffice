import assert from "node:assert/strict";
import test from "node:test";

import type { OrganizationId, Skill, SkillId } from "@unioffice/core";

import { InMemorySkillVersionRepository } from "./in-memory-skill-version-repository.js";

const orgA = "aaaaaaaa-0000-4000-8000-000000000001" as OrganizationId;
const orgB = "bbbbbbbb-0000-4000-8000-000000000002" as OrganizationId;
const now = new Date("2026-09-18T12:00:00.000Z");

function skill(overrides: Partial<Skill> = {}): Skill {
  return {
    id: "c0000000-0000-4000-8000-000000000001" as SkillId,
    scope: "organization",
    organizationId: orgA,
    slug: "expense-review",
    name: "Expense review",
    description: "",
    category: "finance",
    version: 1,
    status: "active",
    instructions: "Version one.",
    inputs: [],
    outputs: [],
    requiredTools: ["calculator"],
    requiredCapabilities: [],
    approval: "none",
    memory: "recall",
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

test("a recorded version is kept exactly, and recording it again changes nothing", async () => {
  const versions = new InMemorySkillVersionRepository();

  await versions.record(orgA, skill());
  const again = await versions.record(orgA, skill({ instructions: "Rewritten after the fact." }));

  assert.equal(again.instructions, "Version one.");
  assert.equal((await versions.find(orgA, "c0000000-0000-4000-8000-000000000001", 1))?.instructions, "Version one.");
});

test("versions are separate records, and another organization's are not visible", async () => {
  const versions = new InMemorySkillVersionRepository();

  await versions.record(orgA, skill());
  await versions.record(orgA, skill({ version: 2, instructions: "Version two." }));
  await versions.record(orgB, skill({ organizationId: orgB, version: 1, instructions: "Theirs." }));

  assert.equal((await versions.find(orgA, "c0000000-0000-4000-8000-000000000001", 1))?.instructions, "Version one.");
  assert.equal((await versions.find(orgA, "c0000000-0000-4000-8000-000000000001", 2))?.instructions, "Version two.");
  assert.equal(await versions.find(orgA, "c0000000-0000-4000-8000-000000000001", 3), null);

  assert.deepEqual((await versions.history(orgA, "c0000000-0000-4000-8000-000000000001")).map((entry) => entry.version), [2, 1]);
  assert.equal((await versions.find(orgB, "c0000000-0000-4000-8000-000000000001", 1))?.instructions, "Theirs.");
});

test("a system skill is recorded under its system reference", async () => {
  const versions = new InMemorySkillVersionRepository();

  await versions.record(orgA, skill({ id: "system:financial-analysis" as SkillId, scope: "system", slug: "financial-analysis" }));

  assert.equal((await versions.find(orgA, "system:financial-analysis", 1))?.slug, "financial-analysis");
  assert.equal(await versions.find(orgA, "c0000000-0000-4000-8000-000000000001", 1), null);
});
