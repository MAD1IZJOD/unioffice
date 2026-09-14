import assert from "node:assert/strict";
import test from "node:test";

import type {
  Event,
  EventId,
  OrganizationId,
  Task,
  TaskId,
  Work,
  WorkId,
} from "@unioffice/core";

import { InMemoryOperationalReadRepository } from "./in-memory-operational-read-repository.js";
import {
  SUMMARY_OBJECTIVE_LIMIT,
  SUMMARY_TEXT_LIMIT,
  summarizeWork,
} from "./operational-read-repository.js";

const orgA = "aaaaaaaa-0000-0000-0000-000000000001" as OrganizationId;
const orgB = "bbbbbbbb-0000-0000-0000-000000000002" as OrganizationId;
const at = (minutes: number) => new Date(Date.UTC(2026, 8, 14, 9, minutes));

function work(id: string, overrides: Partial<Work> = {}): Work {
  return {
    id: id as WorkId,
    organizationId: orgA,
    requesterId: "u" as Work["requesterId"],
    objective: `Objective ${id}`,
    status: "executing",
    priority: "normal",
    createdAt: at(0),
    updatedAt: at(0),
    metadata: {},
    ...overrides,
  };
}

function task(id: string, workId: string, minute: number): Task {
  return {
    id: id as TaskId,
    workId: workId as WorkId,
    title: `Step ${id}`,
    description: "A long description the summary never carries.",
    status: "running",
    dependsOn: [],
    createdAt: at(minute),
    updatedAt: at(minute),
    result: { huge: "x".repeat(10_000) },
    metadata: { execution: { toolCalls: [] } },
  };
}

function event(id: string, overrides: Partial<Event> = {}): Event {
  return {
    id: id as EventId,
    organizationId: orgA,
    actorType: "system",
    type: "work.completed",
    timestamp: at(0),
    payload: {},
    metadata: {},
    ...overrides,
  };
}

test("a summary carries the operational fields and never the plan, briefing or other metadata", () => {
  const summary = summarizeWork(work("w1", {
    status: "failed",
    metadata: {
      plan: { taskCount: 3 },
      briefing: "Confidential context the page never needs.",
      executionError: "  The model was unavailable.  ",
      interrupted: true,
      acknowledged: { at: at(5).toISOString(), by: "user:x" },
      missionName: "Q3 burn review",
      template: { id: "prepare-a-financial-review", version: 1, name: "Prepare a Financial Review" },
    },
  }));

  assert.equal(summary.executionError, "The model was unavailable.");
  assert.equal(summary.interrupted, true);
  assert.deepEqual(summary.acknowledgedAt, at(5));
  assert.equal(summary.missionName, "Q3 burn review");
  assert.equal(summary.templateName, "Prepare a Financial Review");
  assert.doesNotMatch(JSON.stringify(summary), /Confidential|taskCount/);
});

test("stored text is bounded, and only a real true counts as interrupted", () => {
  const summary = summarizeWork(work("w1", {
    // The shape of the oversize test rows on the live store.
    objective: "A".repeat(900_000),
    metadata: { planningError: "e".repeat(5_000), interrupted: "yes", acknowledged: { at: "not a date" } },
  }));

  assert.equal(summary.objective.length, SUMMARY_OBJECTIVE_LIMIT);
  assert.ok(summary.objective.endsWith("…"));
  assert.equal(summary.planningError?.length, SUMMARY_TEXT_LIMIT);
  assert.equal(summary.interrupted, false);
  assert.equal(summary.acknowledgedAt, undefined);
});

test("a run closed out by startup reconciliation counts as interrupted, in the shape reconciliation records", () => {
  const reconciled = summarizeWork(work("w1", {
    status: "failed",
    metadata: {
      executionError: "Execution was interrupted by an API restart. Retry to resume from where it stopped.",
      interrupted: { detectedAt: at(3).toISOString(), taskCount: 0 },
    },
  }));

  assert.equal(reconciled.interrupted, true);
  assert.equal(summarizeWork(work("w2", { metadata: { interrupted: ["yes"] } })).interrupted, false);
});

test("mission summaries stay inside the organization, newest change first, within the limit", async () => {
  const repository = new InMemoryOperationalReadRepository([
    work("old", { updatedAt: at(1) }),
    work("theirs", { organizationId: orgB, updatedAt: at(9) }),
    work("new", { updatedAt: at(7) }),
    work("middle", { updatedAt: at(4) }),
  ]);

  const summaries = await repository.findWorkSummaries(orgA, 2);

  assert.deepEqual(summaries.map((summary) => summary.id), ["new", "middle"]);
});

test("step summaries are only for the missions asked about, in the order they were planned", async () => {
  const repository = new InMemoryOperationalReadRepository(
    [],
    [task("t2", "w1", 3), task("t1", "w1", 1), task("other", "w2", 2)],
  );

  const summaries = await repository.findTaskSummaries(["w1" as WorkId]);

  assert.deepEqual(summaries.map((summary) => summary.id), ["t1", "t2"]);
  assert.doesNotMatch(JSON.stringify(summaries), /huge|description|toolCalls/);
});

test("events are filtered by type, mission and organization, newest first and bounded", async () => {
  const repository = new InMemoryOperationalReadRepository([], [], [
    event("e1", { type: "work.completed", workId: "w1" as WorkId, timestamp: at(1) }),
    event("e2", { type: "task.ready", workId: "w1" as WorkId, timestamp: at(2) }),
    event("e3", { type: "work.failed", workId: "w2" as WorkId, timestamp: at(3) }),
    event("e4", { type: "work.completed", workId: "w1" as WorkId, timestamp: at(4), organizationId: orgB }),
    event("e5", { type: "work.completed", workId: "w1" as WorkId, timestamp: at(5) }),
  ]);

  const forMission = await repository.findEventsByTypes(orgA, {
    types: ["work.completed", "work.failed"],
    workIds: ["w1" as WorkId],
    limit: 10,
  });
  assert.deepEqual(forMission.map((entry) => entry.id), ["e5", "e1"]);

  const acrossCompany = await repository.findEventsByTypes(orgA, {
    types: ["work.completed", "work.failed"],
    limit: 2,
  });
  assert.deepEqual(acrossCompany.map((entry) => entry.id), ["e5", "e3"]);
});
