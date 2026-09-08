import assert from "node:assert/strict";
import test from "node:test";

import type {
  Agent,
  AgentId,
  Artifact,
  ArtifactId,
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
import { TaskExecutionService } from "./task-execution-service.js";
import { WorkApprovalService } from "./work-approval-service.js";
import { WorkExecutionService } from "./work-execution-service.js";
import { WorkService } from "./work-service.js";

/**
 * The whole loop, wired exactly as production wires it, with only the model
 * provider replaced.
 *
 * Every other test in this package covers one service against fakes. This one
 * exists because the failures that actually mattered lived between them: the
 * planner naming capabilities the delegator then refused to route, and a task
 * mandating a tool the assigned agent was not authorized to call. Neither is
 * visible from a unit test of either side, and reproducing them needed a real
 * model run taking minutes. Here it takes milliseconds.
 */

const organizationId = "11111111-1111-1111-1111-111111111111" as OrganizationId;
const requesterId = "22222222-2222-2222-2222-222222222222" as UserId;
const atlasId = "aaaaaaaa-0000-0000-0000-000000000001" as AgentId;
const ledgerId = "aaaaaaaa-0000-0000-0000-000000000002" as AgentId;
const novaId = "aaaaaaaa-0000-0000-0000-000000000003" as AgentId;

function agent(overrides: Partial<Agent> & { id: AgentId; name: string }): Agent {
  const now = new Date();

  return {
    organizationId,
    description: `${overrides.name} test agent.`,
    type: "specialist",
    status: "active",
    capabilities: [],
    toolIds: [],
    createdAt: now,
    updatedAt: now,
    metadata: {},
    ...overrides,
  };
}

/** The same shape of workforce production seeds, trimmed to three agents. */
function workforce(): Agent[] {
  return [
    agent({
      id: atlasId,
      name: "Tyrion",
      type: "orchestrator",
      capabilities: ["planning", "coordination"],
      toolIds: [],
    }),
    agent({
      id: ledgerId,
      name: "Harvey",
      capabilities: ["calculation", "financial_analysis"],
      toolIds: ["calculator", "datetime"],
    }),
    agent({
      id: novaId,
      name: "Mike",
      capabilities: ["research", "writing"],
      toolIds: ["datetime"],
    }),
  ];
}

/**
 * Replays scripted responses in order. Planning consumes one; each agent turn
 * consumes another. A test that runs out of script has taken a path it did not
 * intend, so that fails loudly rather than hanging or looping.
 */
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

function repositories(agents: Agent[]) {
  const works = new Map<WorkId, Work>();
  const tasks = new Map<TaskId, Task>();
  const artifacts = new Map<ArtifactId, Artifact>();
  const memories = new Map<MemoryId, Memory>();
  const events: Event[] = [];

  const workRepository: WorkRepository = {
    async create(work) { works.set(work.id, work); return work; },
    async findById(id) { return works.get(id) ?? null; },
    async findByOrganization() { return [...works.values()]; },
    async findByStatuses(statuses) {
      return [...works.values()].filter((work) => statuses.includes(work.status));
    },
    async update(work) { works.set(work.id, work); return work; },
    async delete(id) { works.delete(id); },
  };

  const taskRepository: TaskRepository = {
    async create(task) { tasks.set(task.id, task); return task; },
    async findById(id) { return tasks.get(id) ?? null; },
    async findByWork(workId) {
      return [...tasks.values()].filter((task) => task.workId === workId);
    },
    async claimReadyForExecution(id, startedAt) {
      const task = tasks.get(id);
      if (!task || task.status !== "ready") return null;

      const claimed: Task = {
        ...task,
        status: "running",
        startedAt,
        updatedAt: startedAt,
      };
      tasks.set(id, claimed);
      return claimed;
    },
    async update(task) { tasks.set(task.id, task); return task; },
    async delete(id) { tasks.delete(id); },
  };

  const agentRepository: AgentRepository = {
    async create(value) { return value; },
    async findById(id) { return agents.find((value) => value.id === id) ?? null; },
    async findByOrganization() { return agents; },
    async update(value) { return value; },
    async delete() {},
  };

  const artifactRepository: ArtifactRepository = {
    async create(artifact) { artifacts.set(artifact.id, artifact); return artifact; },
    async findById(id) { return artifacts.get(id) ?? null; },
    async findByWork(workId) {
      return [...artifacts.values()].filter((artifact) => artifact.workId === workId);
    },
    async findByTask(taskId) {
      return [...artifacts.values()].filter((artifact) => artifact.taskId === taskId);
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
    async create(approval) { return approval; },
    async findById() { return null; },
    async findByWork() { return []; },
    async findPendingByOrganization() { return []; },
    async update(approval) { return approval; },
    async resolvePending(approval) { return approval; },
  };

  const eventRepository: EventRepository = {
    async create(event) { events.push(event); return event; },
    async findByWork() { return events; },
    async findByOrganization() { return events; },
  };

  return {
    workRepository,
    taskRepository,
    agentRepository,
    artifactRepository,
    memoryRepository,
    approvalRepository,
    eventRepository,
    events,
    artifacts,
    memories,
  };
}

function pipeline(script: string[], agents = workforce()) {
  const repos = repositories(agents);
  const modelProvider = new ScriptedModelProvider(script);
  const eventRecorder = new EventRecorder(repos.eventRepository);
  const toolRegistry = createDefaultToolRegistry();

  const companyBrainService = new CompanyBrainService(
    repos.memoryRepository,
    new DefaultMemoryRetriever(repos.memoryRepository),
  );

  const applicationService = new WorkApplicationService(
    repos.workRepository,
    eventRecorder,
  );

  const workService = new WorkService(
    repos.workRepository,
    repos.taskRepository,
    repos.agentRepository,
    new OllamaPlanner(modelProvider, "scripted"),
    new DefaultDelegator(repos.agentRepository),
    eventRecorder,
    toolRegistry.list().map((tool) => ({
      id: tool.id,
      name: tool.name,
      description: tool.description,
    })),
  );

  const taskExecutionService = new TaskExecutionService(
    repos.taskRepository,
    repos.artifactRepository,
    repos.workRepository,
    repos.agentRepository,
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
    repos.approvalRepository,
    repos.taskRepository,
    repos.workRepository,
    eventRecorder,
  );

  const workExecutionService = new WorkExecutionService(
    repos.workRepository,
    repos.taskRepository,
    taskExecutionService,
    eventRecorder,
    workApprovalService,
  );

  return {
    ...repos,
    modelProvider,
    applicationService,
    workService,
    workExecutionService,
  };
}

function plan(tasks: Array<Record<string, unknown>>): string {
  return JSON.stringify({ tasks });
}

function toolCall(id: string, input: unknown): string {
  return JSON.stringify({ tool_call: { id, input } });
}

async function runObjective(
  harness: ReturnType<typeof pipeline>,
  objective: string,
) {
  const work = await harness.applicationService.createWork({
    organizationId,
    requesterId,
    objective,
  });

  await harness.workService.planWork(work.id);

  return harness.workExecutionService.executeWork(work.id);
}

test("carries an objective through plan, delegation, a real tool call, artifact and memory", async () => {
  const harness = pipeline([
    plan([{
      ref: "total",
      title: "Total the monthly costs",
      description: "Add the three figures together.",
      requiredCapabilities: ["calculation"],
      requiredTools: ["calculator"],
      requiresApproval: false,
      dependsOn: [],
    }]),
    toolCall("calculator", { expression: "48200 + 9350 + 12500" }),
    "The total monthly operating cost is 70,050.",
  ]);

  const result = await runObjective(harness, "Total our monthly costs.");

  assert.equal(result.work.status, "completed");
  assert.equal(result.tasks.length, 1);

  const task = result.tasks[0]!;
  assert.equal(task.status, "completed");
  // Routed to the only agent holding the calculator, not the orchestrator.
  assert.equal(task.assignedAgentId, ledgerId);

  const toolCalls = (task.metadata.execution as { toolCalls?: unknown[] }).toolCalls!;
  assert.equal(toolCalls.length, 1);
  assert.deepEqual(
    (toolCalls[0] as { output: unknown }).output,
    { result: 70050, expression: "48200 + 9350 + 12500" },
  );

  // The result is the tool's, not the model's arithmetic.
  assert.match(String(task.result), /70,050/);

  assert.equal(harness.artifacts.size, 1);
  assert.equal(harness.memories.size, 1);

  const types = harness.events.map((event) => event.type);
  assert.deepEqual(types, [
    "work.created",
    "work.planning_started",
    "task.created",
    "agent.assigned",
    "work.planning_completed",
    "work.started",
    "task.ready",
    "task.started",
    "tool.completed",
    "artifact.created",
    "task.completed",
    "work.completed",
  ]);
});

test("runs a dependent plan across two specialists in order", async () => {
  const harness = pipeline([
    plan([
      {
        ref: "total",
        title: "Total the monthly costs",
        description: "Add the figures together.",
        requiredCapabilities: ["calculation"],
        requiredTools: ["calculator"],
        requiresApproval: false,
        dependsOn: [],
      },
      {
        ref: "note",
        title: "Write the runway note",
        description: "Explain what the total means.",
        requiredCapabilities: ["writing"],
        requiredTools: [],
        requiresApproval: false,
        dependsOn: ["total"],
      },
    ]),
    toolCall("calculator", { expression: "48200 + 9350 + 12500" }),
    "The total is 70,050.",
    "At 70,050 a month, 900,000 in the bank is about 12.8 months of runway.",
  ]);

  const result = await runObjective(harness, "Total our costs and explain the runway.");

  assert.equal(result.work.status, "completed");

  const total = result.tasks.find((task) => task.title.startsWith("Total"))!;
  const note = result.tasks.find((task) => task.title.startsWith("Write"))!;

  assert.equal(total.assignedAgentId, ledgerId);
  assert.equal(note.assignedAgentId, novaId);
  assert.deepEqual(note.dependsOn, [total.id]);

  // The dependent task must have been given the first task's real result.
  const writerPrompt = harness.modelProvider.requests.at(-1)!.messages
    .map((message) => message.content)
    .join("\n");
  assert.match(writerPrompt, /70,050/);
});

test("routes a tool-required task away from an agent that is not authorized for it", async () => {
  // The planner suggesting the orchestrator must not override tool
  // authorization - this is the boundary the tool executor enforces.
  const harness = pipeline([
    plan([{
      ref: "total",
      title: "Total the monthly costs",
      description: "Add the figures together.",
      requiredCapabilities: [],
      requiredTools: ["calculator"],
      suggestedAgentType: "orchestrator",
      requiresApproval: false,
      dependsOn: [],
    }]),
    toolCall("calculator", { expression: "1 + 1" }),
    "The total is 2.",
  ]);

  const result = await runObjective(harness, "Total our costs.");

  assert.equal(result.tasks[0]!.assignedAgentId, ledgerId);
  assert.notEqual(result.tasks[0]!.assignedAgentId, atlasId);
});

test("still routes when the planner asks for capabilities no single agent has", async () => {
  // The regression that failed every objective before capabilities became a
  // ranking signal rather than a filter.
  const harness = pipeline([
    plan([{
      ref: "total",
      title: "Total the monthly costs",
      description: "Add the figures together.",
      requiredCapabilities: ["calculation", "planning"],
      requiredTools: ["calculator"],
      requiresApproval: false,
      dependsOn: [],
    }]),
    toolCall("calculator", { expression: "2 + 2" }),
    "The total is 4.",
  ]);

  const result = await runObjective(harness, "Total our costs.");

  assert.equal(result.work.status, "completed");
  assert.equal(result.tasks[0]!.assignedAgentId, ledgerId);

  const delegation = result.tasks[0]!.metadata.delegation as {
    capabilityFit: string;
    unmatchedCapabilities: string[];
  };
  assert.equal(delegation.capabilityFit, "partial");
  assert.deepEqual(delegation.unmatchedCapabilities, ["planning"]);
});

test("rejects a final answer that skips a tool the task mandates", async () => {
  const harness = pipeline([
    plan([{
      ref: "total",
      title: "Total the monthly costs",
      description: "Add the figures together.",
      requiredCapabilities: [],
      requiredTools: ["calculator"],
      requiresApproval: false,
      dependsOn: [],
    }]),
    // The model answers from its own arithmetic first.
    "The total is 70,050.",
    toolCall("calculator", { expression: "48200 + 9350 + 12500" }),
    "The total is 70,050, confirmed by the calculator.",
  ]);

  const result = await runObjective(harness, "Total our costs.");

  assert.equal(result.work.status, "completed");

  const task = result.tasks[0]!;
  const execution = task.metadata.execution as {
    toolCalls: unknown[];
    metadata: { requiredToolsSatisfied: boolean };
  };

  // The guessed answer was refused and the tool was actually called.
  assert.equal(execution.toolCalls.length, 1);
  assert.equal(execution.metadata.requiredToolsSatisfied, true);
});

test("fails the work, records why, and leaves it retryable when a tool is unroutable", async () => {
  const withoutCalculator = workforce().map((value) =>
    value.id === ledgerId ? { ...value, toolIds: ["datetime"] } : value,
  );

  const harness = pipeline(
    [
      plan([{
        ref: "total",
        title: "Total the monthly costs",
        description: "Add the figures together.",
        requiredCapabilities: [],
        requiredTools: ["calculator"],
        requiresApproval: false,
        dependsOn: [],
      }]),
    ],
    withoutCalculator,
  );

  const work = await harness.applicationService.createWork({
    organizationId,
    requesterId,
    objective: "Total our costs.",
  });

  await assert.rejects(
    () => harness.workService.planWork(work.id),
    /No eligible agent is authorized for the required tool\(s\): calculator/,
  );

  const failed = (await harness.workRepository.findById(work.id))!;
  assert.equal(failed.status, "failed");
  assert.match(String(failed.metadata.planningError), /calculator/);
});
