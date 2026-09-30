import assert from "node:assert/strict";
import test from "node:test";

import type {
  Agent,
  AgentId,
  Organization,
  OrganizationId,
  Workspace,
  WorkspaceId,
} from "@unioffice/core";

import type {
  AgentRepository,
  OrganizationRepository,
  WorkspaceRepository,
} from "@unioffice/database";

import {
  completeDevelopmentWorkforce,
  ensureDevelopmentWorkforce,
  proposedWorkforce,
  SEED_WORKSPACES,
  workforce,
} from "./development-workforce.js";
import { expandedWorkforce } from "./workforce-expansion.js";

/** The first six and the twelve after them: what the tests below are about. */
const everyone = [...workforce, ...proposedWorkforce];

const organizationId = "2f6b579a-f0f8-45a5-868a-21c08bde1314" as OrganizationId;
const harveyId = "e32813a2-dda6-4a89-a756-c2991510c503" as AgentId;

function organizationRepository(organization: Organization | null): OrganizationRepository {
  let current = organization;

  return {
    async create(value) { current = value; return value; },
    async findById() { return current; },
    async findBySlug() { return current; },
    async update(value) { current = value; return value; },
    async delete() {},
  };
}

function agentRepository(initial: Agent[]): AgentRepository & { agents: Map<AgentId, Agent> } {
  const agents = new Map(initial.map((agent) => [agent.id, agent]));

  return {
    agents,
    async create(agent) { agents.set(agent.id, agent); return agent; },
    async findById(id) { return agents.get(id) ?? null; },
    async findByOrganization() { return [...agents.values()]; },
    async findByWorkspace(_organizationId, workspaceId) {
      return [...agents.values()].filter(
        (agent) => agent.workspaceId === workspaceId,
      );
    },
    async update(agent) { agents.set(agent.id, agent); return agent; },
    async delete(id) { agents.delete(id); },
  };
}

function workspaceRepository(initial: Workspace[] = []): WorkspaceRepository & { workspaces: Map<WorkspaceId, Workspace> } {
  const workspaces = new Map(initial.map((workspace) => [workspace.id, workspace]));

  return {
    workspaces,
    async create(workspace) { workspaces.set(workspace.id, workspace); return workspace; },
    async findById(id) { return workspaces.get(id) ?? null; },
    async findByOrganization(organization) { return [...workspaces.values()].filter((entry) => entry.organizationId === organization); },
    async findBySlug(organization, slug) {
      return [...workspaces.values()].find((entry) => entry.organizationId === organization && entry.slug === slug) ?? null;
    },
    async update(workspace) { workspaces.set(workspace.id, workspace); return workspace; },
    async delete(id) { workspaces.delete(id); },
  } as WorkspaceRepository & { workspaces: Map<WorkspaceId, Workspace> };
}

/** The Engineering workspace the company made itself, with its own id. */
function companyEngineering(): Workspace {
  const now = new Date();
  return {
    id: "ee52c29c-e9b5-47d6-8e11-666c05088a4c" as WorkspaceId,
    organizationId,
    name: "Engineering",
    slug: "engineering",
    status: "active",
    createdAt: now,
    updatedAt: now,
    metadata: {},
  };
}

function existingOrganization(): Organization {
  const now = new Date();
  return {
    id: organizationId,
    slug: "unioffice-development",
    name: "UNI-OFFICE Development",
    status: "active",
    createdAt: now,
    updatedAt: now,
    metadata: {},
  };
}

test("creates the full workforce with their granted tools when nothing exists yet", async () => {
  const agents = agentRepository([]);

  await ensureDevelopmentWorkforce(organizationRepository(null), agents, workspaceRepository());

  const harvey = agents.agents.get(harveyId);
  assert.ok(harvey);
  assert.deepEqual([...harvey.toolIds].sort(), ["calculator", "datetime"]);
});

test("grants tools to an agent seeded before toolIds existed, without touching its identity", async () => {
  const now = new Date();
  const staleHarvey: Agent = {
    id: harveyId,
    organizationId,
    name: "Harvey",
    description: "Performs careful financial, operational and decision analysis.",
    type: "specialist",
    status: "active",
    capabilities: ["analysis", "decision_support", "writing"],
    toolIds: [], // seeded before tool authorization existed
    createdAt: now,
    updatedAt: now,
    metadata: { developmentSeed: true },
  };
  const agents = agentRepository([staleHarvey]);

  await ensureDevelopmentWorkforce(organizationRepository(existingOrganization()), agents, workspaceRepository());

  const updated = agents.agents.get(harveyId);
  assert.ok(updated);
  assert.deepEqual([...updated.toolIds].sort(), ["calculator", "datetime"]);
  // Identity and creation metadata must survive the reconciliation.
  assert.equal(updated.id, harveyId);
  assert.equal(updated.createdAt.getTime(), now.getTime());
  assert.equal(updated.status, "active");
});

test("does not rewrite an agent that already matches the blueprint", async () => {
  const now = new Date();
  const upToDateHarvey: Agent = {
    id: harveyId,
    organizationId,
    name: "Harvey",
    description:
      "Runs the numbers exactly. Calculation, financial analysis and quantitative decision support.",
    type: "specialist",
    status: "active",
    capabilities: ["calculation", "financial_analysis", "decision_support"],
    toolIds: ["calculator", "datetime"],
    skills: ["financial-analysis", "budget-review", "variance-analysis", "forecasting"],
    createdAt: now,
    updatedAt: now,
    metadata: {
      developmentSeed: true,
      systemInstructions: [
        "You are Harvey, a UNIOFFICE specialist.",
        "Runs the numbers exactly. Calculation, financial analysis and quantitative decision support.",
        "Complete the assigned task using the supplied context.",
        "Be concise. Lead with the answer, and surface an assumption only when a different one would change it.",
        "Use your available tools for calculations or lookups instead of guessing; never claim to have used a tool you did not actually call.",
      ].join("\n"),
    },
  };
  const agents = agentRepository([upToDateHarvey]);
  let updateCalls = 0;
  const originalUpdate = agents.update.bind(agents);
  agents.update = async (agent) => {
    updateCalls += 1;
    return originalUpdate(agent);
  };

  await ensureDevelopmentWorkforce(organizationRepository(existingOrganization()), agents, workspaceRepository());

  assert.equal(updateCalls, 0, "an already-current agent must not be rewritten");
});

test("renames an agent seeded under an earlier name", async () => {
  const now = new Date();
  const previouslyNamed: Agent = {
    id: harveyId,
    organizationId,
    name: "Ledger",
    description:
      "Performs exact calculation and financial, operational and decision analysis.",
    type: "specialist",
    status: "active",
    capabilities: ["calculation", "financial_analysis", "decision_support"],
    toolIds: ["calculator", "datetime"],
    createdAt: now,
    updatedAt: now,
    metadata: { developmentSeed: true },
  };
  const agents = agentRepository([previouslyNamed]);

  await ensureDevelopmentWorkforce(organizationRepository(existingOrganization()), agents, workspaceRepository());

  const updated = agents.agents.get(harveyId);
  assert.ok(updated);
  assert.equal(updated.name, "Harvey");
  assert.match(
    String(updated.metadata.systemInstructions),
    /^You are Harvey, /,
  );
  assert.equal(updated.createdAt.getTime(), now.getTime());
});

test("leaves an agent alone once a person has configured it", async () => {
  const now = new Date();
  const configured: Agent = {
    id: "e32813a2-dda6-4a89-a756-c2991510c503" as AgentId,
    organizationId,
    name: "Harvey",
    description: "Rewritten by the person who runs this company.",
    type: "specialist",
    status: "paused",
    capabilities: ["calculation"],
    toolIds: ["calculator"],
    createdAt: now,
    updatedAt: now,
    metadata: { userConfigured: true, developmentSeed: true },
  };
  const agents = agentRepository([configured]);

  await ensureDevelopmentWorkforce(
    organizationRepository(existingOrganization()),
    agents,
    workspaceRepository(),
  );

  const after = agents.agents.get(configured.id)!;

  assert.equal(after.description, configured.description);
  assert.deepEqual(after.capabilities, ["calculation"]);
  assert.deepEqual(after.toolIds, ["calculator"]);
  assert.equal(after.status, "paused");
});

test("every seeded agent holds only skills it can actually use", async () => {
  const { resolveSkills, skillFit } = await import("@unioffice/skills");
  const repository = agentRepository([]);

  const { agents } = await ensureDevelopmentWorkforce(organizationRepository(null), repository, workspaceRepository(), everyone);
  const skills = resolveSkills([]);

  assert.ok(agents.some((agent) => (agent.skills ?? []).length > 0));

  for (const agent of agents) {
    for (const slug of agent.skills ?? []) {
      const skill = skills.get(slug);
      assert.ok(skill, `${agent.name} holds unknown skill ${slug}`);
      assert.equal(skillFit(agent, skill).fits, true, `${agent.name} cannot use ${slug}`);
    }
  }
});

/* The workforce beyond the first six ---------------------------------------- */

const engineeringTeam = [
  { name: "Wanda", role: "Frontend Engineer", owns: "frontend_development" },
  { name: "Bruce", role: "Backend Engineer", owns: "backend_development" },
  { name: "Natasha", role: "QA Engineer", owns: "quality_assurance" },
  { name: "Sam", role: "DevOps Engineer", owns: "infrastructure_operations" },
];

/** Everyone beyond the first six: where they sit, what they do, and the capability that is theirs alone. */
const newcomers = [
  ...engineeringTeam.map((member) => ({ ...member, room: "engineering" })),
  { name: "Jessica", role: "Product Manager", owns: "product_management", room: "product" },
  { name: "Rachel", role: "Product Researcher", owns: "product_research", room: "research" },
  { name: "Donna", role: "Account Executive", owns: "sales", room: "revenue-growth" },
  { name: "Louis", role: "Marketing Manager", owns: "marketing", room: "revenue-growth" },
  { name: "Sansa", role: "Growth & Content Lead", owns: "content_creation", room: "revenue-growth" },
  { name: "Brienne", role: "Project Coordinator", owns: "project_coordination", room: "operations" },
  { name: "Davos", role: "Procurement & Vendor Manager", owns: "procurement", room: "operations" },
  { name: "Katrina", role: "Customer Support Specialist", owns: "customer_support", room: "customer-success" },
];

test("the boot list is the first six, the twelve after them and the expansion, each once", () => {
  assert.deepEqual(
    completeDevelopmentWorkforce.map((blueprint) => blueprint.id),
    [...workforce, ...proposedWorkforce, ...expandedWorkforce].map((blueprint) => blueprint.id),
  );
  assert.equal(completeDevelopmentWorkforce.length, 69, "sixty-nine blueprints; Dana and Rhea make seventy-one");
  assert.equal(new Set(completeDevelopmentWorkforce.map((blueprint) => blueprint.id)).size, 69, "no id twice");
  assert.equal(new Set(completeDevelopmentWorkforce.map((blueprint) => blueprint.name)).size, 69, "no name twice");
});

test("called without a list, the seed still makes only the first six and no room", async () => {
  const agents = agentRepository([]);
  const workspaces = workspaceRepository([companyEngineering()]);

  const { agents: seeded } = await ensureDevelopmentWorkforce(organizationRepository(existingOrganization()), agents, workspaces);

  assert.deepEqual(seeded.map((agent) => agent.name).sort(), ["Harvey", "Jamie", "Mike", "Peter", "Tony", "Tyrion"]);
  for (const proposed of proposedWorkforce) {
    assert.equal(agents.agents.has(proposed.id as AgentId), false, `${proposed.name} is only made when passed`);
  }
  assert.deepEqual([...workspaces.workspaces.values()].map((workspace) => workspace.slug), ["engineering"], "no room is made");
});

test("seeds all twelve beyond the first six, each once, each with a role and a room", async () => {
  const { agents } = await ensureDevelopmentWorkforce(organizationRepository(null), agentRepository([]), workspaceRepository(), everyone);
  const seeded = agents.filter((agent) => typeof agent.role === "string");

  assert.equal(newcomers.length, 12);
  assert.deepEqual(seeded.map((agent) => agent.name).sort(), newcomers.map((member) => member.name).sort());
  assert.equal(agents.length, 18, "the six first seeded and twelve more; Dana and Rhea were made by people, not the seed");
  for (const agent of seeded) {
    assert.ok(agent.workspaceId, `${agent.name} sits in a room`);
    assert.ok(agent.description.length > 80, `${agent.name} says what they actually do`);
    assert.ok(agent.skills && agent.skills.length > 0, `${agent.name} holds at least one skill`);
  }
});

test("seats the engineering team in the company's own Engineering workspace, found by its slug", async () => {
  const agents = agentRepository([]);
  const workspaces = workspaceRepository([companyEngineering()]);

  await ensureDevelopmentWorkforce(organizationRepository(existingOrganization()), agents, workspaces, everyone);

  // Nothing new was made for a room the company already has.
  const engineering = [...workspaces.workspaces.values()].filter((workspace) => workspace.slug === "engineering");
  assert.deepEqual(engineering.map((workspace) => workspace.id), [companyEngineering().id]);

  for (const member of engineeringTeam) {
    const agent = [...agents.agents.values()].find((entry) => entry.name === member.name);
    assert.ok(agent, `${member.name} was seeded`);
    assert.equal(agent.organizationId, organizationId);
    assert.equal(agent.workspaceId, companyEngineering().id);
    assert.equal(agent.role, member.role);
    assert.equal(agent.status, "active");
    assert.ok(agent.capabilities.includes(member.owns), `${member.name} holds ${member.owns}`);
    assert.match(String(agent.metadata.systemInstructions), new RegExp(`^You are ${member.name}, the UNIOFFICE ${member.role}\\.`));
  }
});

test("gives each new agent a capability nobody else holds, and only tools that exist", async () => {
  const { createDefaultToolRegistry } = await import("@unioffice/tools");
  const registry = createDefaultToolRegistry();
  const agents = agentRepository([]);

  const { agents: seeded } = await ensureDevelopmentWorkforce(organizationRepository(null), agents, workspaceRepository(), everyone);

  for (const member of newcomers) {
    const holders = seeded.filter((agent) => agent.capabilities.includes(member.owns));
    assert.deepEqual(holders.map((agent) => agent.name), [member.name], `${member.owns} belongs to ${member.name} alone`);
  }

  for (const agent of seeded) {
    for (const toolId of agent.toolIds) {
      assert.equal(registry.has(toolId), true, `${agent.name} is granted ${toolId}, which is not a registered tool`);
    }
  }
});

test("creates a missing room once under the seed's id, and a second run changes nothing", async () => {
  const agents = agentRepository([]);
  const workspaces = workspaceRepository();

  await ensureDevelopmentWorkforce(organizationRepository(existingOrganization()), agents, workspaces, everyone);
  const engineering = [...workspaces.workspaces.values()].find((workspace) => workspace.slug === "engineering");
  assert.equal(engineering?.id, SEED_WORKSPACES.engineering.id);
  assert.equal(engineering?.organizationId, organizationId);

  let writes = 0;
  const count = <T>(write: (value: T) => Promise<T>) => async (value: T) => { writes += 1; return write(value); };
  agents.create = count(agents.create.bind(agents));
  agents.update = count(agents.update.bind(agents));
  workspaces.create = count(workspaces.create.bind(workspaces));

  await ensureDevelopmentWorkforce(organizationRepository(existingOrganization()), agents, workspaces, everyone);
  assert.equal(writes, 0, "a second boot writes nothing");
});

test("seats everyone new in their room, making only the rooms the company does not have yet", async () => {
  // The company's workspaces as they are: made by people, with their own ids.
  const now = new Date();
  const theirs = ["Engineering", "Research", "Finance", "Operations", "Customer Success"].map((name, index): Workspace => ({
    id: `00000000-0000-4000-8000-00000000000${index}` as WorkspaceId,
    organizationId,
    name,
    slug: name.toLowerCase().replace(/ /g, "-"),
    status: "active",
    createdAt: now,
    updatedAt: now,
    metadata: {},
  }));
  const workspaces = workspaceRepository(theirs);
  const agents = agentRepository([]);

  await ensureDevelopmentWorkforce(organizationRepository(existingOrganization()), agents, workspaces, everyone);

  const bySlug = new Map([...workspaces.workspaces.values()].map((workspace) => [workspace.slug, workspace]));
  const made = [...workspaces.workspaces.values()].filter((workspace) => !theirs.some((existing) => existing.id === workspace.id));
  assert.deepEqual(made.map((workspace) => workspace.slug).sort(), [...new Set(newcomers.map((member) => member.room))].filter((slug) => !theirs.some((existing) => existing.slug === slug)).sort());
  for (const workspace of made) assert.equal(workspace.metadata.developmentSeed, true);

  for (const member of newcomers) {
    const agent = [...agents.agents.values()].find((entry) => entry.name === member.name)!;
    assert.equal(agent.workspaceId, bySlug.get(member.room)!.id, `${member.name} works in ${member.room}`);
    assert.equal(agent.role, member.role);
  }
});

test("leaves the first six where they are: no room or role is given to them", async () => {
  const agents = agentRepository([]);

  await ensureDevelopmentWorkforce(organizationRepository(null), agents, workspaceRepository([companyEngineering()]), everyone);

  for (const name of ["Tyrion", "Tony", "Harvey", "Mike", "Jamie", "Peter"]) {
    const agent = [...agents.agents.values()].find((entry) => entry.name === name)!;
    assert.equal(agent.workspaceId, undefined, `${name} keeps no seeded room`);
    assert.equal(agent.role, undefined, `${name} keeps no seeded role`);
  }
});

test("names nobody twice and brings back none of the retired names", async () => {
  const { agents } = await ensureDevelopmentWorkforce(organizationRepository(null), agentRepository([]), workspaceRepository(), everyone);
  const names = agents.map((agent) => agent.name);

  assert.equal(new Set(names).size, names.length);
  for (const retired of ["Atlas", "Forge", "Ledger", "Nova", "Kindred", "Relay", "Dana", "Rhea"]) {
    assert.equal(names.includes(retired), false, `${retired} is not seeded`);
  }
});
