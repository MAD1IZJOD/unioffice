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
  Memory,
  MemoryId,
  OrganizationId,
  Task,
  TaskId,
  Work,
  WorkId,
} from "@unioffice/core";

import type {
  AgentRepository,
  ApprovalRepository,
  ArtifactRepository,
  EventRepository,
  MemoryQuery,
  MemoryRepository,
  TaskRepository,
  WorkRepository,
} from "@unioffice/database";

import { DefaultMemoryRetriever } from "@unioffice/memory";

import type {
  ExecutionEngine,
} from "@unioffice/orchestrator";

import {
  CompanyBrainService,
} from "./company-brain-service.js";

import {
  EventRecorder,
} from "./event-recorder.js";

import {
  TaskExecutionService,
} from "./task-execution-service.js";

import {
  WorkExecutionService,
} from "./work-execution-service.js";

import {
  ApprovalConflictError,
  WorkApprovalService,
} from "./work-approval-service.js";

const organizationId = "organization-1" as OrganizationId;
const workId = "work-1" as WorkId;
const agentId = "agent-1" as AgentId;

class MemoryTaskRepository implements TaskRepository {
  constructor(
    private readonly tasks = new Map<TaskId, Task>(),
  ) {}

  async create(task: Task): Promise<Task> {
    this.tasks.set(task.id, task);
    return task;
  }

  async findById(id: TaskId): Promise<Task | null> {
    return this.tasks.get(id) ?? null;
  }

  async findByWork(id: WorkId): Promise<Task[]> {
    return [...this.tasks.values()].filter(
      (task) => task.workId === id,
    );
  }

  async claimReadyForExecution(
    id: TaskId,
    startedAt: Date,
  ): Promise<Task | null> {
    const task = this.tasks.get(id);

    if (!task || task.status !== "ready") {
      return null;
    }

    const claimed = {
      ...task,
      status: "running" as const,
      startedAt,
      updatedAt: startedAt,
    };
    this.tasks.set(id, claimed);
    return claimed;
  }

  async update(task: Task): Promise<Task> {
    this.tasks.set(task.id, task);
    return task;
  }

  async delete(id: TaskId): Promise<void> {
    this.tasks.delete(id);
  }
}

class MemoryAgentRepository implements AgentRepository {
  constructor(
    private readonly agents = new Map<AgentId, Agent>(),
  ) {}

  async create(agent: Agent): Promise<Agent> {
    this.agents.set(agent.id, agent);
    return agent;
  }

  async findById(id: AgentId): Promise<Agent | null> {
    return this.agents.get(id) ?? null;
  }

  async findByOrganization(id: OrganizationId): Promise<Agent[]> {
    return [...this.agents.values()].filter(
      (agent) => agent.organizationId === id,
    );
  }

  async update(agent: Agent): Promise<Agent> {
    this.agents.set(agent.id, agent);
    return agent;
  }

  async delete(id: AgentId): Promise<void> {
    this.agents.delete(id);
  }
}

class MemoryWorkRepository implements WorkRepository {
  constructor(
    private readonly works = new Map<WorkId, Work>(),
  ) {}

  async create(work: Work): Promise<Work> {
    this.works.set(work.id, work);
    return work;
  }

  async findById(id: WorkId): Promise<Work | null> {
    return this.works.get(id) ?? null;
  }

  async findByOrganization(id: OrganizationId): Promise<Work[]> {
    return [...this.works.values()].filter(
      (work) => work.organizationId === id,
    );
  }

  async update(work: Work): Promise<Work> {
    this.works.set(work.id, work);
    return work;
  }

  async delete(id: WorkId): Promise<void> {
    this.works.delete(id);
  }
}

class MemoryEventRepository implements EventRepository {
  readonly events: Event[] = [];

  async create(event: Event): Promise<Event> {
    this.events.push(event);
    return event;
  }

  async findByWork(id: WorkId): Promise<Event[]> {
    return this.events.filter((event) => event.workId === id);
  }

  async findByOrganization(id: OrganizationId, limit = 50): Promise<Event[]> {
    return this.events
      .filter((event) => event.organizationId === id)
      .slice()
      .reverse()
      .slice(0, limit);
  }
}

class MemoryApprovalRepository implements ApprovalRepository {
  readonly approvals = new Map<ApprovalId, ApprovalRequest>();

  async create(approval: ApprovalRequest): Promise<ApprovalRequest> {
    this.approvals.set(approval.id, approval);
    return approval;
  }

  async findById(id: ApprovalId): Promise<ApprovalRequest | null> {
    return this.approvals.get(id) ?? null;
  }

  async findByWork(id: WorkId): Promise<ApprovalRequest[]> {
    return [...this.approvals.values()].filter(
      (approval) => approval.workId === id,
    );
  }

  async findPendingByOrganization(id: OrganizationId): Promise<ApprovalRequest[]> {
    return [...this.approvals.values()].filter(
      (approval) => approval.organizationId === id && approval.status === "pending",
    );
  }

  async update(approval: ApprovalRequest): Promise<ApprovalRequest> {
    this.approvals.set(approval.id, approval);
    return approval;
  }

  /** Mirrors the `status = pending` guard the Postgres update relies on. */
  async resolvePending(
    approval: ApprovalRequest,
  ): Promise<ApprovalRequest | null> {
    const current = this.approvals.get(approval.id);
    if (!current || current.status !== "pending") return null;
    this.approvals.set(approval.id, approval);
    return approval;
  }
}

class FakeMemoryRepository implements MemoryRepository {
  readonly memories = new Map<MemoryId, Memory>();

  async create(memory: Memory): Promise<Memory> {
    this.memories.set(memory.id, memory);
    return memory;
  }

  async findById(id: MemoryId): Promise<Memory | null> {
    return this.memories.get(id) ?? null;
  }

  async query(query: MemoryQuery): Promise<Memory[]> {
    return [...this.memories.values()]
      .filter((memory) => memory.organizationId === query.organizationId)
      .slice(0, query.limit);
  }

  async update(memory: Memory): Promise<Memory> {
    this.memories.set(memory.id, memory);
    return memory;
  }

  async delete(id: MemoryId): Promise<void> {
    this.memories.delete(id);
  }
}

class MemoryArtifactRepository implements ArtifactRepository {
  readonly artifacts = new Map<ArtifactId, Artifact>();

  async create(artifact: Artifact): Promise<Artifact> {
    this.artifacts.set(artifact.id, artifact);
    return artifact;
  }

  async findById(id: ArtifactId): Promise<Artifact | null> {
    return this.artifacts.get(id) ?? null;
  }

  async findByWork(id: WorkId): Promise<Artifact[]> {
    return [...this.artifacts.values()].filter(
      (artifact) => artifact.workId === id,
    );
  }

  async findByTask(id: TaskId): Promise<Artifact[]> {
    return [...this.artifacts.values()].filter(
      (artifact) => artifact.taskId === id,
    );
  }
}

function makeAgent(): Agent {
  const now = new Date();

  return {
    id: agentId,
    organizationId,
    name: "Atlas",
    description: "Coordinates work.",
    type: "orchestrator",
    status: "active",
    capabilities: ["planning"],
    toolIds: [],
    createdAt: now,
    updatedAt: now,
    metadata: {},
  };
}

function makeTask(
  id: TaskId,
  overrides: Partial<Task> = {},
): Task {
  const now = new Date();

  return {
    id,
    workId,
    title: id,
    description: `Complete ${id}.`,
    status: "pending",
    assignedAgentId: agentId,
    dependsOn: [],
    createdAt: now,
    updatedAt: now,
    metadata: {},
    ...overrides,
  };
}

function makeWork(): Work {
  const now = new Date();

  return {
    id: workId,
    organizationId,
    requesterId: "user-1" as Work["requesterId"],
    objective: "Complete the objective.",
    status: "queued",
    priority: "normal",
    createdAt: now,
    updatedAt: now,
    metadata: {},
  };
}

function createRecorder(): {
  recorder: EventRecorder;
  repository: MemoryEventRepository;
} {
  const repository = new MemoryEventRepository();

  return {
    recorder: new EventRecorder(repository),
    repository,
  };
}

test("persists a completed task execution result", async () => {
  const taskRepository = new MemoryTaskRepository();
  const artifactRepository = new MemoryArtifactRepository();
  const workRepository = new MemoryWorkRepository();
  const agentRepository = new MemoryAgentRepository();
  const { recorder, repository: eventRepository } =
    createRecorder();
  const task = makeTask("task-1" as TaskId, {
    status: "ready",
  });

  await taskRepository.create(task);
  await workRepository.create(makeWork());
  await agentRepository.create(makeAgent());

  const engine: ExecutionEngine = {
    async execute(request) {
      return {
        workId: request.workId,
        taskId: request.taskId,
        agentId: request.agentId,
        status: "completed",
        output: "Completed output.",
        toolCalls: [],
        metadata: { model: "test" },
      };
    },
  };
  const service = new TaskExecutionService(
    taskRepository,
    artifactRepository,
    workRepository,
    agentRepository,
    engine,
    recorder,
  );

  const result = await service.executeTask(task.id);

  assert.equal(result.status, "completed");
  assert.equal(result.result, "Completed output.");
  assert.ok(result.startedAt);
  assert.ok(result.completedAt);
  assert.equal(artifactRepository.artifacts.size, 1);
  assert.deepEqual(
    [...artifactRepository.artifacts.values()][0]?.metadata.content,
    "Completed output.",
  );
  assert.deepEqual(
    eventRepository.events.map((event) => event.type),
    ["task.started", "artifact.created", "task.completed"],
  );
});

test("records an observable event for every tool call the agent made", async () => {
  const taskRepository = new MemoryTaskRepository();
  const artifactRepository = new MemoryArtifactRepository();
  const workRepository = new MemoryWorkRepository();
  const agentRepository = new MemoryAgentRepository();
  const { recorder, repository: eventRepository } = createRecorder();
  const task = makeTask("task-tool-observability" as TaskId, { status: "ready" });

  await taskRepository.create(task);
  await workRepository.create(makeWork());
  await agentRepository.create(makeAgent());

  const engine: ExecutionEngine = {
    async execute(request) {
      return {
        workId: request.workId,
        taskId: request.taskId,
        agentId: request.agentId,
        status: "completed",
        output: "564",
        toolCalls: [
          {
            toolId: "calculator",
            input: { expression: "47 * 12" },
            output: { expression: "47 * 12", result: 564 },
            status: "completed",
            startedAt: new Date(),
            completedAt: new Date(),
          },
          {
            toolId: "calculator",
            input: { expression: "1 / 0" },
            error: { code: "TOOL_EXECUTION_FAILED", message: "Division by zero." },
            status: "failed",
            startedAt: new Date(),
            completedAt: new Date(),
          },
        ],
        metadata: {},
      };
    },
  };
  const service = new TaskExecutionService(
    taskRepository,
    artifactRepository,
    workRepository,
    agentRepository,
    engine,
    recorder,
  );

  const result = await service.executeTask(task.id);

  assert.equal(result.status, "completed");
  const toolEvents = eventRepository.events.filter((event) => event.type.startsWith("tool."));
  assert.deepEqual(toolEvents.map((event) => event.type), ["tool.completed", "tool.failed"]);
  assert.equal(toolEvents[0]?.payload.toolId, "calculator");
  assert.deepEqual(toolEvents[0]?.payload.output, { expression: "47 * 12", result: 564 });
  assert.deepEqual(toolEvents[1]?.payload.error, { code: "TOOL_EXECUTION_FAILED", message: "Division by zero." });
  assert.deepEqual(
    (result.metadata.execution as { toolCalls: unknown[] }).toolCalls.length,
    2,
  );
});

test("persists failed agent execution", async () => {
  const taskRepository = new MemoryTaskRepository();
  const artifactRepository = new MemoryArtifactRepository();
  const workRepository = new MemoryWorkRepository();
  const agentRepository = new MemoryAgentRepository();
  const { recorder, repository: eventRepository } =
    createRecorder();
  const task = makeTask("task-2" as TaskId, {
    status: "ready",
  });

  await taskRepository.create(task);
  await workRepository.create(makeWork());
  await agentRepository.create(makeAgent());

  const engine: ExecutionEngine = {
    async execute(request) {
      return {
        workId: request.workId,
        taskId: request.taskId,
        agentId: request.agentId,
        status: "failed",
        error: {
          code: "MODEL_ERROR",
          message: "Model failed.",
        },
        toolCalls: [],
        metadata: {},
      };
    },
  };
  const service = new TaskExecutionService(
    taskRepository,
    artifactRepository,
    workRepository,
    agentRepository,
    engine,
    recorder,
  );

  const result = await service.executeTask(task.id);

  assert.equal(result.status, "failed");
  assert.ok(result.completedAt);
  assert.deepEqual(
    eventRepository.events.map((event) => event.type),
    ["task.started", "task.failed"],
  );
});

test("retains a completed task result when artifact projection fails", async () => {
  const taskRepository = new MemoryTaskRepository();
  const workRepository = new MemoryWorkRepository();
  const agentRepository = new MemoryAgentRepository();
  const { recorder, repository: eventRepository } = createRecorder();
  const task = makeTask("task-artifact-failure" as TaskId, { status: "ready" });
  const artifactRepository: ArtifactRepository = {
    async create() { throw new Error("Artifact storage unavailable."); },
    async findById() { return null; },
    async findByWork() { return []; },
    async findByTask() { return []; },
  };
  const engine: ExecutionEngine = {
    async execute(request) {
      return {
        workId: request.workId,
        taskId: request.taskId,
        agentId: request.agentId,
        status: "completed",
        output: "Durable task result.",
        toolCalls: [],
        metadata: {},
      };
    },
  };
  await taskRepository.create(task);
  await workRepository.create(makeWork());
  await agentRepository.create(makeAgent());
  const service = new TaskExecutionService(
    taskRepository,
    artifactRepository,
    workRepository,
    agentRepository,
    engine,
    recorder,
  );

  const result = await service.executeTask(task.id);

  assert.equal(result.status, "completed");
  assert.equal(result.result, "Durable task result.");
  assert.deepEqual(result.metadata.artifact, {
    status: "failed",
    error: "Artifact storage unavailable.",
  });
  assert.deepEqual(
    eventRepository.events.map((event) => event.type),
    ["task.started", "task.completed"],
  );
});

test("claims a task once when execution is requested concurrently", async () => {
  const taskRepository = new MemoryTaskRepository();
  const artifactRepository = new MemoryArtifactRepository();
  const workRepository = new MemoryWorkRepository();
  const agentRepository = new MemoryAgentRepository();
  const { recorder, repository: eventRepository } = createRecorder();
  const task = makeTask("task-concurrent" as TaskId, { status: "ready" });
  let calls = 0;
  let complete: (() => void) | undefined;
  let markStarted: (() => void) | undefined;
  const release = new Promise<void>((resolve) => { complete = resolve; });
  const started = new Promise<void>((resolve) => { markStarted = resolve; });
  const engine: ExecutionEngine = {
    async execute(request) {
      calls += 1;
      markStarted?.();
      await release;
      return {
        workId: request.workId,
        taskId: request.taskId,
        agentId: request.agentId,
        status: "completed",
        output: "Only one model invocation.",
        toolCalls: [],
        metadata: {},
      };
    },
  };
  await taskRepository.create(task);
  await workRepository.create(makeWork());
  await agentRepository.create(makeAgent());
  const service = new TaskExecutionService(
    taskRepository,
    artifactRepository,
    workRepository,
    agentRepository,
    engine,
    recorder,
  );

  const first = service.executeTask(task.id);
  const second = service.executeTask(task.id);
  await started;

  assert.equal(calls, 1);
  complete?.();
  const [firstResult, secondResult] = await Promise.all([first, second]);

  assert.equal(firstResult.status, "completed");
  assert.equal(secondResult.status, "running");
  assert.equal(calls, 1);
  assert.equal(
    eventRepository.events.filter((event) => event.type === "task.started").length,
    1,
  );
});

test("executes dependencies in order and completes work", async () => {
  const workRepository = new MemoryWorkRepository();
  const taskRepository = new MemoryTaskRepository();
  const { recorder, repository: eventRepository } =
    createRecorder();
  const first = makeTask("task-research" as TaskId);
  const second = makeTask("task-brief" as TaskId, {
    dependsOn: [first.id],
  });
  const executionOrder: TaskId[] = [];

  await workRepository.create(makeWork());
  await taskRepository.create(first);
  await taskRepository.create(second);

  const taskExecutionService = {
    async executeTask(id: TaskId): Promise<Task> {
      const task = await taskRepository.findById(id);

      assert.ok(task);
      executionOrder.push(id);

      return taskRepository.update({
        ...task,
        status: "completed",
        startedAt: new Date(),
        completedAt: new Date(),
        updatedAt: new Date(),
        result: `${id} output`,
      });
    },
  } as TaskExecutionService;
  const service = new WorkExecutionService(
    workRepository,
    taskRepository,
    taskExecutionService,
    recorder,
  );

  const result = await service.executeWork(workId);

  assert.equal(result.work.status, "completed");
  assert.deepEqual(executionOrder, [first.id, second.id]);
  assert.deepEqual(
    result.tasks.map((task) => task.status),
    ["completed", "completed"],
  );
  assert.deepEqual(
    eventRepository.events
      .filter((event) => event.type.startsWith("work."))
      .map((event) => event.type),
    ["work.started", "work.completed"],
  );
  assert.equal(
    eventRepository.events.filter((event) => event.type === "task.ready").length,
    2,
  );
});

test("executes independent ready tasks concurrently", async () => {
  const workRepository = new MemoryWorkRepository();
  const taskRepository = new MemoryTaskRepository();
  const { recorder } = createRecorder();
  const first = makeTask("task-first" as TaskId);
  const second = makeTask("task-second" as TaskId);
  let activeExecutions = 0;
  let maxActiveExecutions = 0;

  await workRepository.create(makeWork());
  await taskRepository.create(first);
  await taskRepository.create(second);

  const taskExecutionService = {
    async executeTask(id: TaskId): Promise<Task> {
      const task = await taskRepository.findById(id);
      assert.ok(task);
      activeExecutions += 1;
      maxActiveExecutions = Math.max(
        maxActiveExecutions,
        activeExecutions,
      );
      await Promise.resolve();
      activeExecutions -= 1;
      return taskRepository.update({
        ...task,
        status: "completed",
        startedAt: new Date(),
        completedAt: new Date(),
        updatedAt: new Date(),
      });
    },
  } as TaskExecutionService;
  const service = new WorkExecutionService(
    workRepository,
    taskRepository,
    taskExecutionService,
    recorder,
    undefined,
    2,
  );

  const result = await service.executeWork(workId);

  assert.equal(result.work.status, "completed");
  assert.equal(maxActiveExecutions, 2);
});

test("limits independent task fan-out to the configured concurrency", async () => {
  const workRepository = new MemoryWorkRepository();
  const taskRepository = new MemoryTaskRepository();
  const { recorder } = createRecorder();
  let activeExecutions = 0;
  let maxActiveExecutions = 0;

  await workRepository.create(makeWork());
  await Promise.all(["one", "two", "three"].map(async (suffix) =>
    taskRepository.create(makeTask(`task-${suffix}` as TaskId)),
  ));

  const taskExecutionService = {
    async executeTask(id: TaskId): Promise<Task> {
      const task = await taskRepository.findById(id);
      assert.ok(task);
      activeExecutions += 1;
      maxActiveExecutions = Math.max(maxActiveExecutions, activeExecutions);
      await Promise.resolve();
      activeExecutions -= 1;
      return taskRepository.update({
        ...task,
        status: "completed",
        startedAt: new Date(),
        completedAt: new Date(),
        updatedAt: new Date(),
      });
    },
  } as TaskExecutionService;
  const service = new WorkExecutionService(
    workRepository,
    taskRepository,
    taskExecutionService,
    recorder,
    undefined,
    2,
  );

  const result = await service.executeWork(workId);

  assert.equal(result.work.status, "completed");
  assert.equal(maxActiveExecutions, 2);
});

test("pauses an approval-gated task and resumes it after approval", async () => {
  const workRepository = new MemoryWorkRepository();
  const taskRepository = new MemoryTaskRepository();
  const approvalRepository = new MemoryApprovalRepository();
  const { recorder, repository: eventRepository } = createRecorder();
  const task = makeTask("task-approval" as TaskId, {
    metadata: {
      approval: {
        required: true,
        reason: "A human must approve the proposed release.",
        status: "not_requested",
      },
    },
  });
  await workRepository.create(makeWork());
  await taskRepository.create(task);

  const taskExecutionService = {
    async executeTask(id: TaskId): Promise<Task> {
      const current = await taskRepository.findById(id);
      assert.ok(current);
      return taskRepository.update({
        ...current,
        status: "completed",
        startedAt: new Date(),
        completedAt: new Date(),
        updatedAt: new Date(),
        result: "Released after approval.",
      });
    },
  } as TaskExecutionService;
  const approvalService = new WorkApprovalService(
    approvalRepository,
    taskRepository,
    workRepository,
    recorder,
  );
  const executionService = new WorkExecutionService(
    workRepository,
    taskRepository,
    taskExecutionService,
    recorder,
    approvalService,
  );

  const paused = await executionService.executeWork(workId);
  const pending = [...approvalRepository.approvals.values()][0];

  assert.equal(paused.work.status, "waiting_approval");
  assert.equal(paused.tasks[0]?.status, "waiting");
  assert.equal(pending?.status, "pending");

  await approvalService.approve(pending!.id, "user-1");
  const resumed = await executionService.executeWork(workId);

  assert.equal(resumed.work.status, "completed");
  assert.equal(resumed.tasks[0]?.status, "completed");
  assert.deepEqual(
    eventRepository.events
      .filter((event) => event.type.startsWith("approval."))
      .map((event) => event.type),
    ["approval.requested", "approval.approved"],
  );
});

test("fails work when an approval is rejected", async () => {
  const workRepository = new MemoryWorkRepository();
  const taskRepository = new MemoryTaskRepository();
  const approvalRepository = new MemoryApprovalRepository();
  const { recorder } = createRecorder();
  const work = makeWork();
  const task = makeTask("task-reject" as TaskId, {
    status: "waiting",
    metadata: { approval: { required: true, reason: "Review", status: "pending" } },
  });
  await workRepository.create({ ...work, status: "waiting_approval" });
  await taskRepository.create(task);
  const approvalService = new WorkApprovalService(
    approvalRepository,
    taskRepository,
    workRepository,
    recorder,
  );
  const pending = await approvalService.requestApproval(work, task);
  const approvalId = (pending.metadata.approval as { requestId: ApprovalId }).requestId;

  const rejected = await approvalService.reject(approvalId, "user-1");

  assert.equal(rejected.status, "rejected");
  assert.equal((await taskRepository.findById(task.id))?.status, "failed");
  assert.equal((await workRepository.findById(work.id))?.status, "failed");
});

test("resolves a pending approval exactly once under concurrent decisions", async () => {
  const workRepository = new MemoryWorkRepository();
  const taskRepository = new MemoryTaskRepository();
  const approvalRepository = new MemoryApprovalRepository();
  const { recorder, repository: eventRepository } = createRecorder();
  const work = makeWork();
  const task = makeTask("task-race" as TaskId, {
    status: "waiting",
    metadata: { approval: { required: true, reason: "Review", status: "pending" } },
  });
  await workRepository.create({ ...work, status: "waiting_approval" });
  await taskRepository.create(task);
  const approvalService = new WorkApprovalService(
    approvalRepository,
    taskRepository,
    workRepository,
    recorder,
  );
  const pending = await approvalService.requestApproval(work, task);
  const approvalId = (pending.metadata.approval as { requestId: ApprovalId }).requestId;

  // Both deciders read the approval while it is still pending, so both clear
  // the pre-check. Only the conditional write may take effect.
  const [approveResult, rejectResult] = await Promise.allSettled([
    approvalService.approve(approvalId, "user-1"),
    approvalService.reject(approvalId, "user-2"),
  ]);

  const outcomes = [approveResult, rejectResult];
  const winners = outcomes.filter((outcome) => outcome.status === "fulfilled");
  const losers = outcomes.filter((outcome) => outcome.status === "rejected");

  assert.equal(winners.length, 1, "exactly one decision must succeed");
  assert.equal(losers.length, 1, "the losing decision must be refused");
  assert.ok(
    (losers[0] as PromiseRejectedResult).reason instanceof ApprovalConflictError,
    "the loser must surface a conflict, not a generic failure",
  );

  // The stored approval must match the winner and never be rewritten after.
  const stored = await approvalRepository.findById(approvalId);
  const winningStatus =
    approveResult.status === "fulfilled" ? "approved" : "rejected";
  assert.equal(stored?.status, winningStatus);
  assert.equal(
    stored?.resolvedBy,
    approveResult.status === "fulfilled" ? "user-1" : "user-2",
  );

  // The loser must not have produced any side effects.
  const terminalEvents = eventRepository.events
    .map((event) => event.type)
    .filter((type) => type === "approval.approved" || type === "approval.rejected");
  assert.deepEqual(terminalEvents, [`approval.${winningStatus}`]);
});

test("marks work as failed when a task fails", async () => {
  const workRepository = new MemoryWorkRepository();
  const taskRepository = new MemoryTaskRepository();
  const { recorder, repository: eventRepository } =
    createRecorder();
  const task = makeTask("task-fail" as TaskId);

  await workRepository.create(makeWork());
  await taskRepository.create(task);

  const taskExecutionService = {
    async executeTask(id: TaskId): Promise<Task> {
      const current = await taskRepository.findById(id);

      assert.ok(current);

      return taskRepository.update({
        ...current,
        status: "failed",
        completedAt: new Date(),
        updatedAt: new Date(),
      });
    },
  } as TaskExecutionService;
  const service = new WorkExecutionService(
    workRepository,
    taskRepository,
    taskExecutionService,
    recorder,
  );

  const result = await service.executeWork(workId);

  assert.equal(result.work.status, "failed");
  assert.equal(
    eventRepository.events.at(-1)?.type,
    "work.failed",
  );
});

test("returns an already completed work item without re-executing tasks", async () => {
  const workRepository = new MemoryWorkRepository();
  const taskRepository = new MemoryTaskRepository();
  const { recorder, repository: eventRepository } = createRecorder();
  const work = { ...makeWork(), status: "completed" as const };
  const task = makeTask("task-completed" as TaskId, { status: "completed" });
  await workRepository.create(work);
  await taskRepository.create(task);
  const taskExecutionService = {
    async executeTask(): Promise<Task> {
      throw new Error("A completed work item must not execute again.");
    },
  } as unknown as TaskExecutionService;
  const service = new WorkExecutionService(
    workRepository,
    taskRepository,
    taskExecutionService,
    recorder,
  );

  const result = await service.executeWork(work.id);

  assert.equal(result.work.status, "completed");
  assert.equal(result.tasks[0]?.id, task.id);
  assert.equal(eventRepository.events.length, 0);
});

test("records a company memory when a task completes and surfaces it to a later related task", async () => {
  const taskRepository = new MemoryTaskRepository();
  const artifactRepository = new MemoryArtifactRepository();
  const workRepository = new MemoryWorkRepository();
  const agentRepository = new MemoryAgentRepository();
  const memoryRepository = new FakeMemoryRepository();
  const companyBrainService = new CompanyBrainService(
    memoryRepository,
    new DefaultMemoryRetriever(memoryRepository),
  );
  const { recorder, repository: eventRepository } = createRecorder();
  const firstTask = makeTask("task-onboarding-1" as TaskId, {
    title: "Draft onboarding SSO plan",
    status: "ready",
  });
  await taskRepository.create(firstTask);
  await workRepository.create(makeWork());
  await agentRepository.create(makeAgent());

  const completingEngine: ExecutionEngine = {
    async execute(request) {
      return {
        workId: request.workId,
        taskId: request.taskId,
        agentId: request.agentId,
        status: "completed",
        output: "SSO is required for enterprise onboarding.",
        toolCalls: [],
        metadata: {},
      };
    },
  };
  const firstService = new TaskExecutionService(
    taskRepository,
    artifactRepository,
    workRepository,
    agentRepository,
    completingEngine,
    recorder,
    companyBrainService,
  );

  await firstService.executeTask(firstTask.id);

  assert.equal(memoryRepository.memories.size, 1);
  const stored = [...memoryRepository.memories.values()][0];
  assert.equal(stored?.type, "experience");
  assert.match(stored?.content ?? "", /SSO is required for enterprise onboarding/);

  let capturedContext: Record<string, unknown> | undefined;
  const secondTask = makeTask("task-onboarding-2" as TaskId, {
    title: "Review onboarding SSO requirements",
    status: "ready",
  });
  await taskRepository.create(secondTask);
  const observingEngine: ExecutionEngine = {
    async execute(request) {
      capturedContext = request.context;
      return {
        workId: request.workId,
        taskId: request.taskId,
        agentId: request.agentId,
        status: "completed",
        output: "Reviewed.",
        toolCalls: [],
        metadata: {},
      };
    },
  };
  const secondService = new TaskExecutionService(
    taskRepository,
    artifactRepository,
    workRepository,
    agentRepository,
    observingEngine,
    recorder,
    companyBrainService,
  );

  await secondService.executeTask(secondTask.id);

  const relevantMemory = capturedContext?.relevantMemory as Array<{ content: string }> | undefined;
  assert.ok(relevantMemory && relevantMemory.length > 0, "expected prior task outcome to be retrieved as context");
  assert.match(relevantMemory![0]!.content, /SSO is required for enterprise onboarding/);
});

test("records a failure memory without blocking task failure when a task fails", async () => {
  const taskRepository = new MemoryTaskRepository();
  const artifactRepository = new MemoryArtifactRepository();
  const workRepository = new MemoryWorkRepository();
  const agentRepository = new MemoryAgentRepository();
  const memoryRepository = new FakeMemoryRepository();
  const companyBrainService = new CompanyBrainService(
    memoryRepository,
    new DefaultMemoryRetriever(memoryRepository),
  );
  const { recorder } = createRecorder();
  const task = makeTask("task-brain-failure" as TaskId, { status: "ready" });
  await taskRepository.create(task);
  await workRepository.create(makeWork());
  await agentRepository.create(makeAgent());

  const failingEngine: ExecutionEngine = {
    async execute(request) {
      return {
        workId: request.workId,
        taskId: request.taskId,
        agentId: request.agentId,
        status: "failed",
        error: { code: "MODEL_ERROR", message: "Model timed out." },
        toolCalls: [],
        metadata: {},
      };
    },
  };
  const service = new TaskExecutionService(
    taskRepository,
    artifactRepository,
    workRepository,
    agentRepository,
    failingEngine,
    recorder,
    companyBrainService,
  );

  const result = await service.executeTask(task.id);

  assert.equal(result.status, "failed");
  assert.equal(memoryRepository.memories.size, 1);
  const stored = [...memoryRepository.memories.values()][0];
  assert.equal(stored?.type, "decision");
  assert.match(stored?.content ?? "", /Model timed out/);
});
