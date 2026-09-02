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

import {
  DefaultDelegator,
} from "./default-delegator.js";

const organizationId = "org-1" as OrganizationId;
const atlasId = "agent-atlas" as AgentId;
const forgeId = "agent-forge" as AgentId;

function agent(
  id: AgentId,
  status: Agent["status"] = "active",
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
  };
}

function repository(agents: Agent[]): AgentRepository {
  return {
    async create(value) {
      return value;
    },
    async findById(id) {
      return agents.find((value) => value.id === id) ?? null;
    },
    async findByOrganization() {
      return agents;
    },
    async update(value) {
      return value;
    },
    async delete() {},
  };
}

function context(assignedAgentId?: AgentId) {
  return {
    workId: "work-1" as WorkId,
    task: {
      id: "task-1" as TaskId,
      ref: "task",
      title: "Test task",
      description: "Test task description.",
      assignedAgentId,
      dependsOn: [],
      metadata: {},
    },
    availableAgentIds: [atlasId, forgeId],
    organizationId,
    context: {},
  };
}

test("uses a valid explicit assignment", async () => {
  const delegator = new DefaultDelegator(
    repository([agent(atlasId), agent(forgeId)]),
  );

  const result = await delegator.delegate(context(forgeId));

  assert.equal(result.agentId, forgeId);
  assert.equal(result.metadata.delegation, "explicit");
});

test("selects an active agent when no assignment is supplied", async () => {
  const delegator = new DefaultDelegator(
    repository([agent(atlasId), agent(forgeId)]),
  );

  const result = await delegator.delegate(context());

  assert.equal(result.agentId, atlasId);
  assert.equal(result.metadata.delegation, "default");
});

test("rejects an unavailable explicit assignment", async () => {
  const delegator = new DefaultDelegator(
    repository([agent(atlasId), agent(forgeId, "disabled")]),
  );

  await assert.rejects(
    () => delegator.delegate(context(forgeId)),
    /Assigned agent is unavailable/,
  );
});
