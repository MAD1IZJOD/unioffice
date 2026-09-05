import assert from "node:assert/strict";
import test from "node:test";

import type {
  Artifact,
  Event,
  EventId,
  OrganizationId,
  Task,
  Work,
  WorkId,
} from "@unioffice/core";

import type {
  ArtifactRepository,
  EventRepository,
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
  async update(work) { return work; },
  async delete() {},
};

const taskRepository: TaskRepository = {
  async create(task) { return task; },
  async findById() { return null; },
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
  );

  await service.getOrganizationActivity(organizationId, 5);

  assert.equal(receivedLimit, 5);
});
