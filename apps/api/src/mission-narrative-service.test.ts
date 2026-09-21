import assert from "node:assert/strict";
import test from "node:test";

import type {
  Agent,
  AgentId,
  ApprovalId,
  ApprovalRequest,
  Artifact,
  ArtifactId,
  Event,
  EventId,
  EventType,
  OrganizationId,
  Task,
  TaskId,
  TaskStatus,
  UserId,
  Work,
  WorkId,
} from "@unioffice/core";

import { readNarrative } from "./mission-narrative-service.js";

/**
 * A mission read as an operation rather than as rows.
 *
 * Two things are being defended here. A handoff has to be real - the
 * dependency, the finished upstream step and two different people - because a
 * product that draws collaboration where there was none is lying about the
 * thing it exists to show. And an outcome has to come from what the execution
 * path recorded, never from reading the answer's prose, because a confidence
 * inferred from wording is worse than no confidence at all.
 */

const org = "aaaaaaaa-0000-4000-8000-000000000001" as OrganizationId;
const missionId = "cccccccc-0000-4000-8000-000000000001" as WorkId;
const epoch = new Date("2026-09-21T09:00:00.000Z");
const at = (minutes: number) => new Date(epoch.getTime() + minutes * 60_000);

function agent(name: string): Agent {
  return {
    id: `agent-${name.toLowerCase()}` as AgentId,
    organizationId: org,
    name,
    description: `${name} works.`,
    type: "specialist",
    status: "active",
    capabilities: ["research"],
    toolIds: ["calculator"],
    createdAt: epoch,
    updatedAt: epoch,
    metadata: { systemInstructions: "MUST-NOT-LEAVE-THE-SERVER" },
  };
}

const nova = agent("Nova");
const tony = agent("Tony");
const harvey = agent("Harvey");

function work(overrides: Partial<Work> = {}): Work {
  return {
    id: missionId,
    organizationId: org,
    requesterId: "11111111-0000-4000-8000-000000000001" as UserId,
    objective: "Decide whether the upgrade is worth it.",
    status: "completed",
    priority: "normal",
    createdAt: epoch,
    updatedAt: at(30),
    completedAt: at(30),
    metadata: {},
    ...overrides,
  };
}

function task(
  id: string,
  title: string,
  assignedTo: Agent | undefined,
  overrides: {
    status?: TaskStatus;
    dependsOn?: string[];
    minutes?: number;
    requiredToolsSatisfied?: boolean;
    requiredTools?: string[];
    skillNote?: string;
    unmatchedCapabilities?: string[];
  } = {},
): Task {
  const metadata: Record<string, unknown> = {};

  if (overrides.requiredToolsSatisfied !== undefined || overrides.skillNote) {
    metadata.execution = {
      status: "completed",
      metadata: overrides.requiredToolsSatisfied === undefined
        ? {}
        : {
            requiredTools: overrides.requiredTools ?? ["calculator"],
            requiredToolsSatisfied: overrides.requiredToolsSatisfied,
          },
      ...(overrides.skillNote ? { skillNote: overrides.skillNote } : {}),
    };
  }

  if (overrides.unmatchedCapabilities) {
    metadata.delegation = { unmatchedCapabilities: overrides.unmatchedCapabilities };
  }

  const status = overrides.status ?? "completed";

  return {
    id: id as TaskId,
    workId: missionId,
    title,
    description: `${title} in detail.`,
    status,
    assignedAgentId: assignedTo?.id,
    dependsOn: (overrides.dependsOn ?? []) as TaskId[],
    createdAt: at(overrides.minutes ?? 0),
    updatedAt: at((overrides.minutes ?? 0) + 2),
    completedAt: status === "completed" ? at((overrides.minutes ?? 0) + 2) : undefined,
    result: status === "completed" ? "the answer" : undefined,
    metadata,
  };
}

function event(type: EventType, minutes: number, extra: Partial<Event> = {}): Event {
  return {
    id: `event-${type}-${minutes}` as EventId,
    organizationId: org,
    workId: missionId,
    actorType: "system",
    type,
    timestamp: at(minutes),
    payload: {},
    metadata: {},
    ...extra,
  };
}

function artifact(id: string, taskId: string, name: string, by: Agent): Artifact {
  return {
    id: id as ArtifactId,
    organizationId: org,
    workId: missionId,
    taskId: taskId as TaskId,
    createdByAgentId: by.id,
    name,
    type: "analysis",
    version: 1,
    createdAt: at(5),
    updatedAt: at(5),
    metadata: {},
  };
}

function approval(status: ApprovalRequest["status"], action = "Send the announcement"): ApprovalRequest {
  return {
    id: "approval-1" as ApprovalId,
    organizationId: org,
    workId: missionId,
    taskId: "task-2" as TaskId,
    action,
    resource: "email",
    reason: "This leaves the company.",
    status,
    createdAt: at(10),
    resolvedAt: status === "pending" ? undefined : at(12),
    metadata: {},
  };
}

function read(input: Partial<Parameters<typeof readNarrative>[0]> = {}) {
  return readNarrative({
    work: work(),
    tasks: [],
    events: [],
    artifacts: [],
    approvals: [],
    agents: [nova, tony, harvey],
    ...input,
  });
}

/* --------------------------------------------------------------------------
   Timeline
   -------------------------------------------------------------------------- */

test("the timeline reads in order, as sentences, with the state each moment was in", () => {
  const narrative = read({
    tasks: [task("task-1", "Research the requirements", nova)],
    events: [
      event("work.created", 0),
      event("work.planning_completed", 1, { payload: { taskCount: 2 } }),
      event("work.started", 2),
      event("task.started", 3, { taskId: "task-1" as TaskId, agentId: nova.id, payload: { title: "Research the requirements" } }),
      event("task.completed", 5, { taskId: "task-1" as TaskId, agentId: nova.id, payload: { title: "Research the requirements" } }),
      event("work.completed", 6),
    ],
  });

  assert.deepEqual(
    narrative.timeline.map((entry) => entry.state),
    ["queued", "planning", "running", "running", "completed", "completed"],
  );
  assert.equal(narrative.timeline[3]!.sentence, "Nova started “Research the requirements”");
  assert.equal(narrative.timeline[3]!.agent!.name, "Nova");
  assert.equal(narrative.timeline[3]!.step, 1);

  const times = narrative.timeline.map((entry) => entry.at.getTime());
  assert.deepEqual(times, [...times].sort((a, b) => a - b), "entries must be in order");
});

test("waiting for a person is its own state, and approving it resumes", () => {
  const narrative = read({
    tasks: [task("task-1", "Send the announcement", nova, { status: "waiting" })],
    events: [
      event("approval.requested", 4, { taskId: "task-1" as TaskId, payload: { title: "Send the announcement" } }),
      event("approval.approved", 9, { taskId: "task-1" as TaskId, payload: { title: "Send the announcement" } }),
      event("work.queued", 10, { payload: { reason: "approval_resumed" } }),
    ],
  });

  // Every mission has a beginning, so the opening is always the first entry.
  assert.deepEqual(
    narrative.timeline.map((entry) => entry.state),
    ["queued", "waiting", "resumed", "resumed"],
  );
  assert.equal(narrative.timeline[3]!.sentence, "Back on the queue after a decision");
});

test("a refusal and a failure are told apart rather than both reading as stopped", () => {
  const narrative = read({
    work: work({ status: "failed" }),
    tasks: [task("task-1", "Run the numbers", nova, { status: "failed" })],
    events: [
      event("governance.denied", 3, { payload: { policyName: "No external writes", action: "send_email" } }),
      event("task.failed", 4, { taskId: "task-1" as TaskId, payload: { title: "Run the numbers" } }),
      event("work.failed", 5),
    ],
  });

  assert.deepEqual(
    narrative.timeline.map((entry) => entry.state),
    ["queued", "blocked", "failed", "failed"],
  );
});

test("a cancelled mission says so in the timeline", () => {
  const narrative = read({
    work: work({ status: "cancelled" }),
    events: [event("work.created", 0), event("work.cancelled", 3)],
  });

  assert.deepEqual(narrative.timeline.map((entry) => entry.state), ["queued", "cancelled"]);
});

test("a mission with no events at all still has a beginning", () => {
  const narrative = read({ events: [] });

  assert.equal(narrative.timeline.length, 1);
  assert.equal(narrative.timeline[0]!.state, "queued");
  assert.equal(narrative.timeline[0]!.sentence, "The mission was opened");
});

test("bookkeeping events are left out rather than rendered as their own type", () => {
  const narrative = read({
    events: [
      event("work.created", 0),
      event("tool.called", 1),
      event("tool.completed", 2),
      event("agent.updated", 3),
      event("knowledge.recalled", 4),
    ],
  });

  assert.equal(narrative.timeline.length, 1);
  assert.equal(narrative.timeline[0]!.state, "queued");
});

/* --------------------------------------------------------------------------
   Handoffs
   -------------------------------------------------------------------------- */

test("a handoff appears where one agent's finished step feeds another's", () => {
  const narrative = read({
    tasks: [
      task("task-1", "Research the requirements", nova),
      task("task-2", "Assess engineering impact", tony, { dependsOn: ["task-1"], status: "running", minutes: 5 }),
    ],
    artifacts: [artifact("artifact-1", "task-1", "Research findings", nova)],
  });

  assert.equal(narrative.handoffs.length, 1);

  const handoff = narrative.handoffs[0]!;
  assert.equal(handoff.from.name, "Nova");
  assert.equal(handoff.to.name, "Tony");
  assert.deepEqual(handoff.fromStep, { number: 1, title: "Research the requirements" });
  assert.deepEqual(handoff.toStep, { number: 2, title: "Assess engineering impact" });
  assert.equal(handoff.delivered!.name, "Research findings");
  assert.equal(handoff.state, "in_progress");
  assert.equal(handoff.sentence, "Nova finished “Research the requirements”. Tony is working from it now.");
});

test("one agent carrying on alone is not dressed up as a handoff", () => {
  const narrative = read({
    tasks: [
      task("task-1", "Work out the cost", harvey),
      task("task-2", "Write it up", harvey, { dependsOn: ["task-1"], minutes: 5 }),
    ],
  });

  assert.deepEqual(narrative.handoffs, []);
});

test("nothing is handed over until the upstream step has actually finished", () => {
  const narrative = read({
    tasks: [
      task("task-1", "Research the requirements", nova, { status: "running" }),
      task("task-2", "Assess engineering impact", tony, { dependsOn: ["task-1"], status: "pending", minutes: 5 }),
    ],
  });

  assert.deepEqual(narrative.handoffs, []);
});

test("parallel branches each produce their own handoff into the step that joins them", () => {
  const narrative = read({
    tasks: [
      task("task-1", "Gather the quotes", nova),
      task("task-2", "Measure current usage", tony, { minutes: 1 }),
      task("task-3", "Decide", harvey, { dependsOn: ["task-1", "task-2"], status: "running", minutes: 6 }),
    ],
  });

  assert.equal(narrative.handoffs.length, 2);
  assert.deepEqual(
    narrative.handoffs.map((handoff) => `${handoff.from.name}->${handoff.to.name}`),
    ["Nova->Harvey", "Tony->Harvey"],
  );
  assert.deepEqual(narrative.handoffs.map((handoff) => handoff.toStep.number), [3, 3]);
});

test("a handoff says whether the work it fed is done, running, held or stuck", () => {
  const states = (["completed", "running", "waiting", "pending"] as const).map((status) => {
    const narrative = read({
      tasks: [
        task("task-1", "Research", nova),
        task("task-2", "Assess", tony, { dependsOn: ["task-1"], status, minutes: 5 }),
      ],
    });
    return narrative.handoffs[0]!.state;
  });

  assert.deepEqual(states, ["delivered", "in_progress", "waiting", "stalled"]);
});

test("a handoff never carries a task id or an agent's instructions", () => {
  const narrative = read({
    tasks: [
      task("task-1", "Research the requirements", nova),
      task("task-2", "Assess engineering impact", tony, { dependsOn: ["task-1"], status: "running", minutes: 5 }),
    ],
    artifacts: [artifact("artifact-1", "task-1", "Research findings", nova)],
  });

  const serialized = JSON.stringify(narrative.handoffs);
  assert.equal(serialized.includes("task-1"), false);
  assert.equal(serialized.includes("MUST-NOT-LEAVE-THE-SERVER"), false);
});

/* --------------------------------------------------------------------------
   Outcome
   -------------------------------------------------------------------------- */

test("a mission that did everything it meant to is simply finished, with high confidence", () => {
  const narrative = read({
    tasks: [
      task("task-1", "Work out the cost", harvey, { requiredToolsSatisfied: true }),
      task("task-2", "Write it up", nova, { dependsOn: ["task-1"], minutes: 5 }),
    ],
  });

  assert.equal(narrative.outcome.status, "completed");
  assert.equal(narrative.outcome.label, "Finished");
  assert.deepEqual(narrative.outcome.limitations, []);
  assert.equal(narrative.outcome.confidence, "high");
});

test("a step that did not use the tool it was told to use finishes with limitations", () => {
  const narrative = read({
    tasks: [task("task-1", "Work out the cost", harvey, { requiredToolsSatisfied: false, requiredTools: ["calculator"] })],
  });

  assert.equal(narrative.outcome.status, "completed_with_limitations");
  assert.equal(narrative.outcome.label, "Finished with limitations");
  assert.equal(narrative.outcome.confidence, "limited");

  const limitation = narrative.outcome.limitations[0]!;
  assert.equal(limitation.kind, "tool_unavailable");
  assert.equal(limitation.step, 1);
  assert.match(limitation.detail, /was meant to use calculator and did not/);
});

test("a step that ran without its procedure limits the result without gutting confidence", () => {
  const narrative = read({
    tasks: [task("task-1", "Research the market", nova, {
      skillNote: "Market research is active, but no agent available to this mission holds it.",
    })],
  });

  assert.equal(narrative.outcome.status, "completed_with_limitations");
  assert.equal(narrative.outcome.limitations[0]!.kind, "procedure_missing");
  assert.equal(narrative.outcome.confidence, "moderate");
});

test("a step routed to the nearest available agent is recorded as a limitation", () => {
  const narrative = read({
    tasks: [task("task-1", "Research the market", nova, { unmatchedCapabilities: ["market_research"] })],
  });

  assert.equal(narrative.outcome.limitations[0]!.kind, "partial_match");
  assert.match(narrative.outcome.limitations[0]!.detail, /does not have market research/);
});

test("a refused decision is a limitation on the result, not a failure of it", () => {
  const narrative = read({
    tasks: [task("task-1", "Work out the cost", harvey)],
    approvals: [approval("rejected")],
  });

  assert.equal(narrative.outcome.status, "completed_with_limitations");
  assert.equal(narrative.outcome.limitations[0]!.kind, "decision_refused");
  assert.equal(narrative.outcome.confidence, "moderate");
});

test("knowledge a rule held back is reported as shaping the work", () => {
  const narrative = read({
    tasks: [task("task-1", "Work out the cost", harvey)],
    withheldKnowledge: 2,
  });

  assert.equal(narrative.outcome.limitations[0]!.kind, "knowledge_withheld");
  assert.match(narrative.outcome.limitations[0]!.detail, /2 pieces of company knowledge/);
});

test("a mission waiting on a person is blocked, and is never given a confidence", () => {
  const narrative = read({
    work: work({ status: "waiting_approval", completedAt: undefined }),
    tasks: [task("task-1", "Send it", nova, { status: "waiting" })],
    approvals: [approval("pending")],
  });

  assert.equal(narrative.outcome.status, "blocked");
  assert.equal(narrative.outcome.label, "Blocked");
  assert.equal(narrative.outcome.confidence, "unknown");
  assert.match(narrative.outcome.summary, /waiting on a person/);
});

test("a stopped mission says why without the backend's own words", () => {
  const narrative = read({
    work: work({
      status: "failed",
      completedAt: undefined,
      metadata: { executionError: "llama-server process has terminated: exit status 1: ggml_backend_cpu" },
    }),
    tasks: [task("task-1", "Work out the cost", harvey, { status: "failed" })],
  });

  assert.equal(narrative.outcome.status, "failed");
  assert.equal(narrative.outcome.confidence, "unknown");
  assert.equal(narrative.outcome.summary.includes("llama-server"), false);
  assert.equal(narrative.outcome.summary.includes("ggml"), false);
});

test("a cancelled mission names how much was left unfinished", () => {
  const narrative = read({
    work: work({ status: "cancelled", completedAt: undefined }),
    tasks: [
      task("task-1", "Work out the cost", harvey),
      task("task-2", "Write it up", nova, { status: "cancelled", minutes: 5 }),
    ],
  });

  assert.equal(narrative.outcome.status, "cancelled");
  assert.deepEqual(narrative.outcome.unfinished, ["Write it up"]);
  assert.match(narrative.outcome.summary, /1 step unfinished/);
});

test("a mission still running is never given an outcome it has not reached", () => {
  const narrative = read({
    work: work({ status: "executing", completedAt: undefined }),
    tasks: [task("task-1", "Work out the cost", harvey, { status: "running" })],
  });

  assert.equal(narrative.outcome.status, "running");
  assert.equal(narrative.outcome.confidence, "unknown");
  assert.match(narrative.outcome.confidenceReason, /not finished/);
});

test("confidence is never read out of the answer's wording", () => {
  const hedged = read({
    tasks: [{
      ...task("task-1", "Work out the cost", harvey),
      result: "I cannot determine this. The data is insufficient and I am not confident.",
    }],
  });

  // Nothing about the prose changes the verdict: the step did what it was
  // asked to, so the mission is finished and the confidence is high.
  assert.equal(hedged.outcome.status, "completed");
  assert.equal(hedged.outcome.confidence, "high");
});

test("several limitations are all reported, worst one setting the confidence", () => {
  const narrative = read({
    tasks: [
      task("task-1", "Work out the cost", harvey, { requiredToolsSatisfied: false }),
      task("task-2", "Research the market", nova, { unmatchedCapabilities: ["market_research"], minutes: 5 }),
    ],
    withheldKnowledge: 1,
  });

  assert.deepEqual(
    narrative.outcome.limitations.map((limitation) => limitation.kind),
    ["tool_unavailable", "partial_match", "knowledge_withheld"],
  );
  assert.equal(narrative.outcome.confidence, "limited");
});
