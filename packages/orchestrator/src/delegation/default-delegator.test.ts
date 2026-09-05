import assert from "node:assert/strict";
import test from "node:test";

import type {
  Agent,
  AgentId,
  OrganizationId,
  TaskId,
  WorkId,
} from "@unioffice/core";

import type {
  AgentRepository,
} from "@unioffice/database";

import { DefaultDelegator } from "./default-delegator.js";

const organizationId = "org-1" as OrganizationId;
const atlasId = "agent-atlas" as AgentId;
const forgeId = "agent-forge" as AgentId;

function agent(
  id: AgentId,
  status: Agent["status"] = "active",
  overrides: Partial<Agent> = {},
): Agent {
  const now = new Date();
  return {
    id,
    organizationId,
    name: id,
    description: "Test agent.",
    type: "specialist",
    status,
    capabilities: [],
    toolIds: [],
    createdAt: now,
    updatedAt: now,
    metadata: {},
    ...overrides,
  };
}

function repository(agents: Agent[]): AgentRepository {
  return {
    async create(value) { return value; },
    async findById(id) { return agents.find((value) => value.id === id) ?? null; },
    async findByOrganization() { return agents; },
    async update(value) { return value; },
    async delete() {},
  };
}

function context(overrides: Partial<{
  assignedAgentId: AgentId;
  requiredCapabilities: string[];
  requiredTools: string[];
  suggestedAgentType: Agent["type"];
  workspaceId: string;
  availableAgentIds: AgentId[];
}> = {}) {
  return {
    workId: "work-1" as WorkId,
    task: {
      id: "task-1" as TaskId,
      ref: "task",
      title: "Test task",
      description: "Test task description.",
      assignedAgentId: overrides.assignedAgentId,
      requiredCapabilities: overrides.requiredCapabilities,
      requiredTools: overrides.requiredTools,
      suggestedAgentType: overrides.suggestedAgentType,
      dependsOn: [],
      metadata: {},
    },
    availableAgentIds: overrides.availableAgentIds ?? [atlasId, forgeId],
    organizationId,
    workspaceId: overrides.workspaceId as never,
    context: {},
  };
}

test("uses a valid explicit assignment", async () => {
  const delegator = new DefaultDelegator(repository([agent(atlasId), agent(forgeId)]));
  const result = await delegator.delegate(context({ assignedAgentId: forgeId }));
  assert.equal(result.agentId, forgeId);
  assert.equal(result.metadata.delegation, "explicit");
});

test("ranks agents by required capability", async () => {
  const delegator = new DefaultDelegator(repository([
    agent(atlasId, "active", { capabilities: ["planning"] }),
    agent(forgeId, "active", { capabilities: ["coding"] }),
  ]));
  const result = await delegator.delegate(context({ requiredCapabilities: ["coding"] }));
  assert.equal(result.agentId, forgeId);
  assert.equal(result.metadata.delegation, "capability_ranked");
});

test("rejects an unavailable explicit assignment", async () => {
  const delegator = new DefaultDelegator(repository([agent(atlasId), agent(forgeId, "disabled")]));
  await assert.rejects(
    () => delegator.delegate(context({ assignedAgentId: forgeId })),
    /Assigned agent is unavailable/,
  );
});

test("prefers an exact workspace agent over an organization-wide agent", async () => {
  const workspaceId = "workspace-1";
  const delegator = new DefaultDelegator(repository([
    agent(atlasId),
    agent(forgeId, "active", { workspaceId: workspaceId as never }),
  ]));
  const result = await delegator.delegate(context({ workspaceId }));
  assert.equal(result.agentId, forgeId);
});

test("excludes workspace-incompatible agents", async () => {
  const delegator = new DefaultDelegator(repository([
    agent(atlasId, "active", { workspaceId: "other" as never }),
    agent(forgeId, "active", { capabilities: ["coding"] }),
  ]));
  const result = await delegator.delegate(context({
    workspaceId: "workspace-1",
    requiredCapabilities: ["coding"],
  }));
  assert.equal(result.agentId, forgeId);
});

test("fails when no eligible agent has all required capabilities", async () => {
  const delegator = new DefaultDelegator(repository([agent(atlasId), agent(forgeId)]));
  await assert.rejects(
    () => delegator.delegate(context({ requiredCapabilities: ["coding"] })),
    /No eligible agent has the required capability\(ies\): coding/,
  );
});

test("routes a tool-required task to the tool-authorized agent even when the orchestrator would otherwise win", async () => {
  const delegator = new DefaultDelegator(repository([
    // Atlas has no tools but IS the suggested agent type, so it would win
    // on agentType/agentTypeSuitability if tool authorization weren't a
    // hard filter. This is the exact bug this test exists to prevent.
    agent(atlasId, "active", { type: "orchestrator" }),
    agent(forgeId, "active", { type: "specialist", toolIds: ["calculator"] }),
  ]));
  const result = await delegator.delegate(context({
    requiredTools: ["calculator"],
    suggestedAgentType: "orchestrator",
  }));

  assert.equal(result.agentId, forgeId);
  assert.equal(result.metadata.delegation, "capability_ranked");
  assert.deepEqual(result.metadata.requiredTools, ["calculator"]);
});

test("fails with a combined message when both a capability and a tool are unmet", async () => {
  const delegator = new DefaultDelegator(repository([
    agent(atlasId, "active", { type: "orchestrator" }),
    agent(forgeId, "active", { type: "specialist", capabilities: ["coding"] }),
  ]));

  await assert.rejects(
    () => delegator.delegate(context({ requiredCapabilities: ["finance"], requiredTools: ["calculator"] })),
    /No eligible agent is authorized for the required tool\(s\): calculator and has the required capability\(ies\): finance/,
  );
});

test("fails with a tool-specific message when no agent is authorized for the required tool", async () => {
  const delegator = new DefaultDelegator(repository([
    agent(atlasId, "active", { type: "orchestrator" }),
    agent(forgeId, "active", { type: "specialist" }),
  ]));

  await assert.rejects(
    () => delegator.delegate(context({ requiredTools: ["calculator"] })),
    /No eligible agent is authorized for the required tool\(s\): calculator/,
  );
});

test("rejects an explicit assignment to an agent that lacks the required tool", async () => {
  const delegator = new DefaultDelegator(repository([
    agent(atlasId, "active", { toolIds: [] }),
    agent(forgeId, "active", { toolIds: [] }),
  ]));

  await assert.rejects(
    () => delegator.delegate(context({ assignedAgentId: forgeId, requiredTools: ["calculator"] })),
    /Assigned agent is unavailable/,
  );
});

test("breaks an otherwise equal ranking by agent id", async () => {
  const laterId = "agent-z" as AgentId;
  const earlierId = "agent-a" as AgentId;
  const delegator = new DefaultDelegator(repository([agent(laterId), agent(earlierId)]));
  const result = await delegator.delegate(context({ availableAgentIds: [laterId, earlierId] }));
  assert.equal(result.agentId, earlierId);
});
