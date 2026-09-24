import assert from "node:assert/strict";
import test from "node:test";

import type {
  OrganizationId,
  Policy,
  PolicyId,
  Task,
  TaskId,
  Work,
  WorkId,
} from "@unioffice/core";

import type { PolicyRepository } from "@unioffice/database";

import { createGitHubTools } from "@unioffice/connect";
import { createDefaultToolRegistry } from "@unioffice/tools";

import { GovernanceService, PolicyValidationError } from "./governance-service.js";
import { GovernanceToolGuard } from "./governance-tool-guard.js";

/**
 * Rules narrowed by circumstance, against the real governance service.
 *
 * Who started a mission is read from the mission row and whether a step
 * writes outside is read from the tool registry - these tests hold both to
 * that, and hold authoring to storing only conditions the engine applies.
 */

const organizationId = "aaaaaaaa-0000-4000-8000-000000000001" as OrganizationId;
const now = new Date("2026-09-24T09:00:00.000Z");

class PolicyStore {
  readonly rows = new Map<PolicyId, Policy>();
  async create(policy: Policy) { this.rows.set(policy.id, policy); return policy; }
  async update(policy: Policy) { this.rows.set(policy.id, policy); return policy; }
  async findById(id: PolicyId) { return this.rows.get(id) ?? null; }
  async findEnforced(org: OrganizationId) {
    return [...this.rows.values()].filter((row) => row.organizationId === org && row.status === "active");
  }
  async findByOrganization(org: OrganizationId) {
    return [...this.rows.values()].filter((row) => row.organizationId === org);
  }
}

function governance() {
  const registry = createDefaultToolRegistry();
  const unused = { async use() { throw new Error("not called"); } };
  for (const tool of createGitHubTools(unused)) registry.register(tool);

  const store = new PolicyStore();
  const events: Array<Record<string, unknown>> = [];
  const service = new GovernanceService(
    store as unknown as PolicyRepository,
    registry,
    { async record(event: Record<string, unknown>) { events.push(event); return event as never; } } as never,
  );

  return { service, store, events };
}

function mission(metadata: Record<string, unknown> = {}): Work {
  return {
    id: "30000000-0000-4000-8000-000000000001" as WorkId,
    organizationId,
    requesterId: "u" as never,
    objective: "Watch competitor pricing",
    status: "executing",
    priority: "normal",
    createdAt: now,
    updatedAt: now,
    metadata,
  };
}

function step(requiredTools: string[]): Task {
  return {
    id: "40000000-0000-4000-8000-000000000001" as TaskId,
    workId: mission().id,
    title: "Share the pricing summary",
    description: "",
    status: "pending",
    dependsOn: [],
    createdAt: now,
    updatedAt: now,
    metadata: { routing: { requiredTools } },
  } as Task;
}

test("a scheduled run is held by a schedule-only rule; the same step started by a person is not", async () => {
  const { service } = governance();

  await service.createPolicy({
    organizationId,
    name: "Unattended research needs a person",
    description: "Nobody is watching a scheduled run.",
    subject: "task",
    effect: "require_approval",
    risk: "medium",
    status: "active",
    scope: { toolIds: ["datetime"] },
    conditions: { startedBy: "schedule" },
    createdBy: "user:22222222-0000-4000-8000-000000000002",
  });

  const scheduled = await service.evaluateTask(mission({ startedBy: "schedule" }), step(["datetime"]), undefined);
  const attended = await service.evaluateTask(mission(), step(["datetime"]), undefined);

  assert.equal(scheduled.outcome, "require_approval");
  assert.equal(scheduled.decidingPolicyName, "Unattended research needs a person");
  assert.equal(attended.outcome, "allow");
});

test("nothing but the exact mark reads as a schedule", async () => {
  const { service } = governance();

  await service.createPolicy({
    organizationId, name: "No unattended runs", description: "", subject: "task",
    effect: "deny", risk: "high", status: "active", conditions: { startedBy: "schedule" },
  });

  for (const startedBy of ["Schedule", "scheduled", true, { kind: "schedule" }]) {
    assert.equal(
      (await service.evaluateTask(mission({ startedBy }), step([]), undefined)).outcome,
      "allow",
      JSON.stringify(startedBy),
    );
  }

  assert.equal((await service.evaluateTask(mission({ startedBy: "schedule" }), step([]), undefined)).outcome, "deny");
});

test("an external-write condition follows the registry, and the floor still holds without it", async () => {
  const { service } = governance();

  await service.createPolicy({
    organizationId, name: "Unattended outside writes are refused", description: "", subject: "task",
    effect: "deny", risk: "critical", status: "active",
    conditions: { startedBy: "schedule", writesExternally: true },
  });

  const writing = await service.evaluateTask(mission({ startedBy: "schedule" }), step(["github_create_issue"]), undefined);
  const reading = await service.evaluateTask(mission({ startedBy: "schedule" }), step(["github_issue"]), undefined);
  const attendedWrite = await service.evaluateTask(mission(), step(["github_create_issue"]), undefined);

  assert.equal(writing.outcome, "deny");
  assert.equal(reading.outcome, "allow");
  // The rule does not apply to a person's mission, and the external-write
  // floor still puts a person in front of the change.
  assert.equal(attendedWrite.outcome, "require_approval");
});

test("the tool guard answers for the mission's starter as the runtime forwards it", async () => {
  const { service } = governance();

  await service.createPolicy({
    organizationId, name: "No unattended clock", description: "", subject: "tool",
    effect: "deny", risk: "low", status: "active", scope: { toolIds: ["datetime"] },
    conditions: { startedBy: "schedule" },
  });

  const guard = new GovernanceToolGuard(service);
  const call = (startedBy?: unknown) => guard.check("datetime", {
    organizationId,
    agentId: "agent",
    workId: mission().id,
    taskId: step([]).id,
    authorizedToolIds: ["datetime"],
    approvedToolIds: [],
    metadata: { agentCapabilities: [], startedBy },
  } as never);

  assert.equal((await call("schedule")).outcome, "deny");
  assert.equal((await call(undefined)).outcome, "allow");
  assert.equal((await call("person")).outcome, "allow");
});

test("knowledge rules cannot carry conditions, and unknown condition fields are dropped", async () => {
  const { service, store } = governance();

  await assert.rejects(
    service.createPolicy({
      organizationId, name: "Scheduled recall", description: "", subject: "knowledge_recall",
      effect: "deny", risk: "low", conditions: { startedBy: "schedule" },
    }),
    PolicyValidationError,
  );

  const created = await service.createPolicy({
    organizationId, name: "Clean", description: "", subject: "task", effect: "deny", risk: "low",
    conditions: { startedBy: "schedule", amountAbove: 50_000 } as never,
  });

  assert.deepEqual(store.rows.get(created.id)!.conditions, { startedBy: "schedule" });
});

test("changing a rule records who changed it and what its conditions were", async () => {
  const { service, events } = governance();
  const editor = "user:33333333-0000-4000-8000-000000000003";

  const created = await service.createPolicy({
    organizationId, name: "Watch outside writes", description: "", subject: "task",
    effect: "require_approval", risk: "medium", conditions: { writesExternally: true },
  });

  const updated = await service.updatePolicy({
    organizationId,
    policyId: created.id,
    conditions: { startedBy: "schedule", writesExternally: true },
    updatedBy: editor,
  });

  assert.equal(updated.updatedBy, editor);
  assert.deepEqual(updated.conditions, { startedBy: "schedule", writesExternally: true });

  const line = events.at(-1)!;
  assert.equal(line.type, "policy.updated");
  assert.equal(line.actorId, editor);
  assert.deepEqual((line.payload as Record<string, unknown>).previousConditions, { writesExternally: true });

  // Leaving conditions out of an update leaves them as they were.
  const paused = await service.updatePolicy({ organizationId, policyId: created.id, status: "paused", updatedBy: editor });
  assert.deepEqual(paused.conditions, { startedBy: "schedule", writesExternally: true });
  assert.equal(events.at(-1)!.type, "policy.paused");
});

test("a rule from another organization is not found, whatever its conditions", async () => {
  const { service } = governance();
  const created = await service.createPolicy({
    organizationId, name: "Ours", description: "", subject: "task", effect: "deny", risk: "low",
  });

  await assert.rejects(
    service.updatePolicy({
      organizationId: "bbbbbbbb-0000-4000-8000-000000000002" as OrganizationId,
      policyId: created.id,
      conditions: {},
    }),
    /Policy not found/,
  );
});
