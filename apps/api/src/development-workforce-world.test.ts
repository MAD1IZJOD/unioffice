import assert from "node:assert/strict";
import test from "node:test";

import type { Agent, AgentId, Organization, OrganizationId, Workspace, WorkspaceId } from "@unioffice/core";
import type { AgentRepository, OrganizationRepository, WorkspaceRepository } from "@unioffice/database";
import { InMemoryOperationalReadRepository, InMemorySkillRepository } from "@unioffice/database";
import { createDefaultToolRegistry } from "@unioffice/tools";

import {
  completeDevelopmentWorkforce,
  ensureDevelopmentWorkforce,
  proposedWorkforce,
  SEED_WORKSPACES,
  workforce as firstSix,
} from "./development-workforce.js";
import { SkillService } from "./skills/skill-service.js";
import { expandedWorkforce } from "./workforce-expansion.js";
import { WorkforceService } from "./workforce-service.js";
import { HALL_ID, WorldService } from "./world-service.js";

/**
 * The development company, provisioned the way the API does on boot when the
 * seed is on, and read back through the real Workforce and World services
 * over the same stores. The company starts as it was before any of the
 * newcomers: eight agents - three of the first six still owned by the seed,
 * three a person has since configured, and Dana and Rhea, whom people made -
 * and five workspaces people made, with their own ids. Provisioning brings
 * the twelve and the fifty-one of the expansion, seventy-one in all.
 */

const org = "2f6b579a-f0f8-45a5-868a-21c08bde1314" as OrganizationId;
const now = new Date("2026-09-30T10:00:00.000Z");

const theirWorkspaces: Array<[slug: string, name: string, id: string]> = [
  ["engineering", "Engineering", "ee52c29c-e9b5-47d6-8e11-666c05088a4c"],
  ["research", "Research", "54c504b8-442d-47db-8c36-211dc09134ac"],
  ["finance", "Finance", "a4d57028-90bc-4c1e-acaf-0cddb13465bf"],
  ["operations", "Operations", "ea4d5f57-e0c4-453e-899a-b0aacb34d3ef"],
  ["customer-success", "Customer Success", "4458cec5-123f-4b08-b167-34e7316eb7de"],
];
const workspaceId = (slug: string) => theirWorkspaces.find(([entry]) => entry === slug)![2] as WorkspaceId;

const existingEight = ["Tyrion", "Tony", "Harvey", "Mike", "Jamie", "Peter", "Dana", "Rhea"];
const retired = ["Atlas", "Forge", "Ledger", "Nova", "Kindred", "Relay"];

/** Everyone the seed adds to the eight. */
const newcomers = [...proposedWorkforce, ...expandedWorkforce];

/** Where each of the twelve sits, and as what. */
const expected: Record<string, { role: string; room: string }> = {
  Wanda: { role: "Frontend Engineer", room: "engineering" },
  Bruce: { role: "Backend Engineer", room: "engineering" },
  Natasha: { role: "QA Engineer", room: "engineering" },
  Sam: { role: "DevOps Engineer", room: "engineering" },
  Jessica: { role: "Product Manager", room: "product" },
  Rachel: { role: "Product Researcher", room: "research" },
  Donna: { role: "Account Executive", room: "revenue-growth" },
  Louis: { role: "Marketing Manager", room: "revenue-growth" },
  Sansa: { role: "Growth & Content Lead", room: "revenue-growth" },
  Brienne: { role: "Project Coordinator", room: "operations" },
  Davos: { role: "Procurement & Vendor Manager", room: "operations" },
  Katrina: { role: "Customer Support Specialist", room: "customer-success" },
};

async function company() {
  const agents = new Map<AgentId, Agent>();
  const workspaces = new Map<WorkspaceId, Workspace>(theirWorkspaces.map(([slug, name, id]) => [
    id as WorkspaceId,
    { id: id as WorkspaceId, organizationId: org, name, slug, status: "active", createdAt: now, updatedAt: now, metadata: {} },
  ]));
  let organization: Organization | null = {
    id: org, slug: "unioffice-development", name: "UNI-OFFICE Development", status: "active", createdAt: now, updatedAt: now, metadata: {},
  };
  const writes: string[] = [];

  const organizationStore: OrganizationRepository = {
    async create(value) { organization = value; return value; },
    async findById() { return organization; },
    async findBySlug() { return organization; },
    async update(value) { organization = value; return value; },
    async delete() {},
  };
  const agentStore: AgentRepository = {
    async create(agent) { writes.push(`create agent ${agent.name}`); agents.set(agent.id, structuredClone(agent)); return agent; },
    async findById(id) { return structuredClone(agents.get(id)) ?? null; },
    async findByOrganization(id) { return [...agents.values()].filter((agent) => agent.organizationId === id).map((agent) => structuredClone(agent)); },
    async findByWorkspace(id, workspace) { return [...agents.values()].filter((agent) => agent.organizationId === id && agent.workspaceId === workspace); },
    async update(agent) { writes.push(`update agent ${agent.name}`); agents.set(agent.id, structuredClone(agent)); return agent; },
    async delete(id) { writes.push(`delete agent ${id}`); agents.delete(id); },
  };
  const workspaceStore = {
    async create(workspace: Workspace) { writes.push(`create workspace ${workspace.slug}`); workspaces.set(workspace.id, workspace); return workspace; },
    async findById(id: WorkspaceId) { return workspaces.get(id) ?? null; },
    async findByOrganization(id: OrganizationId) { return [...workspaces.values()].filter((entry) => entry.organizationId === id); },
    async findBySlug(id: OrganizationId, slug: string) { return [...workspaces.values()].find((entry) => entry.organizationId === id && entry.slug === slug) ?? null; },
    async update(workspace: Workspace) { writes.push(`update workspace ${workspace.slug}`); workspaces.set(workspace.id, workspace); return workspace; },
    async delete(id: WorkspaceId) { writes.push(`delete workspace ${id}`); workspaces.delete(id); },
  } as unknown as WorkspaceRepository;

  // The company as it is today: the first six were seeded long ago ...
  await ensureDevelopmentWorkforce(organizationStore, agentStore, workspaceStore, firstSix);
  // ... three of them have since been configured by a person ...
  for (const [name, room, description] of [
    ["Tony", "engineering", "Tony, as the person running the company described him."],
    ["Harvey", "finance", "Harvey, as the person running the company described him."],
    ["Mike", "research", "Mike, as the person running the company described him."],
  ] as const) {
    const agent = [...agents.values()].find((entry) => entry.name === name)!;
    agents.set(agent.id, { ...agent, workspaceId: workspaceId(room), description, capabilities: [...agent.capabilities, "handpicked"], metadata: { ...agent.metadata, userConfigured: true } });
  }
  // ... and two were made by people, never by the seed.
  for (const [id, name, room] of [
    ["295bf325-f292-49bc-bb99-fc7a43394e09", "Dana", "engineering"],
    ["7e9b865a-4743-49a5-b1af-b4f0ff7bc9b7", "Rhea", "customer-success"],
  ] as const) {
    agents.set(id as AgentId, {
      id: id as AgentId, organizationId: org, workspaceId: workspaceId(room), name, description: `${name}, made by a person.`, type: "specialist", status: "active",
      capabilities: ["writing"], toolIds: ["datetime"], skills: [], createdAt: now, updatedAt: now, metadata: { userConfigured: true },
    });
  }
  writes.length = 0;

  const reads = new InMemoryOperationalReadRepository([], []);
  const tools = createDefaultToolRegistry();
  const skills = new SkillService({ skills: new InMemorySkillRepository(), agents: agentStore, workspaces: workspaceStore, tools, eventRecorder: { async record(event: unknown) { return event; } } as never });
  const workforce = new WorkforceService({ agents: agentStore, reads, workspaces: workspaceStore, policies: { async findEnforced() { return []; } }, tools, skills } as never);
  const world = new WorldService({ workforce, reads, tasks: { async findByWork() { return []; } }, workspaces: workspaceStore, artifacts: { async findByWork() { return []; } } });

  /** Provisions exactly as `apps/api/src/index.ts` does when the seed is on. */
  const provision = () => ensureDevelopmentWorkforce(organizationStore, agentStore, workspaceStore, completeDevelopmentWorkforce);

  return { agents, workspaces, writes, provision, workforce, world };
}

test("the complete development workforce reaches the Workforce and the World: seventy-one agents, each once", async () => {
  const { provision, workforce, world, agents } = await company();
  const before = structuredClone([...agents.values()]);
  assert.deepEqual(before.map((agent) => agent.name).sort(), [...existingEight].sort(), "the company starts with its eight");

  await provision();

  const members = (await workforce.getWorkforce(org)).members;
  const names = members.map((member) => member.name);
  assert.equal(members.length, 71);
  assert.deepEqual([...names].sort(), [...existingEight, ...newcomers.map((blueprint) => blueprint.name)].sort());
  assert.equal(new Set(members.map((member) => member.id)).size, 71, "no id twice");
  assert.equal(new Set(names).size, 71, "no name twice");
  for (const name of retired) assert.equal(names.includes(name), false, `${name} does not come back`);

  // The World shows exactly the same people, each seated once.
  const snapshot = await world.getWorld(org);
  assert.deepEqual(snapshot.agents.map((agent) => agent.id).sort(), members.map((member) => member.id).sort());
  assert.deepEqual(snapshot.rooms.flatMap((room) => room.agentIds).sort(), members.map((member) => member.id).sort());

  // The existing eight are still there, under the same ids.
  for (const agent of before) assert.ok(members.some((member) => member.id === agent.id && member.name === agent.name), `${agent.name} is still here`);
});

test("each newcomer is in their workspace's room, with their role, capabilities, tools, skills and status", async () => {
  const { provision, workforce, world, workspaces } = await company();
  await provision();

  const members = (await workforce.getWorkforce(org)).members;
  const snapshot = await world.getWorld(org);
  const roomOf = (slug: string) => [...workspaces.values()].find((workspace) => workspace.slug === slug)!;

  // The twelve are checked against what was agreed for them; the expansion
  // against its own blueprints, which its contract test already holds to.
  for (const blueprint of proposedWorkforce) assert.deepEqual(expected[blueprint.name], { role: blueprint.role, room: blueprint.workspace });

  for (const blueprint of newcomers) {
    const role = blueprint.role!;
    const room = blueprint.workspace;
    const member = members.find((entry) => entry.id === blueprint.id);
    assert.ok(member, `${blueprint.name} is in the Workforce`);
    assert.equal(member.role, role);
    assert.equal(member.workspace?.slug, room, `${blueprint.name}'s workspace`);
    assert.equal(member.status, "active");
    assert.equal(member.presence, "available");
    assert.deepEqual(member.capabilities, blueprint.capabilities);
    assert.deepEqual(member.tools.map((tool) => tool.id).sort(), [...blueprint.toolIds].sort());

    const profile = await workforce.getProfile(org, blueprint.id as AgentId);
    assert.deepEqual(profile.skills.map((skill) => skill.slug).sort(), [...blueprint.skills].sort(), `${blueprint.name}'s skills`);

    const inWorld = snapshot.agents.find((entry) => entry.id === blueprint.id)!;
    assert.equal(inWorld.role, role);
    const roomId = room ? roomOf(room).id : HALL_ID;
    assert.equal(inWorld.roomId, roomId, `${blueprint.name} sits in ${room ?? "the hall"}`);
    assert.equal(inWorld.presence, "available");
    assert.ok(snapshot.rooms.find((entry) => entry.id === roomId)?.agentIds.includes(blueprint.id as AgentId));
  }
});

test("reuses the company's workspaces and makes only Product, Revenue & Growth and Compliance & Risk", async () => {
  const { provision, workspaces, writes } = await company();
  await provision();

  const bySlug = new Map([...workspaces.values()].map((workspace) => [workspace.slug, workspace]));
  assert.equal(workspaces.size, 8);
  for (const [slug, , id] of theirWorkspaces) assert.equal(bySlug.get(slug)?.id, id, `${slug} is reused`);
  assert.equal(bySlug.get("product")?.id, SEED_WORKSPACES.product.id);
  assert.equal(bySlug.get("revenue-growth")?.id, SEED_WORKSPACES["revenue-growth"].id);
  assert.equal(bySlug.get("compliance-risk")?.id, SEED_WORKSPACES["compliance-risk"].id);
  assert.deepEqual(writes.filter((write) => write.includes("workspace")).sort(), [
    "create workspace compliance-risk",
    "create workspace product",
    "create workspace revenue-growth",
  ]);
});

test("writes only the newcomers: nobody existing is changed, and nothing is deleted", async () => {
  const { provision, agents, writes } = await company();
  const before = structuredClone(new Map(agents));

  await provision();

  assert.deepEqual(
    writes.filter((write) => write.includes("agent")).sort(),
    newcomers.map((blueprint) => `create agent ${blueprint.name}`).sort(),
  );
  for (const [id, agent] of before) assert.deepEqual(agents.get(id), agent, `${agent.name} is exactly as it was`);
});

test("provisioning again adds no agent and no workspace, and writes nothing", async () => {
  const { provision, agents, workspaces, writes } = await company();
  await provision();
  const counts = [agents.size, workspaces.size];
  writes.length = 0;

  await provision();

  assert.deepEqual([agents.size, workspaces.size], counts);
  assert.deepEqual(writes, []);
});

test("someone who reaches only some workspaces sees only the agents in them, in the World as in the Workforce", async () => {
  const { provision, workforce, world, workspaces } = await company();
  await provision();

  const hidden = [...workspaces.values()].find((workspace) => workspace.slug === "revenue-growth")!.id;
  const reach = (id: WorkspaceId | undefined) => id !== hidden;

  const listed = (await workforce.getWorkforce(org, { reach })).members.map((member) => member.name).sort();
  const snapshot = await world.getWorld(org, { reach });

  const inRevenue = newcomers.filter((blueprint) => blueprint.workspace === "revenue-growth").map((blueprint) => blueprint.name);
  assert.equal(inRevenue.length, 13);
  for (const name of inRevenue) assert.equal(listed.includes(name), false, `${name} is hidden`);
  assert.equal(listed.length, 71 - 13);
  assert.deepEqual(snapshot.agents.map((agent) => agent.name).sort(), listed);
  assert.equal(snapshot.rooms.some((room) => room.id === hidden), false, "their room is hidden too");
  assert.ok(snapshot.rooms.some((room) => room.id === HALL_ID));
});
