import assert from "node:assert/strict";
import test from "node:test";

import type { Agent, AgentId, OrganizationId, WorkId, WorkspaceId } from "@unioffice/core";

import { buildTestServer, type TestServices } from "./testing.js";

const org = "aaaaaaaa-0000-4000-8000-000000000001" as OrganizationId;
const finance = "f0000000-0000-4000-8000-00000000000f" as WorkspaceId;
const workId = "c0000000-0000-4000-8000-000000000001" as WorkId;
const secret = "PROMPT-THAT-MUST-STAY-ON-THE-SERVER";

function agent(id: string, overrides: Partial<Agent> = {}): Agent {
  return {
    id: id as AgentId,
    organizationId: org,
    name: id,
    description: "Works here.",
    type: "specialist",
    status: "active",
    capabilities: ["coding"],
    toolIds: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    metadata: { systemInstructions: secret, developmentSeed: true },
    ...overrides,
  };
}

function server(role: TestServices["role"] = "owner") {
  const tony = agent("a0000000-0000-4000-8000-00000000000a");
  const ledger = agent("a0000000-0000-4000-8000-00000000000b", { workspaceId: finance });

  return buildTestServer({
    developmentOrganizationId: org,
    role,
    workQueryService: {
      async assertWorkInOrganization() { return { id: workId, organizationId: org }; },
      async getAgents() { return [tony, ledger]; },
      async getWorkDetail() { return { work: { id: workId }, agents: [tony], tasks: [], events: [], artifacts: [], approvals: [], memories: [] }; },
    },
    executionQueueService: { async getActiveJob() { return null; } },
    executionRoomService: {
      async getRoom() { return { work: { id: workId }, agents: [tony], orchestrator: tony, cast: [{ agent: tony, tasks: [] }] }; },
    },
    workspaceService: { async getWorkspaceDetail() { return { workspace: { id: finance }, agents: [ledger], work: [], artifacts: [], activity: [] }; } },
    agentDirectoryService: {
      async createAgent() { return tony; },
      async updateAgent() { return tony; },
    },
    healthCheck: async () => ({}),
    corsOrigins: [],
  } as unknown as TestServices);
}

test("no surface that names an agent sends its instructions to the browser", async () => {
  const app = server();
  const responses = await Promise.all([
    app.inject({ method: "GET", url: "/agents" }),
    app.inject({ method: "GET", url: `/work/${workId}/room` }),
    app.inject({ method: "GET", url: `/work/${workId}/detail` }),
    app.inject({ method: "GET", url: `/workspaces/${finance}` }),
    app.inject({ method: "POST", url: "/agents", payload: { name: "Dana", description: "x", type: "specialist", capabilities: ["x"], toolIds: [] } }),
    app.inject({ method: "POST", url: "/agents/a0000000-0000-4000-8000-00000000000a", payload: { status: "paused" } }),
  ]);

  for (const response of responses) {
    assert.ok(response.statusCode < 300, `${response.statusCode} ${response.body.slice(0, 120)}`);
    assert.doesNotMatch(response.body, new RegExp(secret));
    assert.doesNotMatch(response.body, /developmentSeed/);
  }

  const room = responses[1]!.json();
  assert.equal(room.cast[0].agent.name, "a0000000-0000-4000-8000-00000000000a", "the room still names who holds each step");
});

test("the agent list is narrowed to the workspaces the caller reaches", async () => {
  const owner = (await server("owner").inject({ method: "GET", url: "/agents" })).json() as { agents: Agent[] };
  const member = (await server("member").inject({ method: "GET", url: "/agents" })).json() as { agents: Agent[] };

  assert.equal(owner.agents.length, 2);
  assert.deepEqual(member.agents.map((entry) => entry.workspaceId), [undefined]);
});
