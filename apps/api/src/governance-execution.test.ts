import assert from "node:assert/strict";
import test from "node:test";

import type {
  Event,
  OrganizationId,
  Task,
  TaskId,
  Work,
  WorkId,
} from "@unioffice/core";

import type {
  EventRepository,
  TaskRepository,
  WorkRepository,
} from "@unioffice/database";

import { EventRecorder } from "./event-recorder.js";
import { WorkExecutionService } from "./work-execution-service.js";

import type { ApprovalCoordinator } from "./work-approval-service.js";
import type { TaskExecutionService } from "./task-execution-service.js";
import type {
  TaskGovernanceGate,
  TaskGovernanceOutcome,
} from "./task-governance-gate.js";

/**
 * Governance where it matters: on the execution path.
 *
 * The engine's own rules are tested in the governance package. These are
 * about the consequence - that a denial actually stops a step, that an
 * approval requirement actually routes to the durable approval system, and
 * that neither the planner nor a policy can quietly cancel the other.
 */

const organizationId = "org-1" as OrganizationId;
const workId = "work-1" as WorkId;
const now = new Date("2026-01-01T00:00:00.000Z");

function work(overrides: Partial<Work> = {}): Work {
  return {
    id: workId,
    organizationId,
    requesterId: "user-1" as Work["requesterId"],
    objective: "Do the thing",
    status: "queued",
    priority: "normal",
    createdAt: now,
    updatedAt: now,
    metadata: {},
    ...overrides,
  };
}

function task(id: string, overrides: Partial<Task> = {}): Task {
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

function outcome(
  overrides: Partial<TaskGovernanceOutcome> = {},
): TaskGovernanceOutcome {
  return {
    outcome: "allow",
    risk: "low",
    summary: "No policy applies to this step.",
    ...overrides,
  };
}

interface Harness {
  service: WorkExecutionService;
  tasks: Map<TaskId, Task>;
  events: Event[];
  approvalsRequested: Task[];
  evaluated: Task[];
}

function harness(options: {
  tasks: Task[];
  governance?: TaskGovernanceOutcome | ((task: Task) => TaskGovernanceOutcome);
  /** Omitted means no gate is configured at all, as in the old behaviour. */
  withGate?: boolean;
}): Harness {
  const store = new Map<TaskId, Task>(
    options.tasks.map((entry) => [entry.id, entry]),
  );

  let current = work();
  const events: Event[] = [];
  const approvalsRequested: Task[] = [];
  const evaluated: Task[] = [];

  const workRepository = {
    async findById() {
      return current;
    },
    async update(next: Work) {
      current = next;
      return next;
    },
  } as unknown as WorkRepository;

  const taskRepository = {
    async findByWork() {
      return [...store.values()];
    },
    async findById(id: TaskId) {
      return store.get(id) ?? null;
    },
    async update(next: Task) {
      store.set(next.id, next);
      return next;
    },
  } as unknown as TaskRepository;

  const eventRepository = {
    async create(event: Event) {
      events.push(event);
      return event;
    },
  } as unknown as EventRepository;

  // Every ready task completes. These tests are about what governance lets
  // through, not about what an agent does once it is through.
  const taskExecutionService = {
    async executeTask(id: TaskId) {
      const found = store.get(id)!;
      const completed: Task = {
        ...found,
        status: "completed",
        completedAt: now,
        result: "done",
      };
      store.set(id, completed);
      return completed;
    },
  } as unknown as TaskExecutionService;

  const approvalCoordinator: ApprovalCoordinator = {
    async requestApproval(_work, requested) {
      approvalsRequested.push(requested);
      const waiting: Task = { ...requested, status: "waiting" };
      store.set(waiting.id, waiting);
      return waiting;
    },
  };

  const gate: TaskGovernanceGate = {
    async evaluate(_work, evaluatedTask) {
      evaluated.push(evaluatedTask);

      return typeof options.governance === "function"
        ? options.governance(evaluatedTask)
        : (options.governance ?? outcome());
    },
  };

  const service = new WorkExecutionService(
    workRepository,
    taskRepository,
    taskExecutionService,
    new EventRecorder(eventRepository),
    approvalCoordinator,
    options.withGate === false ? undefined : gate,
  );

  return { service, tasks: store, events, approvalsRequested, evaluated };
}

test("an allowed step runs, and the allow is not written to the log as noise", async () => {
  const fixture = harness({ tasks: [task("t1")] });

  const result = await fixture.service.executeWork(workId);

  assert.equal(result.work.status, "completed");
  assert.equal(fixture.tasks.get("t1" as TaskId)?.status, "completed");
  assert.equal(fixture.evaluated.length, 1);
});

test("a denied step is stopped before any agent is asked to do it", async () => {
  const fixture = harness({
    tasks: [task("t1")],
    governance: outcome({
      outcome: "deny",
      risk: "high",
      summary: "Using calculator is not permitted by No external spend.",
      policyId: "policy-1",
      policyName: "No external spend",
    }),
  });

  const result = await fixture.service.executeWork(workId);

  assert.equal(result.work.status, "failed");

  const denied = fixture.tasks.get("t1" as TaskId)!;
  assert.equal(denied.status, "failed");
  assert.equal(denied.result, undefined, "nothing was produced");

  const governance = denied.metadata.governance as Record<string, unknown>;
  assert.equal(governance.outcome, "denied");
  assert.equal(governance.policyName, "No external spend");
  assert.equal(governance.risk, "high");
});

test("a denial says which rule stopped it, in the mission's own record", async () => {
  const fixture = harness({
    tasks: [task("t1")],
    governance: outcome({
      outcome: "deny",
      summary: "Using calculator is not permitted by No external spend.",
      policyName: "No external spend",
    }),
  });

  await fixture.service.executeWork(workId);

  const failure = fixture.events.find((event) => event.type === "task.failed");

  assert.ok(failure, "the denial is recorded against the task");
  assert.equal(
    failure.payload.error,
    "Using calculator is not permitted by No external spend.",
  );
  assert.equal(
    (failure.payload.governance as Record<string, unknown>).policyName,
    "No external spend",
  );
});

test("a policy requiring approval routes through the existing approval system", async () => {
  const fixture = harness({
    tasks: [task("t1")],
    governance: outcome({
      outcome: "require_approval",
      risk: "critical",
      summary: "“Task t1” needs a person to approve it under Money movement.",
      policyId: "policy-2",
      policyName: "Money movement",
      approvalPrompt: "Confirm the figures before anything is sent.",
    }),
  });

  const result = await fixture.service.executeWork(workId);

  assert.equal(result.work.status, "waiting_approval");
  assert.equal(fixture.approvalsRequested.length, 1);

  // The person deciding must read the rule, not the planner's guess.
  const requested = fixture.approvalsRequested[0]!;
  const approval = requested.metadata.approval as Record<string, unknown>;

  assert.equal(approval.reason, "Confirm the figures before anything is sent.");
  assert.equal(approval.policyName, "Money movement");
  assert.equal(approval.risk, "critical");
});

test("an approval prompt falls back to the decision when the policy has none", async () => {
  const fixture = harness({
    tasks: [task("t1")],
    governance: outcome({
      outcome: "require_approval",
      summary: "“Task t1” needs a person to approve it under Supervised work.",
      policyName: "Supervised work",
    }),
  });

  await fixture.service.executeWork(workId);

  const approval = fixture.approvalsRequested[0]!.metadata.approval as Record<
    string,
    unknown
  >;

  assert.equal(
    approval.reason,
    "“Task t1” needs a person to approve it under Supervised work.",
  );
});

test("a policy cannot wave away an approval the planner asked for", async () => {
  const fixture = harness({
    tasks: [
      task("t1", {
        metadata: {
          approval: { required: true, reason: "This contacts customers." },
        },
      }),
    ],
    // Governance is silent about this step.
    governance: outcome({ outcome: "allow" }),
  });

  const result = await fixture.service.executeWork(workId);

  assert.equal(result.work.status, "waiting_approval");
  assert.equal(fixture.approvalsRequested.length, 1);
});

test("the planner cannot skip a denial by not asking for approval", async () => {
  const fixture = harness({
    tasks: [task("t1", { metadata: { approval: { required: false } } })],
    governance: outcome({
      outcome: "deny",
      summary: "Not permitted.",
      policyName: "Hard stop",
    }),
  });

  const result = await fixture.service.executeWork(workId);

  assert.equal(result.work.status, "failed");
  assert.equal(fixture.approvalsRequested.length, 0);
});

test("a denial outranks an approval the planner asked for", async () => {
  const fixture = harness({
    tasks: [
      task("t1", {
        metadata: { approval: { required: true, reason: "Please check." } },
      }),
    ],
    governance: outcome({
      outcome: "deny",
      summary: "Not permitted at all.",
      policyName: "Hard stop",
    }),
  });

  const result = await fixture.service.executeWork(workId);

  assert.equal(result.work.status, "failed");
  assert.equal(
    fixture.approvalsRequested.length,
    0,
    "a forbidden step is never put in front of a person as a choice",
  );
});

test("governance is consulted per step, not once per mission", async () => {
  const fixture = harness({
    tasks: [task("t1"), task("t2", { dependsOn: ["t1" as TaskId] })],
  });

  await fixture.service.executeWork(workId);

  assert.deepEqual(
    fixture.evaluated.map((entry) => entry.id),
    ["t1", "t2"],
  );
});

test("only one step of a plan can be denied without stopping the others first", async () => {
  const fixture = harness({
    tasks: [task("allowed"), task("blocked")],
    governance: (entry) =>
      entry.id === "blocked"
        ? outcome({
            outcome: "deny",
            summary: "Not permitted.",
            policyName: "Hard stop",
          })
        : outcome(),
  });

  const result = await fixture.service.executeWork(workId);

  assert.equal(result.work.status, "failed");
  assert.equal(fixture.tasks.get("blocked" as TaskId)?.status, "failed");
});

test("with no gate configured, execution behaves exactly as it did before", async () => {
  const fixture = harness({
    tasks: [
      task("t1", {
        metadata: { approval: { required: true, reason: "Planner asked." } },
      }),
    ],
    withGate: false,
  });

  const result = await fixture.service.executeWork(workId);

  assert.equal(result.work.status, "waiting_approval");
  assert.equal(fixture.evaluated.length, 0);
});

test("an approved step is not gated again by the policy that required it", async () => {
  // The policy is still active and still says require_approval - that is the
  // normal state of affairs after someone approves something. Re-gating here
  // sent the mission back to waiting_approval on every pass and it never
  // finished. Found by approving a real mission and watching it loop.
  const fixture = harness({
    tasks: [
      task("t1", {
        metadata: {
          approval: {
            required: true,
            status: "approved",
            reason: "Confirm the figures before this step runs.",
          },
        },
      }),
    ],
    governance: outcome({
      outcome: "require_approval",
      summary: "Needs a person under Calculator is supervised.",
      policyName: "Calculator is supervised",
    }),
  });

  const result = await fixture.service.executeWork(workId);

  assert.equal(result.work.status, "completed");
  assert.equal(
    fixture.approvalsRequested.length,
    0,
    "the granted approval satisfies the policy",
  );
});

test("a still-pending approval is not asked for twice", async () => {
  const fixture = harness({
    tasks: [
      task("t1", {
        metadata: {
          approval: { required: true, status: "pending", requestId: "ap-1" },
        },
      }),
    ],
    governance: outcome({ outcome: "require_approval", summary: "Needs a person." }),
  });

  const result = await fixture.service.executeWork(workId);

  assert.equal(result.work.status, "waiting_approval");
  assert.equal(fixture.approvalsRequested.length, 1);
});

test("a denial still stops a step even after it was approved", async () => {
  // Approval answers "may a person allow this". It does not answer "is this
  // permitted at all", so a later deny must still bite.
  const fixture = harness({
    tasks: [
      task("t1", {
        metadata: { approval: { required: true, status: "approved" } },
      }),
    ],
    governance: outcome({
      outcome: "deny",
      summary: "No longer permitted.",
      policyName: "Hard stop",
    }),
  });

  const result = await fixture.service.executeWork(workId);

  assert.equal(result.work.status, "failed");
});
