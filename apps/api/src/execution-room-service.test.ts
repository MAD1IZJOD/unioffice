import assert from "node:assert/strict";
import test from "node:test";

import type {
  Agent,
  AgentId,
  ApprovalRequest,
  Artifact,
  ArtifactId,
  Event,
  EventId,
  OrganizationId,
  Task,
  TaskId,
  Work,
  WorkId,
  Workspace,
  WorkspaceId,
} from "@unioffice/core";

import { ExecutionRoomService } from "./execution-room-service.js";

const organizationId = "org-1" as OrganizationId;
const otherOrganizationId = "org-2" as OrganizationId;
const workId = "work-1" as WorkId;

const now = new Date("2026-01-01T00:00:00.000Z");

function work(overrides: Partial<Work> = {}): Work {
  return {
    id: workId,
    organizationId,
    requesterId: "user-1" as Work["requesterId"],
    objective: "Prepare the launch strategy",
    status: "executing",
    priority: "normal",
    createdAt: now,
    updatedAt: now,
    metadata: {},
    ...overrides,
  };
}

function agent(id: string, overrides: Partial<Agent> = {}): Agent {
  return {
    id: id as AgentId,
    organizationId,
    name: id,
    description: `${id} does things`,
    type: "specialist",
    status: "active",
    capabilities: [],
    toolIds: [],
    createdAt: now,
    updatedAt: now,
    metadata: {},
    ...overrides,
  };
}

function task(
  id: string,
  overrides: Partial<Task> = {},
): Task {
  return {
    id: id as TaskId,
    workId,
    title: `Task ${id}`,
    description: "",
    status: "pending",
    dependsOn: [],
    createdAt: now,
    updatedAt: now,
    metadata: {},
    ...overrides,
  };
}

interface RoomFixture {
  tasks?: Task[];
  events?: Event[];
  artifacts?: Artifact[];
  approvals?: ApprovalRequest[];
  roster?: Agent[];
  workspace?: Workspace | null;
  workRow?: Work | null;
}

function buildService(fixture: RoomFixture = {}) {
  const tasks = fixture.tasks ?? [];

  const service = new ExecutionRoomService(
    {
      findById: async () =>
        fixture.workRow === undefined ? work() : fixture.workRow,
    } as never,
    { findByWork: async () => tasks } as never,
    { findByWork: async () => fixture.events ?? [] } as never,
    { findByWork: async () => fixture.artifacts ?? [] } as never,
    { findByWork: async () => fixture.approvals ?? [] } as never,
    { findByOrganization: async () => fixture.roster ?? [] } as never,
    { query: async () => [] } as never,
    { findById: async () => fixture.workspace ?? null } as never,
    { findActiveByWork: async () => null } as never,
    {
      list: () => [
        { id: "calculator", name: "Calculator", description: "Arithmetic" },
      ],
    } as never,
  );

  return service;
}

test("refuses an id that is not a work item, rather than returning an empty room", async () => {
  const service = buildService({ workRow: null });

  await assert.rejects(
    () => service.getRoom(workId),
    /Work not found/,
  );
});

test("includes the orchestrator, which the plan never assigns a task to", async () => {
  const service = buildService({
    roster: [
      agent("Tyrion", { type: "orchestrator" }),
      agent("Mike"),
      agent("Peter"),
    ],
    tasks: [task("t1", { assignedAgentId: "Mike" as AgentId })],
  });

  const room = await service.getRoom(workId);

  assert.equal(room.orchestrator?.name, "Tyrion");
  assert.deepEqual(
    room.agents.map((entry) => entry.name).sort(),
    ["Mike", "Tyrion"],
  );
});

test("includes an agent the events name even when it holds no task", async () => {
  const spectator: Event = {
    id: "e1" as EventId,
    organizationId,
    workId,
    agentId: "Harvey" as AgentId,
    actorType: "agent",
    type: "agent.failed",
    timestamp: now,
    payload: {},
    metadata: {},
  };

  const service = buildService({
    roster: [agent("Mike"), agent("Harvey"), agent("Peter")],
    tasks: [task("t1", { assignedAgentId: "Mike" as AgentId })],
    events: [spectator],
  });

  const room = await service.getRoom(workId);

  assert.deepEqual(
    room.agents.map((entry) => entry.name).sort(),
    ["Harvey", "Mike"],
    "Peter is on the roster but had nothing to do with this operation",
  );
});

test("the cast is read off the tasks, in order of who is working", async () => {
  const service = buildService({
    roster: [agent("Mike"), agent("Harvey")],
    tasks: [
      task("t1", { assignedAgentId: "Mike" as AgentId, status: "completed" }),
      task("t2", { assignedAgentId: "Mike" as AgentId, status: "completed" }),
      task("t3", { assignedAgentId: "Harvey" as AgentId, status: "running" }),
    ],
  });

  const room = await service.getRoom(workId);

  assert.deepEqual(
    room.cast.map((member) => member.agent.name),
    ["Harvey", "Mike"],
  );
  assert.equal(room.cast[0]?.currentTaskId, "t3");
  assert.equal(room.cast[1]?.completed, 2);
});

test("says which step is holding an agent, by task rather than by id alone", async () => {
  const service = buildService({
    roster: [agent("Mike"), agent("Harvey")],
    tasks: [
      task("research", {
        assignedAgentId: "Mike" as AgentId,
        status: "running",
      }),
      task("finance", {
        assignedAgentId: "Harvey" as AgentId,
        dependsOn: ["research" as TaskId],
      }),
    ],
  });

  const room = await service.getRoom(workId);
  const harvey = room.cast.find((member) => member.agent.name === "Harvey");

  assert.equal(harvey?.waitingOnTaskId, "research");
  assert.equal(harvey?.currentTaskId, undefined);
});

test("stops saying an agent is waiting once the dependency completes", async () => {
  const service = buildService({
    roster: [agent("Mike"), agent("Harvey")],
    tasks: [
      task("research", {
        assignedAgentId: "Mike" as AgentId,
        status: "completed",
      }),
      task("finance", {
        assignedAgentId: "Harvey" as AgentId,
        dependsOn: ["research" as TaskId],
      }),
    ],
  });

  const room = await service.getRoom(workId);
  const harvey = room.cast.find((member) => member.agent.name === "Harvey");

  assert.equal(harvey?.waitingOnTaskId, undefined);
});

test("carries the delegator's own reason rather than inventing one", async () => {
  const service = buildService({
    roster: [agent("Harvey")],
    tasks: [
      task("t1", {
        assignedAgentId: "Harvey" as AgentId,
        metadata: {
          delegation: {
            selectionReason: "holds calculation and is authorized for calculator",
            capabilityFit: "partial",
          },
        },
      }),
    ],
  });

  const room = await service.getRoom(workId);

  assert.equal(
    room.cast[0]?.selectionReason,
    "holds calculation and is authorized for calculator",
  );
  assert.equal(room.cast[0]?.stretched, true);
});

test("counts the artifacts an agent actually produced", async () => {
  const artifact = (id: string, by: string): Artifact => ({
    id: id as ArtifactId,
    organizationId,
    workId,
    createdByAgentId: by as AgentId,
    name: id,
    type: "document",
    version: 1,
    createdAt: now,
    updatedAt: now,
    metadata: {},
  });

  const service = buildService({
    roster: [agent("Mike"), agent("Peter")],
    tasks: [
      task("t1", { assignedAgentId: "Mike" as AgentId }),
      task("t2", { assignedAgentId: "Peter" as AgentId }),
    ],
    artifacts: [artifact("a1", "Mike"), artifact("a2", "Mike")],
  });

  const room = await service.getRoom(workId);

  assert.equal(
    room.cast.find((member) => member.agent.name === "Mike")?.artifactCount,
    2,
  );
  assert.equal(
    room.cast.find((member) => member.agent.name === "Peter")?.artifactCount,
    0,
  );
});

test("marks the step a pending approval is holding, in the plan itself", async () => {
  const approval: ApprovalRequest = {
    id: "ap-1" as ApprovalRequest["id"],
    organizationId,
    workId,
    taskId: "t1" as TaskId,
    action: "Send the launch email",
    resource: "task:t1",
    reason: "This would contact customers.",
    status: "pending",
    createdAt: now,
    metadata: {},
  };

  const service = buildService({
    roster: [agent("Peter")],
    tasks: [task("t1", { assignedAgentId: "Peter" as AgentId, status: "waiting" })],
    approvals: [approval],
  });

  const room = await service.getRoom(workId);

  assert.equal(room.plan.nodes[0]?.awaitingApproval, true);
});

test("a workspace belonging to another organization is not attached", async () => {
  const foreign: Workspace = {
    id: "ws-1" as WorkspaceId,
    organizationId: otherOrganizationId,
    name: "Someone else's workspace",
    slug: "theirs",
    status: "active",
    createdAt: now,
    updatedAt: now,
    metadata: {},
  };

  const service = buildService({ workspace: foreign });

  const room = await service.getRoom(workId);

  assert.equal(room.workspace, undefined);
});
