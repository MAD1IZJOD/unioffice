import assert from "node:assert/strict";
import test from "node:test";

import {
  createEntityId,
  type Agent,
  type AgentId,
  type ApprovalId,
  type ApprovalRequest,
  type Artifact,
  type ArtifactId,
  type ContinuousMissionId,
  type ContinuousMissionRunId,
  type Event,
  type MemberId,
  type OrganizationId,
  type OrganizationMember,
  type Policy,
  type PolicyId,
  type Task,
  type TaskId,
  type UserId,
  type Work,
  type WorkId,
  type WorkspaceId,
} from "@unioffice/core";

import {
  InMemoryContinuousMissionRepository,
  InMemoryExecutionJobRepository,
  InMemoryKnowledgeRepository,
  InMemoryMembershipRepository,
  type AgentRepository,
  type ApprovalRepository,
  type ArtifactRepository,
  type EventRepository,
  type PolicyRepository,
  type TaskRepository,
  type WorkRepository,
} from "@unioffice/database";

import { DefaultAgentRuntime, type ModelProvider, type ModelRequest } from "@unioffice/agents";
import { KnowledgeExtractor } from "@unioffice/memory";
import { DefaultDelegator, DefaultExecutionEngine, OllamaPlanner } from "@unioffice/orchestrator";
import { createDefaultToolRegistry } from "@unioffice/tools";

import { ContinuousMissionScheduler } from "./continuous-mission-scheduler.js";
import { ContinuousMissionService, ContinuousMissionStateError } from "./continuous-mission-service.js";
import { EventRecorder } from "./event-recorder.js";
import { ExecutionJobRunner } from "./execution-job-runner.js";
import { ExecutionQueueService } from "./execution-queue-service.js";
import { ExecutionWorker } from "./execution-worker.js";
import { GovernanceService } from "./governance-service.js";
import { KnowledgeCaptureService } from "./knowledge-capture-service.js";
import { KnowledgeGovernance } from "./knowledge-governance.js";
import { KnowledgeRecallService } from "./knowledge-recall-service.js";
import { PolicyTaskGovernanceGate } from "./task-governance-gate.js";
import { TaskExecutionService } from "./task-execution-service.js";
import { WorkApprovalService } from "./work-approval-service.js";
import { WorkExecutionService } from "./work-execution-service.js";
import { WorkService } from "./work-service.js";

/**
 * Continuous missions end to end, through the real pipeline.
 *
 * The scheduler, the queue, the worker, planning, delegation, governance,
 * approvals and execution are the production classes; only the model is
 * scripted and the stores are in memory, with every constraint the database
 * enforces mirrored. The clock is the test's, so "due" is exact.
 */

const organizationId = "11111111-1111-4111-8111-111111111111" as OrganizationId;
const ownerId = "22222222-2222-4222-8222-222222222222" as UserId;
const ownerMemberId = "33333333-3333-4333-8333-333333333333" as MemberId;
const analystId = "aaaaaaaa-0000-4000-8000-000000000002" as AgentId;
const owner = `user:${ownerId}`;

// Thursday 24 September 2026, 12:00 UTC. The weekly schedule below is due
// on Monday 28 September at 09:00 in Kolkata, 03:30 UTC.
const start = new Date("2026-09-24T12:00:00.000Z");
const firstDue = new Date("2026-09-28T03:30:00.000Z");
const secondDue = new Date("2026-10-05T03:30:00.000Z");

class ScriptedModelProvider implements ModelProvider {
  readonly requests: ModelRequest[] = [];

  constructor(readonly script: string[]) {}

  async generate(request: ModelRequest) {
    this.requests.push(request);
    const content = this.script.shift();
    if (content === undefined) throw new Error("The scripted model ran out of responses.");
    return { content, model: request.model, metadata: {} };
  }
}

function plan(tasks: Array<Record<string, unknown>>): string {
  return JSON.stringify({ tasks });
}

function step(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ref: "check",
    title: "Compare this week's competitor prices",
    description: "Say whether anything material changed.",
    requiredCapabilities: ["analysis"],
    requiredTools: [],
    requiresApproval: false,
    dependsOn: [],
    ...overrides,
  };
}

function harness(script: string[] = []) {
  let clock = start.getTime();
  const now = () => new Date(clock);

  const agents: Agent[] = [{
    id: analystId,
    organizationId,
    name: "Priya",
    description: "Compares prices.",
    type: "specialist",
    status: "active",
    capabilities: ["analysis", "calculation"],
    toolIds: ["calculator", "datetime"],
    createdAt: start,
    updatedAt: start,
    metadata: {},
  }];

  const works = new Map<WorkId, Work>();
  const tasks = new Map<TaskId, Task>();
  const artifacts = new Map<ArtifactId, Artifact>();
  const approvals = new Map<ApprovalId, ApprovalRequest>();
  const events: Event[] = [];
  const policies: Policy[] = [];

  const workRepository: WorkRepository = {
    async create(work) { works.set(work.id, work); return work; },
    async findById(id) { return works.get(id) ?? null; },
    async findByOrganization() { return [...works.values()]; },
    async findByWorkspace() { return []; },
    async findByStatuses(statuses) { return [...works.values()].filter((w) => statuses.includes(w.status)); },
    async update(work) { works.set(work.id, work); return work; },
    async delete(id) { works.delete(id); },
    async transitionStatus(id, from, to, at) {
      const work = works.get(id);
      if (!work || work.status !== from) return null;
      const moved = { ...work, status: to, updatedAt: at };
      works.set(id, moved);
      return moved;
    },
  };

  const taskRepository: TaskRepository = {
    async create(task) { tasks.set(task.id, task); return task; },
    async findById(id) { return tasks.get(id) ?? null; },
    async findByAgent(agentId) { return [...tasks.values()].filter((t) => t.assignedAgentId === agentId); },
    async findByWork(workId) { return [...tasks.values()].filter((t) => t.workId === workId); },
    async findByWorkIds(ids) { const wanted = new Set(ids); return [...tasks.values()].filter((t) => wanted.has(t.workId)); },
    async claimReadyForExecution(id, startedAt) {
      const task = tasks.get(id);
      if (!task || task.status !== "ready") return null;
      const claimed: Task = { ...task, status: "running", startedAt, updatedAt: startedAt };
      tasks.set(id, claimed);
      return claimed;
    },
    async update(task) { tasks.set(task.id, task); return task; },
    async delete(id) { tasks.delete(id); },
  };

  const agentRepository: AgentRepository = {
    async create(value) { return value; },
    async findById(id) { return agents.find((a) => a.id === id) ?? null; },
    async findByOrganization() { return agents; },
    async findByWorkspace() { return []; },
    async update(value) { return value; },
    async delete() {},
  };

  const artifactRepository: ArtifactRepository = {
    async create(artifact) { artifacts.set(artifact.id, artifact); return artifact; },
    async findById(id) { return artifacts.get(id) ?? null; },
    async findByWork(workId) { return [...artifacts.values()].filter((a) => a.workId === workId); },
    async findByTask(taskId) { return [...artifacts.values()].filter((a) => a.taskId === taskId); },
    async findByOrganization() { return [...artifacts.values()]; },
  };

  const policyRepository: PolicyRepository = {
    async create(policy) { policies.push(policy); return policy; },
    async findById(id) { return policies.find((p) => p.id === id) ?? null; },
    async findByOrganization() { return policies; },
    async findEnforced() { return policies.filter((p) => p.status === "active"); },
    async update(policy) { return policy; },
  };

  const approvalRepository: ApprovalRepository = {
    async create(approval) { approvals.set(approval.id, approval); return approval; },
    async findById(id) { return approvals.get(id) ?? null; },
    async findByWork(workId) { return [...approvals.values()].filter((a) => a.workId === workId); },
    async findPendingByOrganization() { return [...approvals.values()].filter((a) => a.status === "pending"); },
    async update(approval) { approvals.set(approval.id, approval); return approval; },
    async resolvePending(approval) {
      const current = approvals.get(approval.id);
      if (!current || current.status !== "pending") return null;
      approvals.set(approval.id, approval);
      return approval;
    },
  };

  const eventRepository: EventRepository = {
    async create(event) { events.push(event); return event; },
    async findByWork(workId) { return events.filter((e) => e.workId === workId); },
    async findByOrganization() { return events; },
  };

  const model = new ScriptedModelProvider(script);
  const eventRecorder = new EventRecorder(eventRepository);
  const toolRegistry = createDefaultToolRegistry();
  const jobs = new InMemoryExecutionJobRepository();
  const knowledge = new InMemoryKnowledgeRepository();
  const members = new InMemoryMembershipRepository();

  const governance = new GovernanceService(policyRepository, toolRegistry, eventRecorder);
  const knowledgeGovernance = new KnowledgeGovernance(policyRepository, governance);
  const recall = new KnowledgeRecallService(knowledge, knowledge, knowledgeGovernance, eventRecorder, workRepository, taskRepository, artifactRepository);
  const capture = new KnowledgeCaptureService(knowledge, knowledge, knowledgeGovernance, eventRecorder, new KnowledgeExtractor(model, "scripted"));

  const workService = new WorkService(
    workRepository,
    taskRepository,
    agentRepository,
    new OllamaPlanner(model, "scripted"),
    new DefaultDelegator(agentRepository),
    eventRecorder,
    toolRegistry.list().map((tool) => ({ id: tool.id, name: tool.name, description: tool.description })),
    recall,
  );

  const taskExecution = new TaskExecutionService(
    taskRepository,
    artifactRepository,
    workRepository,
    agentRepository,
    new DefaultExecutionEngine(new DefaultAgentRuntime(model, { model: "scripted", toolRegistry, maxToolCalls: 4 })),
    eventRecorder,
    { recall, capture },
  );

  const approvalService = new WorkApprovalService(approvalRepository, taskRepository, workRepository, eventRecorder);

  const execution = new WorkExecutionService(
    workRepository,
    taskRepository,
    taskExecution,
    eventRecorder,
    approvalService,
    new PolicyTaskGovernanceGate(governance, agentRepository),
  );

  const queue = new ExecutionQueueService(jobs, workRepository, taskRepository, eventRecorder);
  const runner = new ExecutionJobRunner(execution, jobs, workRepository, taskRepository, eventRecorder, {
    retryBackoffMs: 0,
    planner: workService,
  });

  const missions = new InMemoryContinuousMissionRepository(workRepository);

  const reads = {
    async findEventsByTypes(_org: OrganizationId, query: { types: string[]; workIds?: WorkId[]; limit: number }) {
      return events
        .filter((event) => query.types.includes(event.type))
        .filter((event) => !query.workIds || (event.workId !== undefined && query.workIds.includes(event.workId)))
        .reverse()
        .slice(0, query.limit);
    },
  };

  const service = new ContinuousMissionService({ missions, queue, reads, eventRecorder, now });

  const scheduler = new ContinuousMissionScheduler({
    missions,
    jobs,
    queue,
    members,
    eventRecorder,
    now,
    log: () => {},
  });

  function worker(workerId = "worker-a") {
    return new ExecutionWorker(jobs, runner, {
      pollIntervalMs: 5,
      leaseMs: 60_000,
      concurrency: 1,
      workerId,
      sleep: async () => {},
      log: () => {},
      scheduler,
      schedulerIntervalMs: 0,
    });
  }

  /** One pass of a worker's loop: schedule, then claim and run. */
  async function pass(workerId?: string) {
    const w = worker(workerId);
    await w.schedule();
    return w.tick();
  }

  async function addOwner(role: OrganizationMember["role"] = "member", status: OrganizationMember["status"] = "active") {
    await members.createMember({
      id: ownerMemberId,
      organizationId,
      userId: ownerId,
      email: "owner@example.test",
      role,
      status,
      createdAt: start,
      updatedAt: start,
    } as OrganizationMember);
  }

  async function weekly(overrides: Record<string, unknown> = {}) {
    return service.create({
      organizationId,
      ownerId,
      name: "Competitor pricing watch",
      objective: "Check competitor pricing and say if anything material changed.",
      schedule: { cadence: "weekly", dayOfWeek: 1, hour: 9, minute: 0, timezone: "Asia/Kolkata" },
      createdBy: owner,
      ...overrides,
    });
  }

  function policy(overrides: Partial<Policy>): void {
    policies.push({
      id: createEntityId<"PolicyId">() as PolicyId,
      organizationId,
      name: "Rule",
      description: "",
      subject: "task",
      scope: { agentIds: [], toolIds: [], workspaceIds: [], capabilities: [] },
      effect: "deny",
      risk: "medium",
      status: "active",
      createdAt: start,
      updatedAt: start,
      metadata: {},
      ...overrides,
    });
  }

  return {
    model,
    knowledge,
    works,
    tasks,
    events,
    approvals,
    jobs,
    members,
    missions,
    service,
    scheduler,
    approvalService,
    queue,
    worker,
    pass,
    addOwner,
    weekly,
    policy,
    now,
    setClock(date: Date) { clock = date.getTime(); },
    advance(ms: number) { clock += ms; },
  };
}

type Harness = ReturnType<typeof harness>;

function runsOf(h: Harness, id: ContinuousMissionId) {
  return h.missions.findRuns(id, 50);
}

test("a new continuous mission is due at its first occurrence and starts nothing before then", async () => {
  const h = harness();
  await h.addOwner();
  const mission = await h.weekly();

  assert.equal(mission.status, "active");
  assert.equal(mission.nextRunAt?.toISOString(), firstDue.toISOString());

  h.setClock(new Date(firstDue.getTime() - 1));
  const result = await h.scheduler.tick();

  assert.deepEqual(result, { started: 0, skipped: 0, paused: 0, requeued: 0 });
  assert.equal(h.works.size, 0);
  assert.ok(h.events.some((event) => event.type === "continuous_mission.created"));
});

test("a due run is started, planned and executed through the ordinary pipeline", async () => {
  const h = harness([plan([step()]), "Prices are unchanged this week."]);
  await h.addOwner();
  const mission = await h.weekly();

  h.setClock(new Date(firstDue.getTime() + 5_000));
  const result = await h.pass();

  assert.equal(result.claimed, 1);
  assert.equal(result.completed, 1);

  const [run] = await runsOf(h, mission.id);
  assert.equal(run!.sequence, 1);
  assert.equal(run!.trigger, "schedule");
  assert.equal(run!.workStatus, "completed");

  const work = h.works.get(run!.workId)!;
  assert.equal(work.requesterId, ownerId);
  assert.equal(work.metadata.startedBy, "schedule");
  assert.equal((work.metadata.continuousMission as { sequence: number }).sequence, 1);

  // It went through the real stages, in order, on the real queue.
  const types = h.events.filter((event) => event.workId === run!.workId).map((event) => event.type);
  for (const expected of ["work.created", "continuous_mission.run_started", "work.queued", "work.planning_started", "work.planning_completed", "task.created", "work.started", "task.completed", "work.completed"]) {
    assert.ok(types.includes(expected as never), `missing ${expected}`);
  }
  assert.equal(h.jobs.all()[0]!.reason, "scheduled");

  const after = (await h.missions.findById(mission.id))!;
  assert.equal(after.runCount, 1);
  assert.equal(after.nextRunAt?.toISOString(), secondDue.toISOString());

  const detail = await h.service.get(organizationId, mission.id, { userId: ownerId });
  assert.equal(detail.runs[0]!.state, "completed");
  assert.equal(detail.latestRun?.sequence, 1);
});

test("repeated ticks and two schedulers at once start one run per occurrence", async () => {
  const h = harness();
  await h.addOwner();
  const mission = await h.weekly();

  h.setClock(new Date(firstDue.getTime() + 1_000));

  const results = await Promise.all([h.scheduler.tick(), h.scheduler.tick(), h.scheduler.tick()]);
  await h.scheduler.tick();

  assert.equal(results.reduce((sum, result) => sum + result.started, 0), 1);
  assert.equal((await runsOf(h, mission.id)).length, 1);
  assert.equal(h.works.size, 1);
  assert.equal(h.jobs.all().length, 1, "queued once");
});

test("a run started but never queued - the process died in between - is queued once on a later tick", async () => {
  const h = harness([plan([step()]), "Nothing moved."]);
  await h.addOwner();
  const mission = await h.weekly();
  h.setClock(new Date(firstDue.getTime() + 1_000));

  // What a scheduler that died after the transaction and before the enqueue
  // leaves behind: the run and its mission, and nothing on the queue.
  const run = (await h.missions.startRun({
    continuousMissionId: mission.id,
    trigger: "schedule",
    expectedNextRunAt: firstDue,
    scheduledFor: firstDue,
    nextRunAt: secondDue,
    runId: createEntityId<"ContinuousMissionRunId">() as ContinuousMissionRunId,
    workId: createEntityId<"WorkId">() as WorkId,
    workMetadata: { startedBy: "schedule" },
    now: h.now(),
  }))!;

  // Too fresh to be called stranded: whoever started it may be about to queue it.
  assert.equal((await h.scheduler.tick()).requeued, 0);

  h.advance(61_000);
  assert.equal((await h.scheduler.tick()).requeued, 1);
  assert.equal((await h.scheduler.tick()).requeued, 0, "not queued twice");

  await h.worker().tick();
  assert.equal(h.works.get(run.workId)!.status, "completed");
});

test("a worker that dies while planning leaves a run the next worker plans from scratch", async () => {
  const h = harness([plan([step()]), "Nothing moved."]);
  await h.addOwner();
  const mission = await h.weekly();
  h.setClock(new Date(firstDue.getTime() + 1_000));
  await h.scheduler.tick();

  const [run] = await runsOf(h, mission.id);

  // Planning began and the worker holding the job vanished before writing
  // any step; its lease ran out and the job went back on the queue.
  const job = (await h.jobs.claimNext({ workerId: "dead", leaseMs: 1 }))!;
  h.works.set(run!.workId, { ...h.works.get(run!.workId)!, status: "planning" });
  await new Promise((resolve) => setTimeout(resolve, 5));
  await h.jobs.recoverExpiredLeases();

  const result = await h.worker("worker-b").tick();

  assert.equal(result.completed, 1);
  assert.equal(h.works.get(run!.workId)!.status, "completed");
  assert.equal([...h.tasks.values()].filter((task) => task.workId === run!.workId).length, 1, "planned once");
  assert.ok(job.attempts >= 1);
});

test("a run found half-planned is stopped rather than planned twice, and the schedule carries on", async () => {
  const h = harness();
  await h.addOwner();
  const mission = await h.weekly();
  h.setClock(new Date(firstDue.getTime() + 1_000));
  await h.scheduler.tick();

  const [run] = await runsOf(h, mission.id);
  h.works.set(run!.workId, { ...h.works.get(run!.workId)!, status: "planning" });
  h.tasks.set("t-partial" as TaskId, {
    id: "t-partial" as TaskId,
    workId: run!.workId,
    title: "Half-written step",
    description: "",
    status: "pending",
    dependsOn: [],
    createdAt: start,
    updatedAt: start,
    metadata: {},
  } as Task);

  const result = await h.worker().tick();

  assert.equal(result.failed, 1);
  const work = h.works.get(run!.workId)!;
  assert.equal(work.status, "failed");
  assert.match(String(work.metadata.planningError), /interrupted part-way/);
  assert.equal((await h.missions.findById(mission.id))!.status, "active");
});

test("a failed run is that run's failure: the mission keeps its schedule", async () => {
  const h = harness(["this is not a plan"]);
  await h.addOwner();
  const mission = await h.weekly();
  h.setClock(new Date(firstDue.getTime() + 1_000));

  const result = await h.pass();

  assert.equal(result.failed, 1);
  const [run] = await runsOf(h, mission.id);
  assert.equal(run!.workStatus, "failed");

  const after = (await h.missions.findById(mission.id))!;
  assert.equal(after.status, "active");
  assert.equal(after.nextRunAt?.toISOString(), secondDue.toISOString());
  assert.equal((await h.service.get(organizationId, mission.id, { userId: ownerId })).runs[0]!.state, "failed");
});

test("a run that needs approval waits in Needs You, the next occurrence is skipped, and approving resumes it", async () => {
  const h = harness([
    plan([step({ requiresApproval: true, approvalReason: "The report goes outside the company." })]),
    "Sent the pricing summary.",
  ]);
  await h.addOwner();
  const mission = await h.weekly();
  h.setClock(new Date(firstDue.getTime() + 1_000));

  await h.pass();

  const [run] = await runsOf(h, mission.id);
  assert.equal(run!.workStatus, "waiting_approval");
  const pending = [...h.approvals.values()].filter((approval) => approval.status === "pending");
  assert.equal(pending.length, 1);
  assert.equal(pending[0]!.workId, run!.workId);
  assert.equal((await h.service.get(organizationId, mission.id, { userId: ownerId })).runs[0]!.state, "waiting_for_approval");

  // A week passes with nobody deciding. The next occurrence is not stacked
  // behind the waiting one; it is skipped and recorded.
  h.setClock(new Date(secondDue.getTime() + 1_000));
  const skipped = await h.scheduler.tick();
  assert.equal(skipped.skipped, 1);
  assert.equal((await runsOf(h, mission.id)).length, 1);
  assert.equal((await h.service.get(organizationId, mission.id, { userId: ownerId })).skipped, 1);

  // A person approves. The durable run resumes from the queue, as a mission
  // started by hand would.
  await h.approvalService.approve(pending[0]!.id, owner, organizationId);
  await h.queue.enqueueWork(run!.workId, "approval_resumed");
  await h.worker().tick();

  assert.equal(h.works.get(run!.workId)!.status, "completed");
  assert.equal((await h.service.get(organizationId, mission.id, { userId: ownerId })).runs[0]!.state, "completed");
});

test("a rejected approval ends the run as failed and the schedule goes on", async () => {
  const h = harness([plan([step({ requiresApproval: true, approvalReason: "A person signs off the summary." })])]);
  await h.addOwner();
  const mission = await h.weekly();
  h.setClock(new Date(firstDue.getTime() + 1_000));
  await h.pass();

  const [pending] = [...h.approvals.values()];
  await h.approvalService.reject(pending!.id, owner, organizationId);

  const [run] = await runsOf(h, mission.id);
  assert.equal(run!.workStatus, "failed");
  assert.ok(h.events.some((event) => event.type === "approval.rejected" && event.workId === run!.workId));

  const after = (await h.missions.findById(mission.id))!;
  assert.equal(after.status, "active");

  // The next occurrence runs normally.
  h.model.script.push(plan([step()]), "All the same.");
  h.setClock(new Date(secondDue.getTime() + 1_000));
  await h.pass();
  assert.equal((await runsOf(h, mission.id))[0]!.workStatus, "completed");
});

test("a rule about unattended work blocks a scheduled run and not the same run started by hand", async () => {
  const h = harness([
    plan([step({ requiredTools: ["calculator"] })]),
    plan([step({ requiredTools: ["calculator"] })]),
    JSON.stringify({ tool_call: { id: "calculator", input: { expression: "1 + 1" } } }),
    "Two.",
  ]);
  await h.addOwner();
  h.policy({
    name: "No unattended calculations",
    effect: "deny",
    scope: { agentIds: [], toolIds: ["calculator"], workspaceIds: [], capabilities: [] },
    conditions: { startedBy: "schedule" },
  });
  const mission = await h.weekly();
  h.setClock(new Date(firstDue.getTime() + 1_000));

  await h.pass();

  const detail = await h.service.get(organizationId, mission.id, { userId: ownerId });
  assert.equal(detail.runs[0]!.state, "blocked");
  assert.match(detail.runs[0]!.note ?? "", /No unattended calculations refused a step/);
  assert.ok(h.events.some((event) => event.type === "governance.denied"));

  // The owner runs it by hand: a person is there, so the rule does not apply.
  await h.service.runNow(organizationId, mission.id, owner);
  await h.worker().tick();

  const [manual] = await runsOf(h, mission.id);
  assert.equal(manual!.trigger, "manual");
  assert.equal(manual!.workStatus, "completed");
  assert.equal(h.works.get(manual!.workId)!.metadata.startedBy, undefined);
});

test("a rule requiring approval for unattended work sends a scheduled run to Needs You", async () => {
  const h = harness([plan([step()])]);
  await h.addOwner();
  h.policy({ name: "A person reads unattended work first", effect: "require_approval", conditions: { startedBy: "schedule" } });
  const mission = await h.weekly();
  h.setClock(new Date(firstDue.getTime() + 1_000));

  await h.pass();

  const [run] = await runsOf(h, mission.id);
  assert.equal(run!.workStatus, "waiting_approval");
  const [approval] = [...h.approvals.values()];
  assert.equal(approval!.status, "pending");
  assert.equal(approval!.metadata.policyName, "A person reads unattended work first");
});

test("after repeated failed runs the mission stops itself; resuming counts afresh", async () => {
  const h = harness(["no plan", "no plan", "no plan"]);
  await h.addOwner();
  const mission = await h.weekly({ schedule: { cadence: "daily", hour: 9, minute: 0, timezone: "UTC" } });

  let due = mission.nextRunAt!;
  for (let run = 0; run < 3; run += 1) {
    h.setClock(new Date(due.getTime() + 1_000));
    await h.pass();
    due = (await h.missions.findById(mission.id))!.nextRunAt!;
  }

  h.setClock(new Date(due.getTime() + 1_000));
  const result = await h.scheduler.tick();

  assert.equal(result.paused, 1);
  const paused = (await h.missions.findById(mission.id))!;
  assert.equal(paused.status, "paused");
  assert.equal(paused.pauseReason, "repeated_failures");
  assert.equal((await runsOf(h, mission.id)).length, 3, "no fourth run");

  const view = (await h.service.list(organizationId, { userId: ownerId }))[0]!;
  assert.match(view.pauseNote ?? "", /stopped itself/);

  // A person resumes it. The old failures no longer count.
  const resumed = await h.service.resume(organizationId, mission.id, owner);
  h.model.script.push(plan([step()]), "Fine now.");
  h.setClock(new Date(resumed.nextRunAt!.getTime() + 1_000));
  const again = await h.pass();

  assert.equal(again.completed, 1);
  assert.equal((await runsOf(h, mission.id))[0]!.workStatus, "completed");
});

test("a schedule never outlives its owner's permission", async () => {
  const h = harness();
  await h.addOwner("viewer");
  const mission = await h.weekly();
  h.setClock(new Date(firstDue.getTime() + 1_000));

  const result = await h.scheduler.tick();

  assert.equal(result.paused, 1);
  assert.equal(h.works.size, 0);
  const paused = (await h.missions.findById(mission.id))!;
  assert.equal(paused.pauseReason, "owner_access");
});

test("a suspended owner, or one without access to the workspace, stops it too", async () => {
  for (const setup of ["suspended", "no-grant"] as const) {
    const h = harness();
    await h.addOwner("member", setup === "suspended" ? "suspended" : "active");
    const mission = await h.weekly({ workspaceId: "ffffffff-0000-4000-8000-00000000000f" as WorkspaceId });
    h.setClock(new Date(firstDue.getTime() + 1_000));

    await h.scheduler.tick();

    assert.equal((await h.missions.findById(mission.id))!.pauseReason, "owner_access", setup);
    assert.equal(h.works.size, 0, setup);
  }
});

test("pausing stops runs; resuming starts from the next occurrence without making up missed ones", async () => {
  const h = harness();
  await h.addOwner();
  const mission = await h.weekly();

  await h.service.pause(organizationId, mission.id, owner);
  await assert.rejects(h.service.pause(organizationId, mission.id, owner), ContinuousMissionStateError);

  // Three weeks go by while it is paused.
  h.setClock(new Date("2026-10-15T12:00:00.000Z"));
  assert.equal((await h.scheduler.tick()).started, 0);

  const resumed = await h.service.resume(organizationId, mission.id, owner);
  assert.equal(resumed.nextRunAt?.toISOString(), "2026-10-19T03:30:00.000Z");
  assert.equal((await h.scheduler.tick()).started, 0, "nothing missed is replayed");

  const types = h.events.map((event) => event.type);
  assert.ok(types.includes("continuous_mission.paused"));
  assert.ok(types.includes("continuous_mission.resumed"));
});

test("a cancelled mission starts nothing more, by schedule or by hand, and keeps its runs", async () => {
  const h = harness([plan([step()]), "Unchanged."]);
  await h.addOwner();
  const mission = await h.weekly();
  h.setClock(new Date(firstDue.getTime() + 1_000));
  await h.pass();

  await h.service.cancel(organizationId, mission.id, owner);

  h.setClock(new Date(secondDue.getTime() + 1_000));
  assert.equal((await h.scheduler.tick()).started, 0);
  await assert.rejects(h.service.runNow(organizationId, mission.id, owner), /cancelled/);
  await assert.rejects(h.service.resume(organizationId, mission.id, owner), ContinuousMissionStateError);

  assert.equal((await runsOf(h, mission.id)).length, 1);
  assert.equal((await h.service.list(organizationId, { userId: ownerId })).length, 0, "cancelled ones leave the list");
});

test("run now refuses while a run is still going", async () => {
  const h = harness();
  await h.addOwner();
  const mission = await h.weekly();

  await h.service.runNow(organizationId, mission.id, owner);
  await assert.rejects(h.service.runNow(organizationId, mission.id, owner), /still going/);
  assert.equal((await runsOf(h, mission.id)).length, 1);
});

test("another organization's mission reads as not found", async () => {
  const h = harness();
  await h.addOwner();
  const mission = await h.weekly();
  const other = "99999999-0000-4000-8000-000000000009" as OrganizationId;

  for (const act of [
    () => h.service.get(other, mission.id, { userId: ownerId }),
    () => h.service.pause(other, mission.id, owner),
    () => h.service.resume(other, mission.id, owner),
    () => h.service.cancel(other, mission.id, owner),
    () => h.service.runNow(other, mission.id, owner),
  ]) {
    await assert.rejects(act(), /not found/);
  }
});

test("a schedule that cannot mean anything is refused before it is stored", async () => {
  const h = harness();

  await assert.rejects(
    h.weekly({ schedule: { cadence: "weekly", hour: 9, minute: 0, timezone: "Asia/Kolkata" } }),
    /day of the week/,
  );
  await assert.rejects(h.weekly({ name: " " }), /name is required/);
  await assert.rejects(h.weekly({ objective: "go" }), /objective must be/);
  assert.equal((await h.service.list(organizationId, { userId: ownerId })).length, 0);
});

test("the worker asks the scheduler at most once per interval", async () => {
  let ticks = 0;
  let time = 0;
  const jobs = new InMemoryExecutionJobRepository();
  const worker = new ExecutionWorker(jobs, { run: async () => ({}) } as never, {
    pollIntervalMs: 5,
    leaseMs: 60_000,
    concurrency: 1,
    scheduler: { async tick() { ticks += 1; } },
    schedulerIntervalMs: 30_000,
    clock: () => time,
    log: () => {},
  });

  await worker.schedule();
  await worker.schedule();
  time = 29_999;
  await worker.schedule();
  time = 30_000;
  await worker.schedule();

  assert.equal(ticks, 2);
});

test("a scheduler failure is logged and never stops the worker", async () => {
  const lines: string[] = [];
  const worker = new ExecutionWorker(new InMemoryExecutionJobRepository(), { run: async () => ({}) } as never, {
    pollIntervalMs: 5,
    leaseMs: 60_000,
    concurrency: 1,
    scheduler: { async tick() { throw new Error("database unreachable"); } },
    schedulerIntervalMs: 0,
    log: (line) => lines.push(line),
  });

  await worker.schedule();
  assert.match(lines.join("\n"), /Scheduler error: database unreachable/);
});

test("repeated runs that learn the same thing leave one piece of company knowledge", async () => {
  const output = [
    "Competitor pricing summary for the week.",
    "Acme kept its Starter plan at 499 rupees a month while raising Pro to 1999 rupees, the first Pro change this quarter.",
    "Nothing else on the three tracked price pages moved.",
  ].join(" ");
  const learned = JSON.stringify({
    knowledge: [{
      type: "insight",
      title: "Acme raised its Pro plan to 1999 rupees a month",
      content: "Acme kept its Starter plan at 499 rupees a month while raising Pro to 1999 rupees, the first Pro change this quarter.",
      importance: 0.7,
      confidence: 0.8,
    }],
  });

  const h = harness([plan([step()]), output, learned, plan([step()]), output, learned]);
  await h.addOwner();
  const mission = await h.weekly();

  h.setClock(new Date(firstDue.getTime() + 1_000));
  await h.pass();
  h.setClock(new Date(secondDue.getTime() + 1_000));
  await h.pass();

  const runs = await runsOf(h, mission.id);
  assert.deepEqual(runs.map((run) => run.workStatus), ["completed", "completed"]);

  // Both runs completed and both offered the same insight; the Brain kept
  // one, recorded against the run that first learned it.
  const memories = [...h.knowledge.memories.values()];
  assert.equal(memories.length, 1);
  assert.equal(memories[0]!.title, "Acme raised its Pro plan to 1999 rupees a month");
  assert.equal(memories[0]!.workId, runs[1]!.workId);
});
