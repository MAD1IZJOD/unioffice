import assert from "node:assert/strict";
import test from "node:test";

import type {
  Agent,
  AgentId,
  OrganizationId,
  TaskId,
  WorkId,
  Workspace,
  WorkspaceId,
} from "@unioffice/core";
import type { AgentRepository, OrganizationRepository, WorkspaceRepository } from "@unioffice/database";
import { DefaultDelegator } from "@unioffice/orchestrator";

import { ensureDevelopmentWorkforce } from "./development-workforce.js";

/**
 * Who the delegator actually hands work to, across the whole seeded
 * workforce: the real blueprints, run through the real delegator. Nothing
 * here runs a model - it proves the routing, not the work.
 */

const organizationId = "2f6b579a-f0f8-45a5-868a-21c08bde1314" as OrganizationId;

async function seededWorkforce() {
  const agents = new Map<AgentId, Agent>();
  const workspaces = new Map<WorkspaceId, Workspace>();

  const organizations: OrganizationRepository = {
    async create(value) { return value; },
    async findById() { return null; },
    async findBySlug() { return null; },
    async update(value) { return value; },
    async delete() {},
  };
  const agentRepository: AgentRepository = {
    async create(agent) { agents.set(agent.id, agent); return agent; },
    async findById(id) { return agents.get(id) ?? null; },
    async findByOrganization(id) { return [...agents.values()].filter((agent) => agent.organizationId === id); },
    async findByWorkspace(_id, workspaceId) { return [...agents.values()].filter((agent) => agent.workspaceId === workspaceId); },
    async update(agent) { agents.set(agent.id, agent); return agent; },
    async delete(id) { agents.delete(id); },
  };
  const workspaceRepository: WorkspaceRepository = {
    async create(workspace) { workspaces.set(workspace.id, workspace); return workspace; },
    async findById(id) { return workspaces.get(id) ?? null; },
    async findByOrganization(id) { return [...workspaces.values()].filter((entry) => entry.organizationId === id); },
    async findBySlug(id, slug) { return [...workspaces.values()].find((entry) => entry.organizationId === id && entry.slug === slug) ?? null; },
    async update(workspace) { workspaces.set(workspace.id, workspace); return workspace; },
    async delete(id) { workspaces.delete(id); },
  };

  await ensureDevelopmentWorkforce(organizations, agentRepository, workspaceRepository);

  // The two the company made itself, as they are.
  const engineering = [...workspaces.values()].find((workspace) => workspace.slug === "engineering")!;
  const customers = [...workspaces.values()].find((workspace) => workspace.slug === "customer-success")!;
  const now = new Date();
  for (const agent of [
    { id: "295bf325-f292-49bc-bb99-fc7a43394e09", name: "Dana", workspaceId: engineering.id, capabilities: ["scheduling", "calculation"], toolIds: ["calculator", "datetime"] },
    { id: "7e9b865a-4743-49a5-b1af-b4f0ff7bc9b7", name: "Rhea", workspaceId: customers.id, capabilities: ["customer_communication", "writing"], toolIds: ["datetime"] },
  ]) {
    agents.set(agent.id as AgentId, {
      ...agent,
      id: agent.id as AgentId,
      organizationId,
      description: "",
      type: "specialist",
      status: "active",
      skills: [],
      createdAt: now,
      updatedAt: now,
      metadata: { userConfigured: true },
    });
  }

  const byName = (name: string) => [...agents.values()].find((agent) => agent.name === name)!;
  const roomOf = (slug: string) => [...workspaces.values()].find((workspace) => workspace.slug === slug)!.id;

  return { agents, agentRepository, byName, roomOf };
}

let sequence = 0;

async function route(
  workforce: Awaited<ReturnType<typeof seededWorkforce>>,
  step: { capability?: string; tools?: string[]; skill?: string; workspaceId?: WorkspaceId; unavailable?: string[] },
) {
  sequence += 1;
  const unavailable = new Set(step.unavailable ?? []);

  const delegated = await new DefaultDelegator(workforce.agentRepository).delegate({
    workId: `work-${sequence}` as WorkId,
    organizationId,
    workspaceId: step.workspaceId,
    availableAgentIds: [...workforce.agents.values()].filter((agent) => !unavailable.has(agent.name)).map((agent) => agent.id),
    context: {},
    task: {
      id: `task-${sequence}` as TaskId,
      ref: "step",
      title: "A step",
      description: "A step of a mission.",
      requiredCapabilities: step.capability ? [step.capability] : [],
      requiredTools: step.tools ?? [],
      skill: step.skill,
      dependsOn: [],
      metadata: {},
    },
  });

  return workforce.agents.get(delegated.agentId)!.name;
}

test("hands each kind of work to the agent whose job it is", async () => {
  const workforce = await seededWorkforce();

  for (const [capability, name] of [
    ["frontend_development", "Wanda"],
    ["backend_development", "Bruce"],
    ["quality_assurance", "Natasha"],
    ["infrastructure_operations", "Sam"],
    ["product_management", "Jessica"],
    ["product_research", "Rachel"],
    ["sales", "Donna"],
    ["marketing", "Louis"],
    ["content_creation", "Sansa"],
    ["project_coordination", "Brienne"],
    ["procurement", "Davos"],
    ["customer_support", "Katrina"],
  ] as const) {
    assert.equal(await route(workforce, { capability }), name, `${capability} goes to ${name}`);
  }
});

test("still hands the first eight's work to them", async () => {
  const workforce = await seededWorkforce();

  assert.equal(await route(workforce, { capability: "financial_analysis" }), "Harvey");
  assert.equal(await route(workforce, { capability: "people_operations" }), "Jamie");
  assert.equal(await route(workforce, { capability: "data_transformation" }), "Tony");
});

test("follows a step's skill to someone who holds it", async () => {
  const workforce = await seededWorkforce();

  assert.equal(await route(workforce, { capability: "quality_assurance", skill: "test-generation" }), "Natasha");
  assert.equal(await route(workforce, { capability: "infrastructure_operations", skill: "incident-analysis", tools: ["datetime"] }), "Sam");
  assert.equal(await route(workforce, { capability: "procurement", skill: "forecasting", tools: ["calculator", "datetime"] }), "Davos");
});

test("tells apart an agent that exists from one that can take the step", async () => {
  const workforce = await seededWorkforce();

  // Not available right now: the work goes elsewhere, never to Wanda.
  assert.notEqual(await route(workforce, { capability: "frontend_development", unavailable: ["Wanda"] }), "Wanda");

  // Not granted the tool the step needs: Wanda holds no calculator.
  assert.notEqual(await route(workforce, { capability: "frontend_development", tools: ["calculator"] }), "Wanda");

  // A mission in another room: Engineering's frontend engineer does not take it.
  assert.notEqual(await route(workforce, { capability: "frontend_development", workspaceId: workforce.roomOf("product") }), "Wanda");

  // Paused: the same.
  workforce.byName("Katrina").status = "paused";
  assert.notEqual(await route(workforce, { capability: "customer_support" }), "Katrina");
});

test("keeps a mission's work inside its room when someone there can do it", async () => {
  const workforce = await seededWorkforce();

  assert.equal(await route(workforce, { capability: "coding", workspaceId: workforce.roomOf("engineering") }).then((name) =>
    ["Tony", "Wanda", "Bruce", "Natasha"].includes(name)), true);
  assert.equal(await route(workforce, { capability: "writing", workspaceId: workforce.roomOf("revenue-growth") }).then((name) =>
    ["Donna", "Louis", "Sansa"].includes(name)), true);
});
