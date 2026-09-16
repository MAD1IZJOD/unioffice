import assert from "node:assert/strict";
import test from "node:test";

import type {
  Agent,
  AgentId,
  Artifact,
  ArtifactId,
  Event,
  EventId,
  OrganizationId,
  Policy,
  PolicyId,
  Task,
  TaskId,
  Work,
  WorkId,
  Workspace,
  WorkspaceId,
} from "@unioffice/core";

import { InMemoryOperationalReadRepository } from "@unioffice/database";
import { createDefaultToolRegistry } from "@unioffice/tools";

import { AgentNotFoundError } from "./agent-directory-service.js";
import { WorkforceService, type Reach } from "./workforce-service.js";

const orgA = "aaaaaaaa-0000-4000-8000-000000000001" as OrganizationId;
const orgB = "bbbbbbbb-0000-4000-8000-000000000002" as OrganizationId;
const finance = "f0000000-0000-4000-8000-00000000000f" as WorkspaceId;
const now = Date.now();
const ago = (minutes: number) => new Date(now - minutes * 60_000);

/** Someone who reaches only company-wide work. */
const companyOnly: Reach = (workspaceId) => !workspaceId;

function agent(id: string, overrides: Partial<Agent> = {}): Agent {
  return {
    id: id as AgentId,
    organizationId: orgA,
    name: id[0]!.toUpperCase() + id.slice(1),
    description: `${id} does work.`,
    type: "specialist",
    status: "active",
    capabilities: ["calculation"],
    toolIds: ["calculator"],
    createdAt: ago(10_000),
    updatedAt: ago(10_000),
    metadata: { systemInstructions: "You are a secret prompt that must never leave the server." },
    ...overrides,
  };
}

function work(id: string, overrides: Partial<Work> = {}): Work {
  return {
    id: id as WorkId,
    organizationId: orgA,
    requesterId: "user" as Work["requesterId"],
    objective: `Objective of ${id}`,
    status: "executing",
    priority: "normal",
    createdAt: ago(60),
    updatedAt: ago(1),
    metadata: { briefing: "A confidential briefing." },
    ...overrides,
  };
}

function task(id: string, workId: string, agentId: string, status: Task["status"], overrides: Partial<Task> = {}): Task {
  return {
    id: id as TaskId,
    workId: workId as WorkId,
    title: `Step ${id}`,
    description: "",
    status,
    assignedAgentId: agentId as AgentId,
    dependsOn: [],
    createdAt: ago(30),
    updatedAt: ago(5),
    startedAt: status === "pending" || status === "ready" ? undefined : ago(20),
    completedAt: status === "completed" || status === "failed" ? ago(10) : undefined,
    result: { output: "The whole confidential result of the step." },
    metadata: {},
    ...overrides,
  };
}

function setup(input: {
  agents: Agent[];
  works?: Work[];
  tasks?: Task[];
  events?: Event[];
  artifacts?: Artifact[];
  policies?: Policy[];
}) {
  const reads = new InMemoryOperationalReadRepository(input.works ?? [], input.tasks ?? [], input.events ?? [], input.artifacts ?? []);
  const workspaces: Workspace[] = [
    { id: finance, organizationId: orgA, name: "Finance", slug: "finance", status: "active", createdAt: ago(1), updatedAt: ago(1), metadata: {} },
  ];

  return new WorkforceService({
    agents: {
      async findById(id) { return input.agents.find((entry) => entry.id === id) ?? null; },
      async findByOrganization(organizationId) { return input.agents.filter((entry) => entry.organizationId === organizationId); },
    },
    reads,
    workspaces: { async findByOrganization(organizationId) { return workspaces.filter((entry) => entry.organizationId === organizationId); } },
    policies: { async findEnforced(organizationId) { return (input.policies ?? []).filter((policy) => policy.organizationId === organizationId && policy.status === "active"); } },
    tools: createDefaultToolRegistry(),
  });
}

test("status comes from the agent and its steps: working, waiting, available, paused, unavailable", async () => {
  const service = setup({
    agents: [agent("tony"), agent("harvey"), agent("mike"), agent("jamie", { status: "paused" }), agent("peter", { status: "disabled" })],
    works: [work("launch"), work("old", { status: "completed", completedAt: ago(100) })],
    tasks: [
      task("t1", "launch", "tony", "running"),
      task("t2", "launch", "harvey", "waiting"),
      task("t3", "launch", "mike", "ready"),
      // A step still marked running in a mission that already finished is not work.
      task("t4", "old", "mike", "running"),
    ],
  });

  const workforce = await service.getWorkforce(orgA);
  const presence = Object.fromEntries(workforce.members.map((member) => [member.name, member.presence]));

  assert.deepEqual(presence, { Tony: "working", Harvey: "waiting", Mike: "available", Jamie: "paused", Peter: "unavailable" });
  assert.deepEqual(workforce.summary, { total: 5, working: 1, waiting: 1, available: 1, paused: 1, unavailable: 1 });
  assert.equal(workforce.members.find((member) => member.name === "Mike")?.upcomingSteps, 1);
});

test("current work names the mission and the step, and nothing the agent was told or produced", async () => {
  const service = setup({
    agents: [agent("tony")],
    works: [work("launch", { metadata: { missionName: "Launch Product X" } })],
    tasks: [task("auth", "launch", "tony", "running", { title: "Build authentication flow" })],
  });

  const [tony] = (await service.getWorkforce(orgA)).members;

  assert.equal(tony!.current?.missionName, "Launch Product X");
  assert.equal(tony!.current?.taskTitle, "Build authentication flow");
  assert.equal(tony!.current?.state, "working");
  assert.doesNotMatch(JSON.stringify(tony), /secret prompt|confidential/i);
});

test("tools are named from the registry, and a grant for an unregistered tool is marked as such", async () => {
  const service = setup({ agents: [agent("tony", { toolIds: ["calculator", "json_transform", "teleporter"] })] });

  const [tony] = (await service.getWorkforce(orgA)).members;

  assert.deepEqual(tony!.tools.map((tool) => [tool.id, tool.registered]), [["calculator", true], ["json_transform", true], ["teleporter", false]]);
  assert.ok(tony!.tools[0]!.name.length > 0);
});

test("the last outcome and recent counts come from finished steps", async () => {
  const service = setup({
    agents: [agent("harvey")],
    works: [work("budget", { status: "completed" }), work("forecast", { status: "failed" })],
    tasks: [
      task("sum", "budget", "harvey", "completed", { title: "Sum the budget", completedAt: ago(50) }),
      task("model", "forecast", "harvey", "failed", { title: "Model the forecast", completedAt: ago(5) }),
    ],
  });

  const [harvey] = (await service.getWorkforce(orgA)).members;

  assert.equal(harvey!.lastOutcome?.taskTitle, "Model the forecast");
  assert.equal(harvey!.lastOutcome?.outcome, "failed");
  assert.deepEqual(harvey!.recent, { completed: 1, failed: 1 });
});

test("another organization's agents and missions never appear", async () => {
  const service = setup({
    agents: [agent("tony"), agent("intruder", { organizationId: orgB })],
    works: [work("theirs", { organizationId: orgB })],
    tasks: [task("t", "theirs", "tony", "running")],
  });

  const workforce = await service.getWorkforce(orgA);

  assert.deepEqual(workforce.members.map((member) => member.name), ["Tony"]);
  assert.equal(workforce.members[0]!.presence, "available");
  await assert.rejects(service.getProfile(orgA, "intruder" as AgentId), AgentNotFoundError);
});

test("someone without a workspace grant does not see that workspace's agents or missions", async () => {
  const service = setup({
    agents: [agent("tony"), agent("ledger", { workspaceId: finance })],
    works: [work("close", { workspaceId: finance })],
    tasks: [task("t", "close", "tony", "running", { title: "Close the books" })],
  });

  const workforce = await service.getWorkforce(orgA, { reach: companyOnly });
  const tony = workforce.members.find((member) => member.name === "Tony")!;

  assert.deepEqual(workforce.members.map((member) => member.name), ["Tony"]);
  assert.equal(tony.presence, "working");
  assert.equal(tony.current, undefined);
  assert.equal(tony.workingElsewhere, true);
  assert.doesNotMatch(JSON.stringify(workforce), /Close the books|Objective of close/);

  await assert.rejects(service.getProfile(orgA, "ledger" as AgentId, { reach: companyOnly }), AgentNotFoundError);
  assert.equal((await service.getProfile(orgA, "ledger" as AgentId)).member.workspace?.name, "Finance");
});

test("a profile's history, artifacts and activity leave out missions the caller cannot open", async () => {
  const service = setup({
    agents: [agent("harvey")],
    works: [work("public", { status: "completed" }), work("private", { status: "completed", workspaceId: finance })],
    tasks: [
      task("p1", "public", "harvey", "completed", { title: "Public step" }),
      task("s1", "private", "harvey", "completed", { title: "Private step" }),
    ],
    artifacts: [
      { id: "a1" as ArtifactId, organizationId: orgA, workId: "public" as WorkId, createdByAgentId: "harvey" as AgentId, name: "Public report", type: "analysis", version: 1, createdAt: ago(9), updatedAt: ago(9), metadata: { content: "confidential body" } },
      { id: "a2" as ArtifactId, organizationId: orgA, workId: "private" as WorkId, createdByAgentId: "harvey" as AgentId, name: "Private report", type: "analysis", version: 1, createdAt: ago(8), updatedAt: ago(8), metadata: {} },
    ],
    events: [
      { id: "e1" as EventId, organizationId: orgA, workId: "public" as WorkId, agentId: "harvey" as AgentId, actorType: "agent", type: "task.completed", timestamp: ago(9), payload: { title: "Public step" }, metadata: {} },
      { id: "e2" as EventId, organizationId: orgA, workId: "private" as WorkId, agentId: "harvey" as AgentId, actorType: "agent", type: "task.completed", timestamp: ago(8), payload: { title: "Private step" }, metadata: {} },
      { id: "e3" as EventId, organizationId: orgA, workId: "public" as WorkId, agentId: "harvey" as AgentId, actorType: "agent", type: "task.failed", timestamp: ago(7), payload: { title: "Public step", error: "ECONNREFUSED 10.0.0.4:5432 password=hunter2" }, metadata: {} },
    ],
  });

  const profile = await service.getProfile(orgA, "harvey" as AgentId, { reach: companyOnly });

  assert.deepEqual(profile.history.map((entry) => entry.taskTitle), ["Public step"]);
  assert.deepEqual(profile.artifacts.map((entry) => entry.name), ["Public report"]);
  assert.deepEqual(profile.activity.map((entry) => entry.summary), ["“Public step” failed", "Harvey finished “Public step”"]);
  assert.doesNotMatch(JSON.stringify(profile), /Private|hunter2|ECONNREFUSED|confidential|secret prompt/);
});

test("a steps' mission from another organization is not shown, even though steps carry no organization", async () => {
  const service = setup({
    agents: [agent("harvey")],
    works: [work("theirs", { organizationId: orgB, status: "completed" })],
    tasks: [task("t", "theirs", "harvey", "completed", { title: "Their step" })],
  });

  const profile = await service.getProfile(orgA, "harvey" as AgentId);

  assert.deepEqual(profile.history, []);
  assert.equal(profile.member.lastOutcome, undefined);
});

test("governance shows what the agent may do with each tool it holds, which a grant alone does not decide", async () => {
  const policy = (id: string, overrides: Partial<Policy>): Policy => ({
    id: id as PolicyId,
    organizationId: orgA,
    name: id,
    description: "",
    subject: "tool",
    scope: { agentIds: [], toolIds: [], workspaceIds: [], capabilities: [] },
    effect: "require_approval",
    risk: "high",
    status: "active",
    createdAt: ago(1),
    updatedAt: ago(1),
    metadata: {},
    ...overrides,
  });

  const service = setup({
    agents: [agent("harvey", { toolIds: ["calculator", "datetime"] })],
    policies: [
      policy("Calculations need a person", { scope: { agentIds: [], toolIds: ["calculator"], workspaceIds: [], capabilities: [] } }),
      policy("Only for Tony", { effect: "deny", scope: { agentIds: ["tony" as AgentId], toolIds: [], workspaceIds: [], capabilities: [] } }),
      policy("Draft rule", { status: "draft", effect: "deny" }),
    ],
  });

  const { governance } = await service.getProfile(orgA, "harvey" as AgentId);

  assert.deepEqual(governance.tools.map((tool) => [tool.toolId, tool.access]), [["calculator", "requires_approval"], ["datetime", "allowed"]]);
  assert.deepEqual(governance.tools[0]!.policyNames, ["Calculations need a person"]);
  assert.deepEqual(governance.policies.map((entry) => entry.name), ["Calculations need a person"]);
});
