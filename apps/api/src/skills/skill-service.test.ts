import assert from "node:assert/strict";
import test from "node:test";

import type {
  Agent,
  AgentId,
  MemberId,
  OrganizationId,
  OrganizationRole,
  UserId,
  Workspace,
  WorkspaceAccessLevel,
  WorkspaceId,
} from "@unioffice/core";

import { InMemorySkillRepository } from "@unioffice/database";
import { createDefaultToolRegistry } from "@unioffice/tools";

import { AccessError } from "../access/access-resolver.js";
import type { Access } from "../access/permissions.js";
import type { RecordEventInput } from "../event-recorder.js";

import {
  SkillNotFoundError,
  SkillService,
  SkillStateError,
  SkillValidationError,
} from "./skill-service.js";

const orgA = "aaaaaaaa-0000-4000-8000-000000000001" as OrganizationId;
const orgB = "bbbbbbbb-0000-4000-8000-000000000002" as OrganizationId;
const finance = "f0000000-0000-4000-8000-00000000000f" as WorkspaceId;
const legal = "f0000000-0000-4000-8000-0000000000aa" as WorkspaceId;
const now = new Date("2026-09-17T12:00:00.000Z");

function agent(name: string, overrides: Partial<Agent> = {}): Agent {
  return {
    id: `agent-${name}` as AgentId,
    organizationId: orgA,
    name,
    description: "",
    type: "specialist",
    status: "active",
    capabilities: ["financial_analysis"],
    toolIds: ["calculator"],
    skills: [],
    createdAt: now,
    updatedAt: now,
    metadata: {},
    ...overrides,
  };
}

function person(role: OrganizationRole, organizationId = orgA, grants: Array<[WorkspaceId, WorkspaceAccessLevel]> = []): Access {
  return {
    userId: `11111111-0000-4000-8000-00000000000${role.length}` as UserId,
    email: `${role}@example.test`,
    organizationId,
    memberId: "m" as MemberId,
    role,
    workspaces: new Map(grants),
  };
}

function setup(agents: Agent[] = [agent("Ledger")]) {
  const repository = new InMemorySkillRepository();
  const events: RecordEventInput[] = [];
  const workspaces: Workspace[] = [
    { id: finance, organizationId: orgA, name: "Finance", slug: "finance", status: "active", createdAt: now, updatedAt: now, metadata: {} },
    { id: legal, organizationId: orgA, name: "Legal", slug: "legal", status: "active", createdAt: now, updatedAt: now, metadata: {} },
  ];

  const service = new SkillService({
    skills: repository,
    agents: { async findByOrganization(organizationId) { return agents.filter((entry) => entry.organizationId === organizationId); } },
    workspaces: {
      async findById(id) { return workspaces.find((entry) => entry.id === id) ?? null; },
      async findByOrganization(organizationId) { return workspaces.filter((entry) => entry.organizationId === organizationId); },
    },
    tools: createDefaultToolRegistry(),
    eventRecorder: { async record(event) { events.push(structuredClone(event)); return event as never; } },
    now: () => now,
  });

  return { service, repository, events };
}

const draft = {
  slug: "q3-expense-review",
  name: "Q3 expense review",
  description: "Find unusual spending.",
  category: "finance",
  instructions: "Compare each line to the prior quarter using the calculator.",
  inputs: [{ name: "expenses", type: "table", description: "Expense lines.", required: true }],
  outputs: [{ name: "unusual", type: "list", description: "Unusual lines.", required: true }],
  requiredTools: ["calculator"],
  requiredCapabilities: ["financial_analysis"],
  approval: "none",
  memory: "recall",
};

test("everyone in the organization reads the catalogue, system skills included", async () => {
  const { service } = setup();
  const { skills } = await service.list(person("viewer"));

  assert.ok(skills.some((skill) => skill.id === "system:financial-analysis" && skill.scope === "system"));
  assert.equal((await service.get(person("viewer"), "system:code-review")).name, "Code review");
  await assert.rejects(service.get(person("viewer"), "system:not-a-skill"), SkillNotFoundError);
});

test("only owners and admins write skills, and only where they reach", async () => {
  const { service } = setup();

  await assert.rejects(service.create(person("member"), draft), AccessError);
  await assert.rejects(service.create(person("viewer"), draft), AccessError);

  const created = await service.create(person("admin"), { ...draft, status: "active" });
  assert.equal(created.scope, "organization");
  assert.equal(created.version, 1);

  const member = person("member", orgA, [[finance, "member"]]);
  await assert.rejects(service.create(member, { ...draft, slug: "x", scope: "workspace", workspaceId: finance }), AccessError);
});

test("a skill cannot be created with a scope, version or organization it chose for itself", async () => {
  const { service } = setup();
  const owner = person("owner");

  await assert.rejects(service.create(owner, { ...draft, scope: "system" }), SkillValidationError);
  await assert.rejects(service.create(owner, { ...draft, version: 7 }), SkillValidationError);
  await assert.rejects(service.create(owner, { ...draft, status: "archived" }), SkillValidationError);
  await assert.rejects(service.create(owner, { ...draft, createdBy: "someone" }), SkillValidationError);
  await assert.rejects(service.create(owner, { ...draft, requiredTools: ["wire_money"] }), SkillValidationError);

  // organizationId in the body is the request's routing, never the skill's owner.
  const created = await service.create(owner, { ...draft, organizationId: orgB });
  assert.equal((await service.list(person("owner", orgB))).skills.some((skill) => skill.id === created.id), false);
});

test("another organization's skill reads as not found and cannot be changed", async () => {
  const { service } = setup();
  const created = await service.create(person("owner"), draft);
  const outsider = person("owner", orgB);

  await assert.rejects(service.get(outsider, created.id), SkillNotFoundError);
  await assert.rejects(service.update(outsider, created.id, { name: "Stolen", expectedVersion: 1 }), SkillNotFoundError);
  await assert.rejects(service.setStatus(outsider, created.id, "archived", 1), SkillNotFoundError);
});

test("a workspace skill is invisible without that workspace", async () => {
  const { service } = setup();
  const created = await service.create(person("owner"), { ...draft, scope: "workspace", workspaceId: finance });

  assert.equal((await service.get(person("member", orgA, [[finance, "viewer"]]), created.id)).workspace?.name, "Finance");
  await assert.rejects(service.get(person("member", orgA, [[legal, "member"]]), created.id), SkillNotFoundError);
  assert.equal((await service.list(person("member"))).skills.some((skill) => skill.id === created.id), false);
});

test("changes are versioned, need the version seen, and never touch system skills", async () => {
  const { service, events } = setup();
  const owner = person("owner");
  const created = await service.create(owner, draft);

  await assert.rejects(service.update(owner, created.id, { name: "No version" }), SkillValidationError);
  await assert.rejects(service.update(owner, created.id, { name: "Stale", expectedVersion: 5 }), SkillStateError);
  await assert.rejects(service.update(owner, created.id, { slug: "renamed", expectedVersion: 1 }), SkillValidationError);

  const updated = await service.update(owner, created.id, { name: "Expense review", expectedVersion: 1 });
  assert.equal(updated.version, 2);
  assert.equal(updated.name, "Expense review");

  await assert.rejects(service.update(owner, "system:code-review", { name: "Mine", expectedVersion: 1 }), SkillStateError);

  const archived = await service.setStatus(owner, created.id, "archived", 2);
  assert.equal(archived.status, "archived");
  await assert.rejects(service.update(owner, created.id, { name: "x", expectedVersion: 3 }), SkillStateError);

  assert.deepEqual(events.map((event) => event.type), ["skill.created", "skill.updated", "skill.archived"]);
  assert.doesNotMatch(JSON.stringify(events), /Compare each line/, "instructions are not copied into the audit trail");
});

test("an organization skill replaces the system skill of the same slug; drafts and archived ones do not", async () => {
  const { service } = setup();
  const owner = person("owner");

  const drafted = await service.create(owner, { ...draft, slug: "financial-analysis", name: "Our analysis" });
  assert.equal((await service.effective(orgA)).get("financial-analysis")?.scope, "system");

  await service.setStatus(owner, drafted.id, "active", 1);
  assert.equal((await service.effective(orgA)).get("financial-analysis")?.name, "Our analysis");
  assert.equal((await service.get(owner, "system:financial-analysis")).overriddenBy?.name, "Our analysis");

  await service.setStatus(owner, drafted.id, "archived", 2);
  assert.equal((await service.effective(orgA)).get("financial-analysis")?.scope, "system");
});

test("assignment only succeeds for an agent that already meets every requirement", async () => {
  const { service } = setup();
  const ledger = agent("Ledger");
  const writer = agent("Writer", { capabilities: ["writing"], toolIds: [] });

  await service.checkAssignment(ledger, ["financial-analysis"]);

  await assert.rejects(service.checkAssignment(writer, ["financial-analysis"]), /needs the calculator tool and the financial_analysis capability/);
  await assert.rejects(service.checkAssignment(ledger, ["made-up-skill"]), /not an active skill/);

  const other = agent("Other", { organizationId: orgB });
  const { service: fresh } = setup([other]);
  await fresh.create(person("owner", orgA), { ...draft, status: "active" });
  await assert.rejects(fresh.checkAssignment(other, ["q3-expense-review"]), /not an active skill/, "another organization's skill cannot be assigned");
});
