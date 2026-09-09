import assert from "node:assert/strict";
import test from "node:test";

import type {
  Agent,
  Artifact,
  Event,
  EventId,
  OrganizationId,
  Task,
  Work,
  WorkId,
} from "@unioffice/core";

import type {
  AgentRepository,
  ApprovalRepository,
  ArtifactRepository,
  EventRepository,
  MemoryRepository,
  TaskRepository,
  WorkRepository,
} from "@unioffice/database";

import { WorkQueryService } from "./work-query-service.js";

const organizationId = "organization-1" as OrganizationId;
const otherOrganizationId = "organization-2" as OrganizationId;

const workRepository: WorkRepository = {
  async create(work) { return work; },
  async findById() { return null; },
  async findByOrganization() { return []; },
  async findByWorkspace() { return []; },
  async findByStatuses() { return []; },
  async update(work) { return work; },
  async delete() {},
};

const taskRepository: TaskRepository = {
  async create(task) { return task; },
  async findById() { return null; },
  async findByAgent() { return []; },
  async findByWork() { return []; },
  async claimReadyForExecution() { return null; },
  async update(task) { return task; },
  async delete() {},
};

const artifactRepository: ArtifactRepository = {
  async create(artifact) { return artifact; },
  async findById() { return null; },
  async findByWork() { return []; },
  async findByTask() { return []; },
  async findByOrganization() { return []; },
};

const approvalRepository: ApprovalRepository = {
  async create(approval) { return approval; },
  async findById() { return null; },
  async findByWork() { return []; },
  async findPendingByOrganization() { return []; },
  async update(approval) { return approval; },
  async resolvePending(approval) { return approval; },
};

const memoryRepository: MemoryRepository = {
  async create(memory) { return memory; },
  async findById() { return null; },
  async query() { return []; },
  async update(memory) { return memory; },
  async delete() {},
};

const noAgentsRepository: AgentRepository = {
  async create(agent) { return agent; },
  async findById() { return null; },
  async findByOrganization() { return []; },
  async findByWorkspace() { return []; },
  async update(agent) { return agent; },
  async delete() {},
};

function makeEvent(overrides: Partial<Event>): Event {
  return {
    id: `event-${Math.random()}` as EventId,
    organizationId,
    actorType: "system",
    type: "task.completed",
    timestamp: new Date(),
    payload: {},
    metadata: {},
    ...overrides,
  };
}

test("getOrganizationActivity returns only events for the requested organization", async () => {
  const events = [
    makeEvent({ organizationId, timestamp: new Date("2026-01-01T00:00:00Z") }),
    makeEvent({ organizationId: otherOrganizationId, timestamp: new Date("2026-01-02T00:00:00Z") }),
    makeEvent({ organizationId, timestamp: new Date("2026-01-03T00:00:00Z") }),
  ];
  const eventRepository: EventRepository = {
    async create(event) { return event; },
    async findByWork() { return []; },
    async findByOrganization(id, limit = 50) {
      return events
        .filter((event) => event.organizationId === id)
        .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
        .slice(0, limit);
    },
  };
  const service = new WorkQueryService(
    workRepository,
    taskRepository,
    eventRepository,
    artifactRepository,
    noAgentsRepository,
    approvalRepository,
    memoryRepository,
  );

  const activity = await service.getOrganizationActivity(organizationId);

  assert.equal(activity.length, 2);
  assert.ok(activity.every((event) => event.organizationId === organizationId));
  assert.ok(activity[0]!.timestamp.getTime() > activity[1]!.timestamp.getTime());
});

test("getOrganizationActivity forwards a limit to the repository", async () => {
  let receivedLimit: number | undefined;
  const eventRepository: EventRepository = {
    async create(event) { return event; },
    async findByWork() { return []; },
    async findByOrganization(_id, limit) {
      receivedLimit = limit;
      return [];
    },
  };
  const service = new WorkQueryService(
    workRepository,
    taskRepository,
    eventRepository,
    artifactRepository,
    noAgentsRepository,
    approvalRepository,
    memoryRepository,
  );

  await service.getOrganizationActivity(organizationId, 5);

  assert.equal(receivedLimit, 5);
});

test("getAgents returns the organization's agent directory", async () => {
  const agents: Agent[] = [{
    id: "agent-1" as Agent["id"],
    organizationId,
    name: "Harvey",
    description: "Operations analysis.",
    type: "specialist",
    status: "active",
    capabilities: ["analysis"],
    toolIds: ["calculator"],
    createdAt: new Date(),
    updatedAt: new Date(),
    metadata: {},
  }];
  const agentRepository: AgentRepository = {
    async create(agent) { return agent; },
    async findById() { return null; },
    async findByOrganization(id) {
      return id === organizationId ? agents : [];
    },
    async findByWorkspace(id, workspaceId) {
      return id === organizationId
        ? agents.filter((agent) => agent.workspaceId === workspaceId)
        : [];
    },
    async update(agent) { return agent; },
    async delete() {},
  };
  const eventRepository: EventRepository = {
    async create(event) { return event; },
    async findByWork() { return []; },
    async findByOrganization() { return []; },
  };
  const service = new WorkQueryService(
    workRepository,
    taskRepository,
    eventRepository,
    artifactRepository,
    agentRepository,
    approvalRepository,
    memoryRepository,
  );

  const result = await service.getAgents(organizationId);

  assert.deepEqual(result, agents);
});

function makeWork(overrides: Partial<Work>): Work {
  const now = new Date();

  return {
    id: "work-1" as WorkId,
    organizationId,
    requesterId: "user-1" as Work["requesterId"],
    objective: "Test objective.",
    status: "queued",
    priority: "normal",
    createdAt: now,
    updatedAt: now,
    metadata: {},
    ...overrides,
  };
}

function serviceWithWork(work: Work[]): WorkQueryService {
  return new WorkQueryService(
    { ...workRepository, async findByOrganization() { return work; } },
    taskRepository,
    { async create(event) { return event; }, async findByWork() { return []; }, async findByOrganization() { return []; } },
    artifactRepository,
    noAgentsRepository,
    approvalRepository,
    memoryRepository,
  );
}

test("listWork returns organization work newest first", async () => {
  const service = serviceWithWork([
    makeWork({ id: "work-old" as WorkId, createdAt: new Date("2026-01-01T00:00:00Z") }),
    makeWork({ id: "work-new" as WorkId, createdAt: new Date("2026-03-01T00:00:00Z") }),
  ]);

  const result = await service.listWork(organizationId);

  assert.deepEqual(result.map((work) => work.id), ["work-new", "work-old"]);
});

test("listWork narrows to a single status when one is requested", async () => {
  const service = serviceWithWork([
    makeWork({ id: "work-done" as WorkId, status: "completed" }),
    makeWork({ id: "work-queued" as WorkId, status: "queued" }),
  ]);

  const result = await service.listWork(organizationId, { status: "completed" });

  assert.deepEqual(result.map((work) => work.id), ["work-done"]);
});

test("listWork applies the requested limit", async () => {
  const service = serviceWithWork([
    makeWork({ id: "work-a" as WorkId, createdAt: new Date("2026-01-03T00:00:00Z") }),
    makeWork({ id: "work-b" as WorkId, createdAt: new Date("2026-01-02T00:00:00Z") }),
    makeWork({ id: "work-c" as WorkId, createdAt: new Date("2026-01-01T00:00:00Z") }),
  ]);

  const result = await service.listWork(organizationId, { limit: 2 });

  assert.deepEqual(result.map((work) => work.id), ["work-a", "work-b"]);
});

test("getWorkDetail includes only the agents this work actually assigned", async () => {
  const assignedAgentId = "agent-assigned" as Agent["id"];
  const now = new Date();
  const agents: Agent[] = [
    {
      id: assignedAgentId,
      organizationId,
      name: "Assigned",
      description: "Works on this task.",
      type: "specialist",
      status: "active",
      capabilities: [],
      toolIds: [],
      createdAt: now,
      updatedAt: now,
      metadata: {},
    },
    {
      id: "agent-idle" as Agent["id"],
      organizationId,
      name: "Idle",
      description: "Not on this work.",
      type: "specialist",
      status: "active",
      capabilities: [],
      toolIds: [],
      createdAt: now,
      updatedAt: now,
      metadata: {},
    },
  ];
  const service = new WorkQueryService(
    { ...workRepository, async findById() { return makeWork({}); } },
    {
      ...taskRepository,
      async findByWork() {
        return [{
          id: "task-1" as Task["id"],
          workId: "work-1" as WorkId,
          title: "Task",
          description: "Task description.",
          status: "completed" as const,
          assignedAgentId,
          dependsOn: [],
          createdAt: now,
          updatedAt: now,
          metadata: {},
        }];
      },
    },
    { async create(event) { return event; }, async findByWork() { return []; }, async findByOrganization() { return []; } },
    artifactRepository,
    { ...noAgentsRepository, async findByOrganization() { return agents; } },
    approvalRepository,
    memoryRepository,
  );

  const detail = await service.getWorkDetail("work-1" as WorkId);

  assert.deepEqual(detail.agents.map((agent) => agent.id), [assignedAgentId]);
  assert.equal(detail.tasks.length, 1);
});
