import assert from "node:assert/strict";
import test from "node:test";

import type {
  Agent,
  AgentId,
  ApprovalId,
  OrganizationId,
  Task,
  TaskId,
  UserId,
  Work,
  WorkId,
} from "@unioffice/core";

import { hashProposedAction } from "@unioffice/core";
import { InMemoryActionProposalRepository } from "@unioffice/database";

import { TaskExecutionService } from "../task-execution-service.js";
import { WorkApprovalService } from "../work-approval-service.js";
import { describeAction } from "./proposal-builder.js";

const org = "aaaaaaaa-0000-4000-8000-000000000001" as OrganizationId;
const workId = "bbbbbbbb-0000-4000-8000-000000000002" as WorkId;
const taskId = "cccccccc-0000-4000-8000-000000000003" as TaskId;
const agentId = "dddddddd-0000-4000-8000-000000000004" as AgentId;
const now = new Date("2026-09-18T12:00:00.000Z");

const work: Work = {
  id: workId,
  organizationId: org,
  objective: "Close the quarter",
  requesterId: "99999999-0000-4000-8000-000000000099" as UserId,
  status: "executing",
  priority: "normal",
  createdAt: now,
  updatedAt: now,
  metadata: {},
};

const ledger: Agent = {
  id: agentId,
  organizationId: org,
  name: "Ledger",
  description: "",
  type: "specialist",
  status: "active",
  capabilities: ["financial_analysis"],
  toolIds: ["calculator"],
  skills: ["financial-analysis"],
  createdAt: now,
  updatedAt: now,
  metadata: {},
};

function step(overrides: Partial<Task> = {}, metadata: Record<string, unknown> = {}): Task {
  return {
    id: taskId,
    workId,
    title: "Analyse Q3 expenses",
    description: "Find the lines that moved.",
    status: "ready",
    assignedAgentId: agentId,
    dependsOn: [],
    createdAt: now,
    updatedAt: now,
    metadata: {
      routing: {
        requiredTools: ["calculator"],
        requiredCapabilities: ["financial_analysis"],
        skill: {
          ref: "system:financial-analysis",
          slug: "financial-analysis",
          name: "Financial analysis",
          version: 3,
          scope: "system",
          approval: "required",
          memory: "recall",
        },
      },
      ...metadata,
    },
    ...overrides,
  };
}

test("an approval names the action, not just the step", async () => {
  const proposals = new InMemoryActionProposalRepository();
  const approvals: Array<Record<string, unknown>> = [];
  const tasks = new Map<TaskId, Task>();

  const service = new WorkApprovalService(
    {
      async create(request: Record<string, unknown>) { approvals.push(request); return request; },
      async findById() { return null; },
    } as never,
    { async update(task: Task) { tasks.set(task.id, task); return task; } } as never,
    {} as never,
    { async record() { return undefined as never; } } as never,
    proposals,
    { async findById() { return ledger; } },
    (toolId) => (toolId === "calculator" ? "Calculator" : toolId),
  );

  await service.requestApproval(work, step({}, { approval: { required: true, reason: "The skill asks for a person." } }));

  const request = approvals[0]!;
  const stored = (await proposals.findByTask(taskId))[0]!;

  assert.match(
    stored.summary,
    /Ledger would carry out "Analyse Q3 expenses" following Financial analysis version 3, using Calculator\./,
  );
  assert.equal(request.action, stored.summary, "the approval says what would happen");
  assert.equal(request.resource, `proposal:${stored.id}`, "and points at that exact proposal");
  assert.equal((request.metadata as { proposalHash: string }).proposalHash, stored.hash);

  const held = tasks.get(taskId)!;
  assert.equal((held.metadata.approval as { proposalHash: string }).proposalHash, stored.hash);
});

test("the same action always describes the same way, and a changed one never does", () => {
  const unchanged = describeAction({ work, task: step(), agent: ledger });
  const again = describeAction({ work, task: step(), agent: ledger });
  assert.equal(hashProposedAction(unchanged.action), hashProposedAction(again.action));

  const drifts = [
    ["a different agent", { ...ledger, id: "eeeeeeee-0000-4000-8000-000000000005" as AgentId, name: "Harvey" }],
  ] as const;

  for (const [what, agent] of drifts) {
    assert.notEqual(
      hashProposedAction(describeAction({ work, task: step(), agent }).action),
      hashProposedAction(unchanged.action),
      `${what} is a different action`,
    );
  }

  const newerSkill = step({}, {});
  (newerSkill.metadata.routing as { skill: { version: number } }).skill.version = 4;
  assert.notEqual(
    hashProposedAction(describeAction({ work, task: newerSkill, agent: ledger }).action),
    hashProposedAction(unchanged.action),
    "a newer version of the skill is a different action",
  );

  const moreTools = step({}, {});
  (moreTools.metadata.routing as { requiredTools: string[] }).requiredTools = ["calculator", "github_issue"];
  assert.notEqual(
    hashProposedAction(describeAction({ work, task: moreTools, agent: ledger }).action),
    hashProposedAction(unchanged.action),
    "another tool is a different action",
  );

  const rewritten = describeAction({ work, task: step({ title: "Analyse Q4 expenses" }), agent: ledger });
  assert.notEqual(hashProposedAction(rewritten.action), hashProposedAction(unchanged.action));
});

function executionHarness(task: Task) {
  const tasks = new Map<TaskId, Task>([[task.id, task]]);
  const events: Array<{ type: string; payload?: Record<string, unknown> }> = [];
  let executed = 0;

  const service = new TaskExecutionService(
    {
      async findById(id: TaskId) { return tasks.get(id) ?? null; },
      async claimReadyForExecution(id: TaskId) {
        const running = { ...tasks.get(id)!, status: "running" as const };
        tasks.set(id, running);
        return running;
      },
      async update(next: Task) { tasks.set(next.id, next); return next; },
    } as never,
    { async create(artifact: unknown) { return artifact; } } as never,
    { async findById() { return work; } } as never,
    { async findById() { return ledger; } } as never,
    {
      async execute(request: { workId: WorkId; taskId: TaskId; agentId: AgentId }) {
        executed += 1;
        return { ...request, status: "completed", output: "done", toolCalls: [], metadata: {} };
      },
    } as never,
    { async record(event: { type: string }) { events.push(event); return event; } } as never,
  );

  return { service, tasks, events, executed: () => executed };
}

test("a step that changed since it was approved is put back to a person", async () => {
  const approved = step({}, {
    approval: {
      required: true,
      status: "approved",
      requestId: "eeeeeeee-0000-4000-8000-000000000009" as ApprovalId,
      proposalHash: "0".repeat(64),
    },
  });

  const harness = executionHarness(approved);
  const held = await harness.service.executeTask(taskId);

  assert.equal(harness.executed(), 0, "nothing runs on a decision that no longer covers it");
  assert.equal(held.status, "pending");
  assert.equal((held.metadata.approval as { status: string }).status, "superseded");
  assert.match(
    (held.metadata.approval as { supersededReason: string }).supersededReason,
    /has changed since it was approved/,
  );
  assert.deepEqual(harness.events.map((event) => event.type), ["approval.superseded"]);
});

test("a step that is still the action that was approved runs", async () => {
  const task = step();
  const hash = hashProposedAction(describeAction({ work, task, agent: ledger }).action);

  const harness = executionHarness(step({}, {
    approval: { required: true, status: "approved", proposalHash: hash },
  }));

  const finished = await harness.service.executeTask(taskId);

  assert.equal(harness.executed(), 1);
  assert.equal(finished.status, "completed");
});

test("a step nobody had to approve is not held up by any of this", async () => {
  const harness = executionHarness(step());

  assert.equal((await harness.service.executeTask(taskId)).status, "completed");
  assert.equal(harness.executed(), 1);
});
