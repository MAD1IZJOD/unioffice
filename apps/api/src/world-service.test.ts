import assert from "node:assert/strict";
import test from "node:test";

import type {
  Agent,
  AgentId,
  Artifact,
  OrganizationId,
  Task,
  TaskId,
  Work,
  WorkId,
  Workspace,
  WorkspaceId,
} from "@unioffice/core";

import { InMemoryOperationalReadRepository } from "@unioffice/database";
import { createDefaultToolRegistry } from "@unioffice/tools";

import { WorkforceService, type Reach } from "./workforce-service.js";
import { HALL_ID, WorldService } from "./world-service.js";

/**
 * The World read: the company as a place, made of nothing but facts.
 *
 * What these hold it to is that nothing is invented - an empty room stays
 * empty, a seat does not move between two reads, a handoff is one the task
 * rows record - and that nothing leaks: what a person cannot open is not in
 * the snapshot at all.
 */

const orgA = "aaaaaaaa-0000-4000-8000-000000000001" as OrganizationId;
const orgB = "bbbbbbbb-0000-4000-8000-000000000002" as OrganizationId;
const engineering = "e0000000-0000-4000-8000-00000000000e" as WorkspaceId;
const finance = "f0000000-0000-4000-8000-00000000000f" as WorkspaceId;
const legal = "10000000-0000-4000-8000-000000000001" as WorkspaceId;
const archived = "a0000000-0000-4000-8000-0000000000aa" as WorkspaceId;
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
    metadata: { systemInstructions: "A secret prompt that must never leave the server." },
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

function workspace(id: WorkspaceId, name: string, overrides: Partial<Workspace> = {}): Workspace {
  return { id, organizationId: orgA, name, slug: name.toLowerCase(), status: "active", createdAt: ago(1), updatedAt: ago(1), metadata: {}, ...overrides };
}

function world(input: { agents: Agent[]; works?: Work[]; tasks?: Task[]; workspaces?: Workspace[]; artifacts?: Artifact[] }) {
  const reads = new InMemoryOperationalReadRepository(input.works ?? [], input.tasks ?? []);
  const workspaces = input.workspaces ?? [
    workspace(engineering, "Engineering"),
    workspace(finance, "Finance"),
    workspace(legal, "Legal"),
    workspace(archived, "Old team", { status: "archived" }),
  ];
  const workspaceRepository = {
    async findByOrganization(organizationId: OrganizationId) {
      return workspaces.filter((entry) => entry.organizationId === organizationId);
    },
  };

  const workforce = new WorkforceService({
    agents: {
      async findById(id) { return input.agents.find((entry) => entry.id === id) ?? null; },
      async findByOrganization(organizationId) { return input.agents.filter((entry) => entry.organizationId === organizationId); },
    },
    reads,
    workspaces: workspaceRepository,
    policies: { async findEnforced() { return []; } },
    tools: createDefaultToolRegistry(),
  });

  return new WorldService({
    workforce,
    reads,
    tasks: {
      async findByWork(workId) {
        return (input.tasks ?? []).filter((entry) => entry.workId === workId).map((entry) => structuredClone(entry));
      },
    },
    workspaces: workspaceRepository,
    artifacts: {
      async findByWork(workId) {
        return (input.artifacts ?? []).filter((entry) => entry.workId === workId);
      },
    },
  });
}

function artifact(id: string, workId: string, taskId: string, overrides: Partial<Artifact> = {}): Artifact {
  return {
    id: id as Artifact["id"],
    organizationId: orgA,
    workId: workId as WorkId,
    taskId: taskId as TaskId,
    name: `Result ${id}`,
    type: "report",
    version: 1,
    createdAt: ago(10),
    updatedAt: ago(10),
    metadata: { content: "The confidential body of the result." },
    ...overrides,
  } as Artifact;
}

const roster = [
  agent("tyrion", { type: "orchestrator", capabilities: ["planning"] }),
  agent("tony", { workspaceId: engineering, capabilities: ["coding"] }),
  agent("dana", { workspaceId: engineering }),
  agent("harvey", { workspaceId: finance }),
  agent("mike", { capabilities: ["research"] }),
  agent("rhea", { workspaceId: archived }),
];

test("rooms are the hall and each active workspace; an empty one stays empty", async () => {
  const snapshot = await world({ agents: roster }).getWorld(orgA);

  assert.deepEqual(
    snapshot.rooms.map((room) => [room.name, room.agentIds]),
    [
      ["Company hall", ["tyrion", "mike", "rhea"]],
      ["Engineering", ["dana", "tony"]],
      ["Finance", ["harvey"]],
      ["Legal", []],
    ],
  );
  assert.equal(snapshot.rooms[0]!.id, HALL_ID);
  assert.ok(!snapshot.rooms.some((room) => room.name === "Old team"), "an archived workspace is not a room");
});

test("an agent whose workspace was archived still works here, in the hall", async () => {
  const snapshot = await world({ agents: roster }).getWorld(orgA);

  assert.equal(snapshot.agents.find((entry) => entry.id === "rhea")?.roomId, HALL_ID);
});

test("seats come from a stable order, not from the order rows arrive in", async () => {
  const first = await world({ agents: roster }).getWorld(orgA);
  const again = await world({ agents: [...roster].reverse() }).getWorld(orgA);

  const seats = (snapshot: typeof first) =>
    snapshot.agents.map((entry) => `${entry.id}@${entry.roomId}#${entry.seat}`).sort();

  assert.deepEqual(seats(again), seats(first));
  assert.equal(first.agents.find((entry) => entry.id === "tyrion")?.seat, 0, "whoever plans the work sits first");
});

test("an agent on a step shows that step, in the mission it belongs to", async () => {
  const snapshot = await world({
    agents: roster,
    works: [work("launch", { metadata: { missionName: "Launch Product X" } })],
    tasks: [
      task("t1", "launch", "tony", "running", { title: "Build authentication flow" }),
      task("t2", "launch", "mike", "waiting", { title: "Brief the team" }),
    ],
  }).getWorld(orgA);

  const tony = snapshot.agents.find((entry) => entry.id === "tony")!;
  assert.equal(tony.presence, "working");
  assert.equal(tony.current?.missionName, "Launch Product X");
  assert.equal(tony.current?.taskTitle, "Build authentication flow");

  assert.equal(snapshot.agents.find((entry) => entry.id === "mike")!.presence, "waiting");
  assert.deepEqual(snapshot.missions.map((mission) => [mission.name, mission.agentIds.sort(), mission.steps]), [
    ["Launch Product X", ["mike", "tony"], 2],
  ]);
});

test("a handoff is where one agent's finished step feeds another's, named by its mission", async () => {
  const snapshot = await world({
    agents: roster,
    works: [work("launch", { metadata: { missionName: "Launch Product X" } })],
    tasks: [
      task("t1", "launch", "mike", "completed", { title: "Research the market", createdAt: ago(40) }),
      task("t2", "launch", "tony", "running", { title: "Build it", dependsOn: ["t1" as TaskId], createdAt: ago(39) }),
      // One agent carrying on alone is not a handoff.
      task("t3", "launch", "tony", "pending", { title: "Test it", dependsOn: ["t2" as TaskId], createdAt: ago(38) }),
    ],
  }).getWorld(orgA);

  assert.equal(snapshot.handoffs.length, 1);

  const handoff = snapshot.handoffs[0]!;
  assert.equal(handoff.missionId, "launch");
  assert.equal(handoff.missionName, "Launch Product X");
  assert.deepEqual([handoff.from.id, handoff.to.id], ["mike", "tony"]);
  assert.deepEqual([handoff.fromStep.number, handoff.toStep.number], [1, 2]);
  assert.equal(handoff.state, "in_progress");
});

test("finished missions put nobody to work and hand nothing over", async () => {
  const snapshot = await world({
    agents: roster,
    works: [work("done", { status: "completed", completedAt: ago(2) })],
    tasks: [
      task("t1", "done", "mike", "completed", { createdAt: ago(40) }),
      task("t2", "done", "tony", "completed", { dependsOn: ["t1" as TaskId], createdAt: ago(39) }),
    ],
  }).getWorld(orgA);

  assert.deepEqual(snapshot.missions, []);
  assert.deepEqual(snapshot.handoffs, []);
  assert.ok(snapshot.agents.every((entry) => entry.presence === "available"));
  assert.equal(snapshot.agents.find((entry) => entry.id === "tony")?.lastOutcome?.outcome, "completed");
});

test("what someone cannot open is not in their world at all", async () => {
  const subject = world({
    agents: roster,
    works: [
      work("books", { workspaceId: finance, metadata: { missionName: "Close the books" } }),
      work("shared", { metadata: { missionName: "Company update" } }),
    ],
    tasks: [
      // Mike works everywhere, and is on a Finance mission right now.
      task("t1", "books", "harvey", "completed", { createdAt: ago(40) }),
      task("t2", "books", "mike", "running", { dependsOn: ["t1" as TaskId], createdAt: ago(39) }),
      task("t3", "shared", "tyrion", "pending"),
    ],
  });

  const snapshot = await subject.getWorld(orgA, { reach: companyOnly });
  const text = JSON.stringify(snapshot);

  assert.deepEqual(snapshot.rooms.map((room) => room.name), ["Company hall"]);
  assert.ok(!snapshot.agents.some((entry) => entry.id === "harvey" || entry.id === "tony"));
  assert.doesNotMatch(text, /Close the books|Finance|Engineering/);
  assert.deepEqual(snapshot.handoffs, [], "a handoff in a mission they cannot open does not appear");
  assert.deepEqual(snapshot.missions.map((mission) => mission.name), ["Company update"]);

  const mike = snapshot.agents.find((entry) => entry.id === "mike")!;
  assert.equal(mike.presence, "working");
  assert.equal(mike.workingElsewhere, true);
  assert.equal(mike.current, undefined, "working, without saying on what");
});

test("the planner is shown writing a plan only for a mission the caller may open", async () => {
  const visible = await world({
    agents: roster,
    works: [work("plan", { status: "planning", metadata: { missionName: "Plan the offsite" } })],
  }).getWorld(orgA);

  const tyrion = visible.agents.find((entry) => entry.id === "tyrion")!;
  assert.deepEqual(tyrion.planning, { missionId: "plan", missionName: "Plan the offsite" });
  assert.equal(tyrion.planningElsewhere, false);
  assert.equal(visible.agents.find((entry) => entry.id === "mike")!.planning, undefined, "only the planner plans");

  const hidden = await world({
    agents: roster,
    works: [work("plan", { status: "planning", workspaceId: finance, metadata: { missionName: "Plan the offsite" } })],
  }).getWorld(orgA, { reach: companyOnly });

  const unseen = hidden.agents.find((entry) => entry.id === "tyrion")!;
  assert.equal(unseen.planning, undefined);
  assert.equal(unseen.planningElsewhere, true);
  assert.doesNotMatch(JSON.stringify(hidden), /Plan the offsite/);
});

test("another organization's agents, rooms and missions never appear", async () => {
  const snapshot = await world({
    agents: [...roster, agent("spy", { organizationId: orgB })],
    works: [work("theirs", { organizationId: orgB, metadata: { missionName: "Their secret launch" } })],
    tasks: [task("x1", "theirs", "spy", "running")],
    workspaces: [workspace(engineering, "Engineering"), workspace(legal, "Theirs", { organizationId: orgB })],
  }).getWorld(orgA);

  const text = JSON.stringify(snapshot);
  assert.doesNotMatch(text, /spy|Their secret launch|Theirs/i);
});

test("nothing an agent was told or produced leaves the server", async () => {
  const snapshot = await world({
    agents: roster,
    works: [work("launch")],
    tasks: [task("t1", "launch", "tony", "running")],
  }).getWorld(orgA);

  const text = JSON.stringify(snapshot);
  assert.doesNotMatch(text, /secret prompt|confidential/);
});

test("a handoff names the result that changed hands, and nothing of what is in it", async () => {
  const snapshot = await world({
    agents: roster,
    works: [work("launch", { metadata: { missionName: "Launch Product X" } })],
    tasks: [
      task("t1", "launch", "mike", "completed", { title: "Research the market", createdAt: ago(40) }),
      task("t2", "launch", "tony", "running", { title: "Build it", dependsOn: ["t1" as TaskId], createdAt: ago(39) }),
    ],
    artifacts: [artifact("r1", "launch", "t1", { name: "Market research notes" })],
  }).getWorld(orgA);

  assert.deepEqual(snapshot.handoffs[0]?.delivered, { artifactId: "r1", name: "Market research notes" });
  assert.doesNotMatch(JSON.stringify(snapshot), /confidential body/);
});

test("a result filed under another organization is never named, whatever mission it claims", async () => {
  const snapshot = await world({
    agents: roster,
    works: [work("launch")],
    tasks: [
      task("t1", "launch", "mike", "completed", { createdAt: ago(40) }),
      task("t2", "launch", "tony", "running", { dependsOn: ["t1" as TaskId], createdAt: ago(39) }),
    ],
    artifacts: [artifact("theirs", "launch", "t1", { organizationId: orgB, name: "Their private report" })],
  }).getWorld(orgA);

  assert.equal(snapshot.handoffs[0]?.delivered, undefined);
  assert.doesNotMatch(JSON.stringify(snapshot), /Their private report/);
});
