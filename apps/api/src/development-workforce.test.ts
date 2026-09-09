import assert from "node:assert/strict";
import test from "node:test";

import type {
  Agent,
  AgentId,
  Organization,
  OrganizationId,
} from "@unioffice/core";

import type {
  AgentRepository,
  OrganizationRepository,
} from "@unioffice/database";

import { ensureDevelopmentWorkforce } from "./development-workforce.js";

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

  await ensureDevelopmentWorkforce(organizationRepository(null), agents);

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

  await ensureDevelopmentWorkforce(organizationRepository(existingOrganization()), agents);

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
    createdAt: now,
    updatedAt: now,
    metadata: {
      developmentSeed: true,
      systemInstructions: [
        "You are Harvey, a UNI-OFFICE specialist.",
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

  await ensureDevelopmentWorkforce(organizationRepository(existingOrganization()), agents);

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

  await ensureDevelopmentWorkforce(organizationRepository(existingOrganization()), agents);

  const updated = agents.agents.get(harveyId);
  assert.ok(updated);
  assert.equal(updated.name, "Harvey");
  assert.match(
    String(updated.metadata.systemInstructions),
    /^You are Harvey, /,
  );
  assert.equal(updated.createdAt.getTime(), now.getTime());
});
