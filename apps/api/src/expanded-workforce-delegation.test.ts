import assert from "node:assert/strict";
import test from "node:test";

import type { Agent, AgentId, OrganizationId, TaskId, WorkId, Workspace, WorkspaceId } from "@unioffice/core";
import type { AgentRepository, OrganizationRepository, WorkspaceRepository } from "@unioffice/database";
import { DefaultDelegator } from "@unioffice/orchestrator";

import { completeDevelopmentWorkforce, ensureDevelopmentWorkforce } from "./development-workforce.js";

/**
 * Who the real delegator hands work to across the whole company of
 * seventy-one: every blueprint the API provisions, and Dana and Rhea as
 * people made them. Routing is by capability, tools, room and the
 * delegator's own rank - nothing here names who should win. Nothing runs a
 * model; this proves the routing, not the work.
 */

const organizationId = "2f6b579a-f0f8-45a5-868a-21c08bde1314" as OrganizationId;

async function company() {
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

  await ensureDevelopmentWorkforce(organizations, agentRepository, workspaceRepository, completeDevelopmentWorkforce);

  const roomOf = (slug: string) => [...workspaces.values()].find((workspace) => workspace.slug === slug)!.id;
  const now = new Date();

  // As the company really is: a person has moved three of the first six into
  // rooms, which the seed then leaves alone.
  for (const [name, room] of [["Tony", "engineering"], ["Harvey", "finance"], ["Mike", "research"]] as const) {
    const agent = [...agents.values()].find((entry) => entry.name === name)!;
    agents.set(agent.id, { ...agent, workspaceId: roomOf(room), metadata: { ...agent.metadata, userConfigured: true } });
  }
  for (const agent of [
    { id: "295bf325-f292-49bc-bb99-fc7a43394e09", name: "Dana", workspaceId: roomOf("engineering"), capabilities: ["scheduling", "calculation"], toolIds: ["calculator", "datetime"] },
    { id: "7e9b865a-4743-49a5-b1af-b4f0ff7bc9b7", name: "Rhea", workspaceId: roomOf("customer-success"), capabilities: ["customer_communication", "writing"], toolIds: ["datetime"] },
  ]) {
    agents.set(agent.id as AgentId, {
      ...agent, id: agent.id as AgentId, organizationId, description: "", type: "specialist", status: "active",
      skills: [], createdAt: now, updatedAt: now, metadata: { userConfigured: true },
    });
  }

  return { agents, agentRepository, roomOf };
}

let sequence = 0;

async function route(
  office: Awaited<ReturnType<typeof company>>,
  step: { capabilities: string[]; tools?: string[]; skill?: string; room?: string },
): Promise<string> {
  sequence += 1;
  const workspaceId = step.room ? office.roomOf(step.room) : undefined;
  // The same availability rule the planner applies before routing.
  const available = [...office.agents.values()].filter((agent) =>
    agent.status === "active" && (!workspaceId || !agent.workspaceId || agent.workspaceId === workspaceId));

  const delegated = await new DefaultDelegator(office.agentRepository).delegate({
    workId: `work-${sequence}` as WorkId,
    organizationId,
    workspaceId,
    availableAgentIds: available.map((agent) => agent.id),
    context: {},
    task: {
      id: `task-${sequence}` as TaskId,
      ref: "step",
      title: "A step",
      description: "A step of a mission.",
      requiredCapabilities: step.capabilities,
      requiredTools: step.tools ?? [],
      skill: step.skill,
      dependsOn: [],
      metadata: {},
    },
  });

  return office.agents.get(delegated.agentId)!.name;
}

test("the company is seventy-one agents, each once", async () => {
  const { agents } = await company();
  const names = [...agents.values()].map((agent) => agent.name);

  assert.equal(agents.size, 71);
  assert.equal(new Set(names).size, 71);
});

test("routes each kind of work to someone whose job it is, in the room it belongs to", async () => {
  const office = await company();

  for (const [label, step, expected] of [
    ["frontend implementation", { capabilities: ["frontend_development"], room: "engineering" }, ["Wanda", "Alex"]],
    ["a feature across front and back end", { capabilities: ["frontend_development", "backend_development"], room: "engineering" }, ["Alex"]],
    ["backend implementation", { capabilities: ["backend_development"], room: "engineering" }, ["Bruce"]],
    ["ML work", { capabilities: ["machine_learning"], room: "engineering" }, ["Maya"]],
    ["agent engineering", { capabilities: ["ai_engineering"], room: "engineering" }, ["Leo"]],
    ["a data pipeline", { capabilities: ["data_engineering"], room: "engineering" }, ["Elena"]],
    ["infrastructure", { capabilities: ["infrastructure_operations"], room: "engineering" }, ["Sam", "Olivia"]],
    ["cloud infrastructure", { capabilities: ["cloud_infrastructure"], room: "engineering" }, ["Olivia"]],
    ["reliability", { capabilities: ["site_reliability"], room: "engineering" }, ["Noah"]],
    ["performance", { capabilities: ["performance_engineering"], room: "engineering" }, ["Arjun"]],
    ["security", { capabilities: ["security_engineering"], room: "engineering" }, ["Chloe"]],
    ["model operations", { capabilities: ["mlops"], room: "engineering" }, ["Ryan"]],
    ["a mobile release", { capabilities: ["mobile_development"], room: "engineering" }, ["Sophie"]],
    ["an integration", { capabilities: ["systems_integration"], room: "engineering" }, ["Liam"]],
    ["product strategy", { capabilities: ["product_strategy"], room: "product" }, ["Emma"]],
    ["a product decision", { capabilities: ["product_management"], room: "product" }, ["Jessica"]],
    ["UX design", { capabilities: ["product_design"], room: "product" }, ["Lucas"]],
    ["UX research", { capabilities: ["ux_research"], room: "product" }, ["Mia"]],
    ["product analytics", { capabilities: ["product_analytics"], tools: ["calculator"], room: "product" }, ["Daniel"]],
    ["market research", { capabilities: ["market_analysis"], tools: ["calculator"], room: "research" }, ["Rachel", "Nora", "Isabella"]],
    ["competitive intelligence", { capabilities: ["competitive_intelligence"], room: "research" }, ["Nora"]],
    ["sales", { capabilities: ["sales"], room: "revenue-growth" }, ["Donna", "Grace"]],
    ["an account", { capabilities: ["account_management"], room: "revenue-growth" }, ["Grace"]],
    ["marketing", { capabilities: ["marketing"], room: "revenue-growth" }, ["Louis", "Max", "Zoe", "Caleb"]],
    ["paid acquisition", { capabilities: ["performance_marketing"], room: "revenue-growth" }, ["Max"]],
    ["search", { capabilities: ["search_optimization"], room: "revenue-growth" }, ["Zoe"]],
    ["a content plan", { capabilities: ["content_strategy"], room: "revenue-growth" }, ["Caleb"]],
    ["operations", { capabilities: ["project_coordination"], room: "operations" }, ["Brienne", "Marcus"]],
    ["running operations", { capabilities: ["operations_management"], room: "operations" }, ["Marcus"]],
    ["procurement", { capabilities: ["procurement"], room: "operations" }, ["Davos", "Isaac"]],
    ["vendor operations", { capabilities: ["vendor_operations"], room: "operations" }, ["Isaac"]],
    ["finance", { capabilities: ["financial_analysis"], tools: ["calculator"], room: "finance" }, ["Harvey", "Olivia F", "Sophia"]],
    ["an investment case", { capabilities: ["investment_analysis"], room: "finance" }, ["Olivia F"]],
    ["the budget", { capabilities: ["financial_planning"], room: "finance" }, ["Sophia"]],
    ["customer support", { capabilities: ["customer_support"], room: "customer-success" }, ["Katrina"]],
    ["customer success", { capabilities: ["customer_success"], room: "customer-success" }, ["Rhea", "Amelia"]],
    ["a customer message", { capabilities: ["customer_communication"], room: "customer-success" }, ["Rhea", "Amelia"]],
    ["executive analysis", { capabilities: ["executive_analysis"] }, ["Victor", "Stella", "Adrian"]],
    ["strategy", { capabilities: ["strategy_analysis"] }, ["Victor", "Stella", "Adrian"]],
    ["the leadership agenda", { capabilities: ["executive_coordination"] }, ["Victor", "Stella", "Adrian"]],
    ["compliance", { capabilities: ["compliance"], room: "compliance-risk" }, ["Victoria"]],
  ] as const) {
    const who = await route(office, step as { capabilities: string[]; tools?: string[]; room?: string });
    assert.ok((expected as readonly string[]).includes(who), `${label} went to ${who}, expected one of ${expected.join(", ")}`);
  }
});

test("an agent already here keeps the work it did before the expansion", async () => {
  const office = await company();

  // A tie in the rank goes to the lower id, and the expansion's ids come after.
  assert.equal(await route(office, { capabilities: ["frontend_development"], room: "engineering" }), "Wanda");
  assert.equal(await route(office, { capabilities: ["sales"], room: "revenue-growth" }), "Donna");
  assert.equal(await route(office, { capabilities: ["financial_analysis"], tools: ["calculator"], room: "finance" }), "Harvey");
  assert.equal(await route(office, { capabilities: ["procurement"], room: "operations" }), "Davos");
});

test("a mission in one room is not given to someone in another", async () => {
  const office = await company();

  // Alex does full-stack work in Engineering, but not a Product mission's.
  assert.notEqual(await route(office, { capabilities: ["full_stack_development"], room: "product" }), "Alex");
  // Victoria does compliance, but a Finance mission stays in Finance or the hall.
  const who = await route(office, { capabilities: ["compliance"], room: "finance" });
  assert.notEqual(who, "Victoria");
});

test("follows a step's skill to a newcomer who holds it", async () => {
  const office = await company();

  assert.equal(await route(office, { capabilities: ["security_engineering"], skill: "incident-analysis", tools: ["datetime"], room: "engineering" }), "Chloe");
  assert.equal(await route(office, { capabilities: ["financial_planning"], skill: "budget-review", tools: ["calculator"], room: "finance" }), "Sophia");
  assert.equal(await route(office, { capabilities: ["compliance"], skill: "policy-drafting", room: "compliance-risk" }), "Victoria");
});
