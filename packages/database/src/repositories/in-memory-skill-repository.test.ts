import assert from "node:assert/strict";
import test from "node:test";

import type { OrganizationId, Skill, SkillId, WorkspaceId } from "@unioffice/core";

import { InMemorySkillRepository } from "./in-memory-skill-repository.js";
import { SkillConflictError } from "./skill-repository.js";

const orgA = "aaaaaaaa-0000-4000-8000-000000000001" as OrganizationId;
const orgB = "bbbbbbbb-0000-4000-8000-000000000002" as OrganizationId;
const finance = "f0000000-0000-4000-8000-00000000000f" as WorkspaceId;
const now = new Date("2026-09-17T12:00:00.000Z");
let counter = 0;

function skill(overrides: Partial<Skill> = {}): Skill {
  counter += 1;
  return {
    id: `00000000-0000-4000-8000-${String(counter).padStart(12, "0")}` as SkillId,
    scope: "organization",
    organizationId: orgA,
    slug: "quarterly-review",
    name: "Quarterly review",
    description: "",
    category: "finance",
    version: 1,
    status: "active",
    instructions: "Compare the quarter to plan.",
    inputs: [],
    outputs: [],
    requiredTools: [],
    requiredCapabilities: [],
    approval: "none",
    memory: "recall",
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

test("a skill is found only inside its own organization", async () => {
  const repository = new InMemorySkillRepository();
  const created = await repository.create(skill());

  assert.equal((await repository.find(orgA, created.id))?.slug, "quarterly-review");
  assert.equal(await repository.find(orgB, created.id), null);
  assert.deepEqual(await repository.list(orgB), []);
});

test("one live skill per slug per scope; archiving frees the slug", async () => {
  const repository = new InMemorySkillRepository();
  const first = await repository.create(skill());

  await assert.rejects(repository.create(skill()), SkillConflictError);
  await repository.create(skill({ scope: "workspace", workspaceId: finance }));
  await repository.create(skill({ organizationId: orgB }));

  await repository.update({ ...first, status: "archived", version: 2 }, 1);
  await repository.create(skill());
});

test("updates are version-checked and cannot move a skill", async () => {
  const repository = new InMemorySkillRepository();
  const created = await repository.create(skill());

  const moved = await repository.update(
    { ...created, version: 2, name: "Renamed", organizationId: orgA, scope: "workspace", workspaceId: finance, slug: "other" },
    1,
  );

  assert.equal(moved?.name, "Renamed");
  assert.equal(moved?.scope, "organization");
  assert.equal(moved?.workspaceId, undefined);
  assert.equal(moved?.slug, "quarterly-review");

  assert.equal(await repository.update({ ...created, version: 3, name: "Stale" }, 1), null, "a stale version loses");
  assert.equal(await repository.update({ ...created, organizationId: orgB, version: 3 }, 2), null, "another organization cannot update it");
});
