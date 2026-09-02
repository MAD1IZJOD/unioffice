import assert from "node:assert/strict";
import test from "node:test";

import type {
  Agent,
  AgentId,
  Event,
  OrganizationId,
  Task,
  TaskId,
  Work,
  WorkId,
} from "@unioffice/core";

import type {
  AgentRepository,
  EventRepository,
  TaskRepository,
  WorkRepository,
} from "@unioffice/database";

import type {
  ExecutionEngine,
} from "@unioffice/orchestrator";

import {
  EventRecorder,
} from "./event-recorder.js";

import {
  TaskExecutionService,
} from "./task-execution-service.js";

import {
  WorkExecutionService,
} from "./work-execution-service.js";

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
  const agentRepository = new MemoryAgentRepository();
  const { recorder, repository: eventRepository } =
    createRecorder();
  const task = makeTask("task-1" as TaskId, {
    status: "ready",
  });

  await taskRepository.create(task);
  await agentRepository.create(makeAgent());

  const engine: ExecutionEngine = {
    async execute(request) {
      return {
        workId: request.workId,
        taskId: request.taskId,
        agentId: request.agentId,
        status: "completed",
        output: "Completed output.",
        metadata: { model: "test" },
      };
    },
  };
  const service = new TaskExecutionService(
    taskRepository,
    agentRepository,
    engine,
    recorder,
  );

  const result = await service.executeTask(task.id);

  assert.equal(result.status, "completed");
  assert.equal(result.result, "Completed output.");
  assert.ok(result.startedAt);
  assert.ok(result.completedAt);
  assert.deepEqual(
    eventRepository.events.map((event) => event.type),
    ["task.started", "task.completed"],
  );
});

test("persists failed agent execution", async () => {
  const taskRepository = new MemoryTaskRepository();
  const agentRepository = new MemoryAgentRepository();
  const { recorder, repository: eventRepository } =
    createRecorder();
  const task = makeTask("task-2" as TaskId, {
    status: "ready",
  });

  await taskRepository.create(task);
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
        metadata: {},
      };
    },
  };
  const service = new TaskExecutionService(
    taskRepository,
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
    eventRepository.events.map((event) => event.type),
    ["work.started", "work.completed"],
  );
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
