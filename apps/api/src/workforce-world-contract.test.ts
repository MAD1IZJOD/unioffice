import assert from "node:assert/strict";
import test from "node:test";

import type { Agent, AgentId, OrganizationId, Workspace, WorkspaceId } from "@unioffice/core";
import { InMemoryOperationalReadRepository, InMemorySkillRepository } from "@unioffice/database";
import { createDefaultToolRegistry } from "@unioffice/tools";

import { AgentDirectoryService, AgentValidationError } from "./agent-directory-service.js";
import { SkillService, SkillValidationError } from "./skills/skill-service.js";
import { WorkforceService } from "./workforce-service.js";
import { WorldService, HALL_ID } from "./world-service.js";

/**
 * The contract between provisioning and the World.
 *
 * An agent made through the owner/admin path is a row in the one agent
 * store. The Workforce and the World both read that store - there is no
 * second registry to keep in step - so a new agent appears in the World, in
 * its workspace's room, with its role, without anyone adding it there. These
 * run the real services over one shared store, exactly as the API wires
 * them, and prove it.
 */

const org = "aaaaaaaa-0000-4000-8000-000000000001" as OrganizationId;
const other = "bbbbbbbb-0000-4000-8000-000000000002" as OrganizationId;
const product = "p0000000-0000-4000-8000-00000000000p" as WorkspaceId;
const engineering = "e0000000-0000-4000-8000-00000000000e" as WorkspaceId;
const now = new Date("2026-09-30T10:00:00.000Z");

function office() {
  const agents: Agent[] = [
    {
      id: "tyrion" as AgentId,
      organizationId: org,
      name: "Tyrion",
      description: "Plans the work.",
      type: "orchestrator",
      status: "active",
      capabilities: ["planning", "coordination"],
      toolIds: [],
      skills: [],
      createdAt: now,
      updatedAt: now,
      metadata: {},
    },
  ];
  const workspaces: Workspace[] = [
    { id: product, organizationId: org, name: "Product", slug: "product", status: "active", createdAt: now, updatedAt: now, metadata: {} },
    { id: engineering, organizationId: org, name: "Engineering", slug: "engineering", status: "active", createdAt: now, updatedAt: now, metadata: {} },
  ];

  // One store, read and written by everything below.
  const agentStore = {
    async create(agent: Agent) { agents.push(structuredClone(agent)); return agent; },
    async findById(id: AgentId) { return structuredClone(agents.find((agent) => agent.id === id)) ?? null; },
    async findByOrganization(id: OrganizationId) { return agents.filter((agent) => agent.organizationId === id).map((agent) => structuredClone(agent)); },
    async findByWorkspace(id: OrganizationId, workspaceId: WorkspaceId) { return agents.filter((agent) => agent.organizationId === id && agent.workspaceId === workspaceId); },
    async update(agent: Agent) { agents[agents.findIndex((entry) => entry.id === agent.id)] = structuredClone(agent); return agent; },
    async delete(id: AgentId) { agents.splice(agents.findIndex((entry) => entry.id === id), 1); },
  };
  const workspaceStore = {
    async findById(id: WorkspaceId) { return workspaces.find((workspace) => workspace.id === id) ?? null; },
    async findByOrganization(id: OrganizationId) { return workspaces.filter((workspace) => workspace.organizationId === id); },
  };
  const events: Array<{ type: string; payload?: Record<string, unknown> }> = [];
  const recorder = { async record(event: { type: string; payload?: Record<string, unknown> }) { events.push(event); return event; } };

  const skills = new SkillService({
    skills: new InMemorySkillRepository(),
    agents: agentStore,
    workspaces: workspaceStore,
    tools: createDefaultToolRegistry(),
    eventRecorder: recorder as never,
  });
  const directory = new AgentDirectoryService(agentStore as never, workspaceStore as never, createDefaultToolRegistry(), recorder as never, skills);

  const reads = new InMemoryOperationalReadRepository([], []);
  const workforce = new WorkforceService({
    agents: agentStore,
    reads,
    workspaces: workspaceStore,
    policies: { async findEnforced() { return []; } },
    tools: createDefaultToolRegistry(),
  });
  const world = new WorldService({
    workforce,
    reads,
    tasks: { async findByWork() { return []; } },
    workspaces: workspaceStore,
    artifacts: { async findByWork() { return []; } },
  });

  return { agents, directory, workforce, world, events };
}

const jessica = {
  organizationId: org,
  name: "Jessica",
  role: "Product Manager",
  description: "Decides what gets built next and why.",
  type: "specialist" as const,
  capabilities: ["product_management", "stakeholder_messaging", "writing"],
  toolIds: ["datetime"],
  workspaceId: product,
  skills: ["stakeholder-update", "meeting-summary"],
};

test("an agent made through provisioning appears in the World, in its workspace's room, with its role", async () => {
  const { directory, workforce, world, events } = office();

  const made = await directory.createAgent(jessica);

  // Persisted as given.
  assert.equal(made.role, "Product Manager");
  assert.equal(made.workspaceId, product);
  assert.deepEqual(made.skills, ["stakeholder-update", "meeting-summary"]);
  assert.match(String(made.metadata.systemInstructions), /^You are Jessica, the UNIOFFICE Product Manager\./);
  assert.equal(events.at(-1)?.type, "agent.created");
  assert.equal(events.at(-1)?.payload?.role, "Product Manager");

  // The Workforce reads it back.
  const member = (await workforce.getWorkforce(org)).members.find((entry) => entry.name === "Jessica");
  assert.equal(member?.role, "Product Manager");
  assert.equal(member?.workspace?.name, "Product");
  assert.equal(member?.presence, "available");

  // And so does the World - nobody added it there.
  const snapshot = await world.getWorld(org);
  const inWorld = snapshot.agents.find((entry) => entry.id === made.id);
  assert.ok(inWorld, "Jessica is in the World");
  assert.equal(inWorld.role, "Product Manager");
  assert.equal(inWorld.roomId, product);
  assert.equal(inWorld.status, "active");
  assert.deepEqual(snapshot.rooms.find((room) => room.id === product)?.agentIds, [made.id]);
});

test("every agent the Workforce lists is in the World, and nothing else is", async () => {
  const { directory, workforce, world } = office();
  await directory.createAgent(jessica);
  await directory.createAgent({ ...jessica, name: "Wanda", role: "Frontend Engineer", workspaceId: engineering, capabilities: ["frontend_development", "coding"], skills: [] });

  const listed = (await workforce.getWorkforce(org)).members.map((member) => member.id).sort();
  const snapshot = await world.getWorld(org);

  assert.deepEqual(snapshot.agents.map((agent) => agent.id).sort(), listed);
  assert.deepEqual(snapshot.rooms.flatMap((room) => room.agentIds).sort(), listed, "each is seated exactly once");
});

test("moving an agent to another workspace, or out of one, moves it in the World", async () => {
  const { directory, world } = office();
  const made = await directory.createAgent(jessica);

  await directory.updateAgent({ organizationId: org, agentId: made.id, workspaceId: engineering });
  assert.equal((await world.getWorld(org)).agents.find((entry) => entry.id === made.id)?.roomId, engineering);

  await directory.updateAgent({ organizationId: org, agentId: made.id, workspaceId: null });
  assert.equal((await world.getWorld(org)).agents.find((entry) => entry.id === made.id)?.roomId, HALL_ID);
});

test("a disabled or paused agent is still at its desk, and the World says it is not working", async () => {
  const { directory, world } = office();
  const made = await directory.createAgent(jessica);

  await directory.updateAgent({ organizationId: org, agentId: made.id, status: "disabled" });
  let inWorld = (await world.getWorld(org)).agents.find((entry) => entry.id === made.id)!;
  assert.equal(inWorld.status, "disabled");
  assert.equal(inWorld.presence, "unavailable");

  await directory.updateAgent({ organizationId: org, agentId: made.id, status: "paused" });
  inWorld = (await world.getWorld(org)).agents.find((entry) => entry.id === made.id)!;
  assert.equal(inWorld.presence, "paused");
});

test("changing or clearing a role changes it everywhere, and leaves everything else alone", async () => {
  const { directory, world } = office();
  const made = await directory.createAgent(jessica);

  await directory.updateAgent({ organizationId: org, agentId: made.id, role: "Head of Product" });
  let inWorld = (await world.getWorld(org)).agents.find((entry) => entry.id === made.id)!;
  assert.equal(inWorld.role, "Head of Product");
  assert.equal(inWorld.roomId, product);

  await directory.updateAgent({ organizationId: org, agentId: made.id, description: "Still here." });
  inWorld = (await world.getWorld(org)).agents.find((entry) => entry.id === made.id)!;
  assert.equal(inWorld.role, "Head of Product", "an update that does not mention the role keeps it");

  const cleared = await directory.updateAgent({ organizationId: org, agentId: made.id, role: null });
  assert.equal(cleared.role, undefined);
  assert.match(String(cleared.metadata.systemInstructions), /^You are Jessica, a UNIOFFICE specialist\./);
  inWorld = (await world.getWorld(org)).agents.find((entry) => entry.id === made.id)!;
  assert.equal("role" in inWorld, false);
});

test("refuses a role that is not a short title, and saves nothing", async () => {
  const { directory, agents } = office();

  await assert.rejects(directory.createAgent({ ...jessica, role: "x".repeat(61) }), AgentValidationError);
  await assert.rejects(directory.createAgent({ ...jessica, role: 42 as unknown as string }), AgentValidationError);
  assert.equal(agents.some((agent) => agent.name === "Jessica"), false);

  const blank = await directory.createAgent({ ...jessica, role: "   " });
  assert.equal(blank.role, undefined, "spaces are no role");
});

test("refuses a skill at creation that the agent could not use, and saves nothing", async () => {
  const { directory, agents } = office();

  // Financial analysis needs a capability and a tool Jessica is not given.
  await assert.rejects(directory.createAgent({ ...jessica, skills: ["financial-analysis"] }), SkillValidationError);
  assert.equal(agents.some((agent) => agent.name === "Jessica"), false);
});

test("never shows another company's agents, and hides one in a workspace the viewer cannot reach", async () => {
  const { directory, world } = office();
  const made = await directory.createAgent(jessica);
  await directory.createAgent({ ...jessica, organizationId: other, name: "Intruder", workspaceId: undefined, skills: [] });

  const snapshot = await world.getWorld(org);
  assert.equal(snapshot.agents.some((agent) => agent.name === "Intruder"), false);

  const outsider = await world.getWorld(org, { reach: (workspaceId) => workspaceId === undefined });
  assert.equal(outsider.agents.some((agent) => agent.id === made.id), false, "not in a room they cannot reach");
});
