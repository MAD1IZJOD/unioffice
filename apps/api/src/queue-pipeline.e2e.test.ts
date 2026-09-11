import assert from "node:assert/strict";
import test from "node:test";

import type {
  Agent,
  AgentId,
  Artifact,
  ArtifactId,
  ApprovalRequest,
  ApprovalId,
  Event,
  Memory,
  MemoryId,
  OrganizationId,
  Task,
  TaskId,
  UserId,
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

import { InMemoryExecutionJobRepository } from "@unioffice/database";

import {
  DefaultAgentRuntime,
  type ModelProvider,
  type ModelRequest,
} from "@unioffice/agents";

import { DefaultMemoryRetriever } from "@unioffice/memory";

import {
  DefaultDelegator,
  DefaultExecutionEngine,
  OllamaPlanner,
} from "@unioffice/orchestrator";

import { createDefaultToolRegistry } from "@unioffice/tools";

import { WorkApplicationService } from "./application.js";
import { CompanyBrainService } from "./company-brain-service.js";
import { EventRecorder } from "./event-recorder.js";
import { ExecutionJobRunner } from "./execution-job-runner.js";
import { ExecutionQueueService } from "./execution-queue-service.js";
import { ExecutionWorker } from "./execution-worker.js";
import { TaskExecutionService } from "./task-execution-service.js";
import { WorkApprovalService } from "./work-approval-service.js";
import { WorkExecutionService } from "./work-execution-service.js";
import { WorkRecoveryService } from "./work-recovery-service.js";
import { WorkService } from "./work-service.js";

/**
 * The durable path end to end: a request puts work on the queue, a worker in a
 * different process claims it, and the existing pipeline executes it.
 *
 * Only the model is scripted, so this runs in milliseconds and needs no
 * Ollama. The real-model tests elsewhere still cover the agent behaviour; this
 * covers the queue mechanics that sit around it.
 */

const organizationId = "11111111-1111-1111-1111-111111111111" as OrganizationId;
const requesterId = "22222222-2222-2222-2222-222222222222" as UserId;
const ledgerId = "aaaaaaaa-0000-0000-0000-000000000002" as AgentId;

function workforce(): Agent[] {
  const now = new Date();

  return [
    {
      id: ledgerId,
      organizationId,
      name: "Harvey",
      description: "Performs exact calculation.",
      type: "specialist",
      status: "active",
      capabilities: ["calculation"],
      toolIds: ["calculator", "datetime"],
      createdAt: now,
      updatedAt: now,
      metadata: {},
    },
  ];
}

class ScriptedModelProvider implements ModelProvider {
  readonly requests: ModelRequest[] = [];

  constructor(private readonly script: string[]) {}

  async generate(request: ModelRequest) {
    this.requests.push(request);
    const content = this.script.shift();

    if (content === undefined) {
      throw new Error(
        "The scripted model ran out of responses; the pipeline took an unexpected path.",
      );
    }

    return { content, model: request.model, metadata: {} };
  }
}

function harness(
  script: string[],
  options: { executeWork?: (workId: WorkId) => Promise<unknown> } = {},
) {
  const agents = workforce();
  const works = new Map<WorkId, Work>();
  const tasks = new Map<TaskId, Task>();
  const artifacts = new Map<ArtifactId, Artifact>();
  const memories = new Map<MemoryId, Memory>();
  const approvals = new Map<ApprovalId, ApprovalRequest>();
  const events: Event[] = [];

  const workRepository: WorkRepository = {
    async create(work) { works.set(work.id, work); return work; },
    async findById(id) { return works.get(id) ?? null; },
    async findByOrganization() { return [...works.values()]; },
    async findByWorkspace(_organizationId, workspaceId) {
      return [...works.values()].filter(
        (value) => value.workspaceId === workspaceId,
      );
    },
    async findByStatuses(statuses) {
      return [...works.values()].filter((w) => statuses.includes(w.status));
    },
    async update(work) { works.set(work.id, work); return work; },
    async delete(id) { works.delete(id); },
  };

  const taskRepository: TaskRepository = {
    async create(task) { tasks.set(task.id, task); return task; },
    async findById(id) { return tasks.get(id) ?? null; },
    async findByAgent(agentId) {
      return [...tasks.values()].filter(
        (value) => value.assignedAgentId === agentId,
      );
    },
    async findByWork(workId) {
      return [...tasks.values()].filter((task) => task.workId === workId);
    },
    async findByWorkIds(workIds) {
      const wanted = new Set(workIds);
      return [...tasks.values()].filter((task) => wanted.has(task.workId));
    },
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
    async findByWorkspace(_organizationId, workspaceId) {
      return agents.filter((value) => value.workspaceId === workspaceId);
    },
    async update(value) { return value; },
    async delete() {},
  };

  const artifactRepository: ArtifactRepository = {
    async create(artifact) { artifacts.set(artifact.id, artifact); return artifact; },
    async findById(id) { return artifacts.get(id) ?? null; },
    async findByWork(workId) {
      return [...artifacts.values()].filter((a) => a.workId === workId);
    },
    async findByTask(taskId) {
      return [...artifacts.values()].filter((a) => a.taskId === taskId);
    },
    async findByOrganization() { return [...artifacts.values()]; },
  };

  const memoryRepository: MemoryRepository = {
    async create(memory) { memories.set(memory.id, memory); return memory; },
    async findById(id) { return memories.get(id) ?? null; },
    async query() { return [...memories.values()]; },
    async update(memory) { memories.set(memory.id, memory); return memory; },
    async delete(id) { memories.delete(id); },
  };

  const approvalRepository: ApprovalRepository = {
    async create(approval) { approvals.set(approval.id, approval); return approval; },
    async findById(id) { return approvals.get(id) ?? null; },
    async findByWork(workId) {
      return [...approvals.values()].filter((a) => a.workId === workId);
    },
    async findPendingByOrganization() {
      return [...approvals.values()].filter((a) => a.status === "pending");
    },
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
    async findByWork() { return events; },
    async findByOrganization() { return events; },
  };

  const modelProvider = new ScriptedModelProvider(script);
  const eventRecorder = new EventRecorder(eventRepository);
  const toolRegistry = createDefaultToolRegistry();
  const jobs = new InMemoryExecutionJobRepository();

  const companyBrainService = new CompanyBrainService(
    memoryRepository,
    new DefaultMemoryRetriever(memoryRepository),
  );

  const applicationService = new WorkApplicationService(
    workRepository,
    eventRecorder,
  );

  const workService = new WorkService(
    workRepository,
    taskRepository,
    agentRepository,
    new OllamaPlanner(modelProvider, "scripted"),
    new DefaultDelegator(agentRepository),
    eventRecorder,
    toolRegistry.list().map((tool) => ({
      id: tool.id,
      name: tool.name,
      description: tool.description,
    })),
  );

  const taskExecutionService = new TaskExecutionService(
    taskRepository,
    artifactRepository,
    workRepository,
    agentRepository,
    new DefaultExecutionEngine(
      new DefaultAgentRuntime(modelProvider, {
        model: "scripted",
        toolRegistry,
        maxToolCalls: 4,
      }),
    ),
    eventRecorder,
    companyBrainService,
  );

  const workApprovalService = new WorkApprovalService(
    approvalRepository,
    taskRepository,
    workRepository,
    eventRecorder,
  );

  const realExecution = new WorkExecutionService(
    workRepository,
    taskRepository,
    taskExecutionService,
    eventRecorder,
    workApprovalService,
  );

  // Lets a test simulate a transient environmental failure without breaking
  // the rest of the pipeline.
  const workExecutionService = (
    options.executeWork
      ? { executeWork: options.executeWork }
      : realExecution
  ) as WorkExecutionService;

  const executionQueueService = new ExecutionQueueService(
    jobs,
    workRepository,
    taskRepository,
    eventRecorder,
  );

  const executionJobRunner = new ExecutionJobRunner(
    workExecutionService,
    jobs,
    workRepository,
    taskRepository,
    eventRecorder,
    { retryBackoffMs: 0 },
  );

  const workRecoveryService = new WorkRecoveryService(
    workRepository,
    taskRepository,
    eventRecorder,
  );

  function worker(workerId: string, concurrency = 1) {
    return new ExecutionWorker(jobs, executionJobRunner, {
      pollIntervalMs: 5,
      leaseMs: 60_000,
      concurrency,
      workerId,
      sleep: async () => {},
      log: () => {},
    });
  }

  return {
    jobs,
    events,
    artifacts,
    memories,
    approvals,
    workRepository,
    taskRepository,
    applicationService,
    workService,
    workApprovalService,
    workRecoveryService,
    executionQueueService,
    worker,
  };
}

function plan(tasks: Array<Record<string, unknown>>): string {
  return JSON.stringify({ tasks });
}

function toolCall(id: string, input: unknown): string {
  return JSON.stringify({ tool_call: { id, input } });
}

const calculationPlan = plan([{
  ref: "total",
  title: "Total the figures",
  description: "Add them together.",
  requiredCapabilities: ["calculation"],
  requiredTools: ["calculator"],
  requiresApproval: false,
  dependsOn: [],
}]);

async function createAndPlan(h: ReturnType<typeof harness>) {
  const work = await h.applicationService.createWork({
    organizationId,
    requesterId,
    objective: "Total our costs.",
  });

  await h.workService.planWork(work.id);
  return work;
}

test("a requested execution goes on the queue instead of running in-process", async () => {
  const h = harness([calculationPlan]);
  const work = await createAndPlan(h);

  const queued = await h.executionQueueService.enqueueWork(work.id, "requested");

  assert.equal(queued.enqueued, true);
  assert.equal(queued.job.status, "queued");
  assert.equal(queued.job.reason, "requested");
  // Nothing has executed yet: no worker has run.
  assert.equal(
    (await h.taskRepository.findByWork(work.id))[0]!.status,
    "pending",
  );
  assert.ok(h.events.some((event) => event.type === "work.queued"));
});

test("a worker claims a queued job and executes it through the real pipeline", async () => {
  const h = harness([
    calculationPlan,
    toolCall("calculator", { expression: "48200 + 9350" }),
    "The total is 57,550.",
  ]);
  const work = await createAndPlan(h);
  await h.executionQueueService.enqueueWork(work.id, "requested");

  const result = await h.worker("worker-a").tick();

  assert.equal(result.claimed, 1);
  assert.equal(result.completed, 1);

  const executed = await h.workRepository.findById(work.id);
  assert.equal(executed!.status, "completed");

  const task = (await h.taskRepository.findByWork(work.id))[0]!;
  assert.equal(task.status, "completed");
  assert.equal(task.assignedAgentId, ledgerId);

  // The existing semantics are untouched: the tool really ran, and the
  // artifact, memory and events were written exactly as before.
  const toolCalls = (task.metadata.execution as { toolCalls: unknown[] }).toolCalls;
  assert.equal(toolCalls.length, 1);
  assert.equal(h.artifacts.size, 1);
  assert.equal(h.memories.size, 1);
  assert.ok(h.events.some((event) => event.type === "tool.completed"));
  assert.ok(h.events.some((event) => event.type === "work.completed"));

  const job = await h.jobs.findActiveByWork(work.id);
  assert.equal(job, null, "the job is settled once the work completes");
});

test("enqueueing the same work twice does not execute it twice", async () => {
  const h = harness([
    calculationPlan,
    toolCall("calculator", { expression: "1 + 1" }),
    "The total is 2.",
  ]);
  const work = await createAndPlan(h);

  const first = await h.executionQueueService.enqueueWork(work.id, "requested");
  const second = await h.executionQueueService.enqueueWork(work.id, "requested");

  assert.equal(second.enqueued, false);
  assert.equal(second.job.id, first.job.id);

  const result = await h.worker("worker-a").tick();
  assert.equal(result.claimed, 1);

  // A second tick has nothing left to run, which is the point: the objective
  // executed once even though it was requested twice.
  const again = await h.worker("worker-a").tick();
  assert.equal(again.claimed, 0);
});

test("two workers racing the same queue execute the job exactly once", async () => {
  const h = harness([
    calculationPlan,
    toolCall("calculator", { expression: "2 + 2" }),
    "The total is 4.",
  ]);
  const work = await createAndPlan(h);
  await h.executionQueueService.enqueueWork(work.id, "requested");

  const [a, b] = await Promise.all([
    h.worker("worker-a").tick(),
    h.worker("worker-b").tick(),
  ]);

  assert.equal(a.claimed + b.claimed, 1);
  assert.equal(a.completed + b.completed, 1);
  assert.equal((await h.workRepository.findById(work.id))!.status, "completed");
});

test("approving a gated task enqueues durable execution rather than a background task", async () => {
  const h = harness([
    plan([{
      ref: "gated",
      title: "Spend the budget",
      description: "Consequential step.",
      requiredCapabilities: [],
      requiredTools: [],
      requiresApproval: true,
      approvalReason: "A human must sign this off.",
      dependsOn: [],
    }]),
  ]);
  const work = await createAndPlan(h);

  // Executing stops at the approval gate.
  await h.executionQueueService.enqueueWork(work.id, "requested");
  await h.worker("worker-a").tick();

  const pending = [...h.approvals.values()].find((a) => a.status === "pending");
  assert.ok(pending, "the gated task must have requested approval");

  await h.workApprovalService.approve(pending.id, "resolver-1");
  const resumed = await h.executionQueueService.enqueueWork(
    work.id,
    "approval_resumed",
  );

  assert.equal(resumed.enqueued, true);
  assert.equal(resumed.job.reason, "approval_resumed");

  const claimed = await h.jobs.claimNext({
    workerId: "worker-b",
    leaseMs: 1000,
  });
  assert.ok(claimed, "a worker must be able to pick the resumed job up");
});

test("retrying failed work enqueues a durable job", async () => {
  const h = harness([calculationPlan]);
  const work = await createAndPlan(h);

  const tasks = await h.taskRepository.findByWork(work.id);
  await h.taskRepository.update({ ...tasks[0]!, status: "failed" });
  await h.workRepository.update({
    ...(await h.workRepository.findById(work.id))!,
    status: "failed",
    metadata: { executionError: "Task failed." },
  });

  const retried = await h.workRecoveryService.retryWork(work.id);
  assert.equal(retried.mode, "resume");

  const queued = await h.executionQueueService.enqueueWork(work.id, "retry");

  assert.equal(queued.enqueued, true);
  assert.equal(queued.job.reason, "retry");

  const claimed = await h.jobs.claimNext({
    workerId: "worker-a",
    leaseMs: 1000,
  });
  assert.ok(claimed);
});

test("a transient failure is requeued and succeeds on the next attempt", async () => {
  let attempts = 0;
  const h = harness([calculationPlan], {
    executeWork: async () => {
      attempts += 1;
      if (attempts === 1) {
        throw new Error("Ollama is unreachable.");
      }
      return undefined;
    },
  });
  const work = await createAndPlan(h);
  await h.executionQueueService.enqueueWork(work.id, "requested");

  const first = await h.worker("worker-a").tick();
  assert.equal(first.requeued, 1);

  // The work itself is not condemned while the job still has attempts left -
  // an outage is not a failed objective.
  assert.notEqual((await h.workRepository.findById(work.id))!.status, "failed");

  const second = await h.worker("worker-a").tick();
  assert.equal(second.completed, 1);
  assert.equal(attempts, 2);
});

test("work is only marked failed once the queue has given up on it", async () => {
  const h = harness([calculationPlan], {
    executeWork: async () => {
      throw new Error("Ollama is unreachable.");
    },
  });
  const work = await createAndPlan(h);
  // One attempt only, so the first failure exhausts the job immediately.
  await h.jobs.enqueue({
    organizationId,
    workId: work.id,
    reason: "requested",
    maxAttempts: 1,
  });

  const result = await h.worker("worker-a").tick();

  assert.equal(result.failed, 1);
  const failed = await h.workRepository.findById(work.id);
  assert.equal(failed!.status, "failed");
  assert.match(String(failed!.metadata.executionError), /Ollama is unreachable/);
});

test("a job abandoned by a dead worker is recovered and finished by another", async () => {
  const h = harness([
    calculationPlan,
    toolCall("calculator", { expression: "3 + 3" }),
    "The total is 6.",
  ]);
  const work = await createAndPlan(h);

  // A worker claimed the job two minutes ago and died without settling it,
  // so its lease is genuinely in the past rather than being made to look
  // that way by moving the clock forward under the test.
  const died = new Date(Date.now() - 120_000);
  await h.jobs.enqueue({
    organizationId,
    workId: work.id,
    reason: "requested",
    runAt: died,
  });
  const claimed = await h.jobs.claimNext({
    workerId: "dead-worker",
    leaseMs: 1000,
    now: died,
  });
  assert.ok(claimed);

  const survivor = h.worker("worker-b");
  const recovered = await survivor.recoverAbandonedJobs();
  assert.equal(recovered.requeued, 1);

  const result = await survivor.tick();

  assert.equal(result.claimed, 1);
  assert.equal(result.completed, 1);
  assert.equal((await h.workRepository.findById(work.id))!.status, "completed");
});

test("a task left running by a dead worker is reclaimed and finished on the retry", async () => {
  // Found by pulling the plug on a worker mid-run: the task said "running",
  // the executor read that as "someone else owns this" and returned, so the
  // job was marked complete while the work never finished.
  const h = harness([
    calculationPlan,
    toolCall("calculator", { expression: "4 + 4" }),
    "The total is 8.",
  ]);
  const work = await createAndPlan(h);

  const died = new Date(Date.now() - 120_000);

  // The dead worker got as far as marking its task running, then vanished.
  // Its job is long gone, so the orphan must be reclaimed by whichever job
  // next owns this work - not only by a later attempt of the same job.
  const [task] = await h.taskRepository.findByWork(work.id);
  await h.taskRepository.update({
    ...task!,
    status: "running",
    startedAt: died,
  });

  await h.executionQueueService.enqueueWork(work.id, "requested");

  const result = await h.worker("worker-b").tick();

  assert.equal(result.completed, 1);

  const finished = await h.workRepository.findById(work.id);
  assert.equal(finished!.status, "completed");

  const finishedTask = (await h.taskRepository.findByWork(work.id))[0]!;
  assert.equal(finishedTask.status, "completed");
  assert.ok(finishedTask.result, "the reclaimed task must actually produce a result");
});
