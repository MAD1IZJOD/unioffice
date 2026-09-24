import assert from "node:assert/strict";
import test from "node:test";

import {
  createEntityId,
  type ContinuousMission,
  type ContinuousMissionId,
  type ContinuousMissionRunId,
  type OrganizationId,
  type UserId,
  type Work,
  type WorkId,
} from "@unioffice/core";

import { InMemoryContinuousMissionRepository } from "./in-memory-continuous-mission-repository.js";
import { ContinuousMissionNameTakenError } from "./supabase-continuous-mission-repository.js";

const organizationId = "aaaaaaaa-0000-4000-8000-000000000001" as OrganizationId;
const ownerId = "22222222-0000-4000-8000-000000000002" as UserId;
const due = new Date("2026-09-28T03:30:00.000Z");
const after = new Date("2026-10-05T03:30:00.000Z");

function store() {
  const works = new Map<WorkId, Work>();
  const repository = new InMemoryContinuousMissionRepository({
    async create(work) { works.set(work.id, work); return work; },
    async findById(id) { return works.get(id) ?? null; },
  });

  return { repository, works };
}

function mission(overrides: Partial<ContinuousMission> = {}): ContinuousMission {
  return {
    id: createEntityId<"ContinuousMissionId">() as ContinuousMissionId,
    organizationId,
    ownerId,
    name: "Competitor pricing watch",
    objective: "Check competitor pricing and say if anything material changed.",
    briefing: "Only the three named competitors.",
    priority: "normal",
    schedule: { cadence: "weekly", dayOfWeek: 1, hour: 9, minute: 0, timezone: "Asia/Kolkata" },
    status: "active",
    nextRunAt: due,
    runCount: 0,
    createdAt: new Date("2026-09-24T00:00:00Z"),
    updatedAt: new Date("2026-09-24T00:00:00Z"),
    metadata: {},
    ...overrides,
  };
}

function scheduled(id: ContinuousMissionId, overrides: Record<string, unknown> = {}) {
  return {
    continuousMissionId: id,
    trigger: "schedule" as const,
    expectedNextRunAt: due,
    scheduledFor: due,
    nextRunAt: after,
    runId: createEntityId<"ContinuousMissionRunId">() as ContinuousMissionRunId,
    workId: createEntityId<"WorkId">() as WorkId,
    workMetadata: { startedBy: "schedule" },
    now: new Date(due.getTime() + 1_000),
    ...overrides,
  };
}

test("a due occurrence starts exactly one run, with its mission written from the instruction", async () => {
  const { repository, works } = store();
  const created = await repository.create(mission());

  const run = await repository.startRun(scheduled(created.id));

  assert.ok(run);
  assert.equal(run.sequence, 1);
  assert.equal(run.scheduledFor.getTime(), due.getTime());

  const work = works.get(run.workId)!;
  assert.equal(work.status, "queued");
  assert.equal(work.objective, created.objective);
  assert.equal(work.requesterId, ownerId);
  assert.equal(work.metadata.startedBy, "schedule");
  assert.equal(work.metadata.briefing, "Only the three named competitors.");
  assert.deepEqual(work.metadata.continuousMission, {
    id: created.id,
    name: created.name,
    sequence: 1,
    scheduledFor: due.toISOString(),
    trigger: "schedule",
  });

  const after_ = (await repository.findById(created.id))!;
  assert.equal(after_.runCount, 1);
  assert.equal(after_.nextRunAt?.getTime(), after.getTime());
});

test("the same occurrence seen twice, or by two schedulers at once, starts one run", async () => {
  const { repository, works } = store();
  const created = await repository.create(mission());

  const [first, second] = await Promise.all([
    repository.startRun(scheduled(created.id)),
    repository.startRun(scheduled(created.id)),
  ]);
  const third = await repository.startRun(scheduled(created.id));

  assert.equal([first, second, third].filter(Boolean).length, 1);
  assert.equal(repository.allRuns().length, 1);
  assert.equal(works.size, 1);
});

test("an occurrence not yet due, or a mission not active, starts nothing", async () => {
  const { repository } = store();
  const early = await repository.create(mission());

  assert.equal(await repository.startRun(scheduled(early.id, { now: new Date(due.getTime() - 1) })), null);

  const paused = await repository.create(mission({ name: "Paused one", status: "paused", pauseReason: "person", nextRunAt: undefined }));
  assert.equal(await repository.startRun(scheduled(paused.id)), null);

  // A next occurrence that does not move forward is refused, so a bad
  // calculation can never pin a mission to one instant.
  assert.equal(await repository.startRun(scheduled(early.id, { nextRunAt: due })), null);
});

test("a run asked for by hand keeps the schedule where it was", async () => {
  const { repository } = store();
  const created = await repository.create(mission());
  const now = new Date("2026-09-25T10:00:00Z");

  const run = await repository.startRun({
    ...scheduled(created.id),
    trigger: "manual",
    expectedNextRunAt: undefined,
    nextRunAt: undefined,
    scheduledFor: now,
    now,
  });

  assert.ok(run);
  assert.equal(run.trigger, "manual");
  assert.equal((await repository.findById(created.id))!.nextRunAt?.getTime(), due.getTime());
});

test("pausing, resuming and cancelling only move from the states they name", async () => {
  const { repository } = store();
  const created = await repository.create(mission());
  const now = new Date("2026-09-25T10:00:00Z");

  const paused = await repository.transition(created.id, ["active"], { status: "paused", pauseReason: "person", now });
  assert.equal(paused?.status, "paused");
  assert.equal(paused?.nextRunAt, undefined);

  // A second pause finds nothing to pause.
  assert.equal(await repository.transition(created.id, ["active"], { status: "paused", now }), null);

  const resumed = await repository.transition(created.id, ["paused"], { status: "active", nextRunAt: after, now });
  assert.equal(resumed?.status, "active");
  assert.equal(resumed?.pauseReason, undefined);

  const cancelled = await repository.transition(created.id, ["active", "paused"], { status: "cancelled", now });
  assert.equal(cancelled?.status, "cancelled");
  assert.equal(await repository.transition(created.id, ["paused"], { status: "active", nextRunAt: after, now }), null);
});

test("an active mission always has a next run, and a live name is not reused", async () => {
  const { repository } = store();

  await assert.rejects(repository.create(mission({ nextRunAt: undefined })), /next_run_check/);

  await repository.create(mission());
  await assert.rejects(repository.create(mission({ name: "  competitor PRICING watch " })), ContinuousMissionNameTakenError);
});

test("skipping moves the next run on only if nobody else did first", async () => {
  const { repository } = store();
  const created = await repository.create(mission());
  const now = new Date(due.getTime() + 1_000);

  assert.ok(await repository.advance(created.id, due, after, now));
  assert.equal(await repository.advance(created.id, due, after, now), null);
});

test("a run whose mission is still queued is found until something takes it up", async () => {
  const { repository, works } = store();
  const created = await repository.create(mission());
  const run = (await repository.startRun(scheduled(created.id)))!;

  assert.deepEqual((await repository.findRunsAwaitingQueue(10)).map((view) => view.id), [run.id]);

  works.set(run.workId, { ...works.get(run.workId)!, status: "planning" });
  assert.deepEqual(await repository.findRunsAwaitingQueue(10), []);

  const [view] = await repository.findRuns(created.id, 10);
  assert.equal(view!.workStatus, "planning");
});
