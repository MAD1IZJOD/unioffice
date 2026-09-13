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
  OrganizationId,
  Policy,
  PolicyId,
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
  PolicyRepository,
  TaskRepository,
  WorkRepository,
  WorkspaceRepository,
} from "@unioffice/database";

import {
  InMemoryExecutionJobRepository,
  InMemoryKnowledgeRepository,
} from "@unioffice/database";

import {
  DefaultAgentRuntime,
  type ModelProvider,
  type ModelRequest,
} from "@unioffice/agents";

import { KnowledgeExtractor } from "@unioffice/memory";

import {
  DefaultDelegator,
  DefaultExecutionEngine,
  OllamaPlanner,
} from "@unioffice/orchestrator";

import { createDefaultToolRegistry } from "@unioffice/tools";

import { WorkApplicationService } from "./application.js";
import { EventRecorder } from "./event-recorder.js";
import { ExecutionJobRunner } from "./execution-job-runner.js";
import { ExecutionQueueService } from "./execution-queue-service.js";
import { ExecutionWorker } from "./execution-worker.js";
import { GovernanceService } from "./governance-service.js";
import { KnowledgeCaptureService } from "./knowledge-capture-service.js";
import { KnowledgeGovernance } from "./knowledge-governance.js";
import { KnowledgeRecallService } from "./knowledge-recall-service.js";
import {
  MissionTemplateService,
  MissionTemplateValidationError,
} from "./mission-template-service.js";
import { PolicyTaskGovernanceGate } from "./task-governance-gate.js";
import { TaskExecutionService } from "./task-execution-service.js";
import { WorkApprovalService } from "./work-approval-service.js";
import { WorkExecutionService } from "./work-execution-service.js";
import { WorkService } from "./work-service.js";

/**
 * A template mission on the real path.
 *
 * Starting from a template must not be a second way to run work. These tests
 * take a template through the same services production wires together - the
 * planner, the delegator, the governance gate, the durable queue and a worker -
 * with only the model scripted, and check that the template shaped the brief
 * without getting past anything the ordinary path enforces.
 */

const organizationId = "11111111-1111-1111-1111-111111111111" as OrganizationId;
const requesterId = "22222222-2222-2222-2222-222222222222" as UserId;
const harveyId = "aaaaaaaa-0000-0000-0000-000000000002" as AgentId;

function workforce(): Agent[] {
  const now = new Date();

  return [
    {
      id: harveyId,
      organizationId,
      name: "Harvey",
      description: "Performs exact calculation and financial analysis.",
      type: "specialist",
      status: "active",
      capabilities: ["calculation", "financial_analysis"],
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

function harness(script: string[], options: { policies?: Policy[] } = {}) {
  const agents = workforce();
  const policies = options.policies ?? [];
  const works = new Map<WorkId, Work>();
  const tasks = new Map<TaskId, Task>();
  const artifacts = new Map<ArtifactId, Artifact>();
  const knowledge = new InMemoryKnowledgeRepository();
  const approvals = new Map<ApprovalId, ApprovalRequest>();
  const events: Event[] = [];

  const workRepository: WorkRepository = {
    async create(work) { works.set(work.id, work); return work; },
    async findById(id) { return works.get(id) ?? null; },
    async findByOrganization() { return [...works.values()]; },
    async findByWorkspace(_organizationId, workspaceId) {
      return [...works.values()].filter((value) => value.workspaceId === workspaceId);
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
      return [...tasks.values()].filter((value) => value.assignedAgentId === agentId);
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

  const policyRepository: PolicyRepository = {
    async create(policy) { return policy; },
    async findById(id) { return policies.find((p) => p.id === id) ?? null; },
    async findByOrganization() { return policies; },
    async findEnforced() { return policies.filter((p) => p.status === "active"); },
    async update(policy) { return policy; },
  };

  const workspaceRepository = {
    async findById() { return null; },
  } as unknown as WorkspaceRepository;

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

  const governanceService = new GovernanceService(policyRepository, toolRegistry, eventRecorder);
  const knowledgeGovernance = new KnowledgeGovernance(policyRepository, governanceService);

  const knowledgeRecall = new KnowledgeRecallService(
    knowledge,
    knowledge,
    knowledgeGovernance,
    eventRecorder,
    workRepository,
    taskRepository,
    artifactRepository,
  );

  const knowledgeCapture = new KnowledgeCaptureService(
    knowledge,
    knowledge,
    knowledgeGovernance,
    eventRecorder,
    new KnowledgeExtractor(modelProvider, "scripted"),
  );

  const applicationService = new WorkApplicationService(workRepository, eventRecorder);

  const missionTemplateService = new MissionTemplateService(
    applicationService,
    agentRepository,
    workspaceRepository,
    policyRepository,
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
    knowledgeRecall,
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
    { recall: knowledgeRecall, capture: knowledgeCapture },
  );

  const workApprovalService = new WorkApprovalService(
    approvalRepository,
    taskRepository,
    workRepository,
    eventRecorder,
  );

  // Wired exactly as runtime.ts wires it: the policy-backed gate sits in front
  // of every step, whatever started the mission.
  const workExecutionService = new WorkExecutionService(
    workRepository,
    taskRepository,
    taskExecutionService,
    eventRecorder,
    workApprovalService,
    new PolicyTaskGovernanceGate(governanceService, agentRepository),
  );

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

  const worker = new ExecutionWorker(jobs, executionJobRunner, {
    pollIntervalMs: 5,
    leaseMs: 60_000,
    concurrency: 1,
    workerId: "worker-a",
    sleep: async () => {},
    log: () => {},
  });

  return {
    modelProvider,
    jobs,
    works,
    events,
    artifacts,
    approvals,
    workRepository,
    taskRepository,
    missionTemplateService,
    workService,
    workApprovalService,
    executionQueueService,
    worker,
  };
}

const financialPlan = JSON.stringify({
  tasks: [{
    ref: "burn",
    title: "Total the monthly burn",
    description: "Add the cost lines together.",
    requiredCapabilities: ["calculation"],
    requiredTools: ["calculator"],
    requiresApproval: false,
    dependsOn: [],
  }],
});

function toolCall(id: string, input: unknown): string {
  return JSON.stringify({ tool_call: { id, input } });
}

const reviewInput = {
  organizationId,
  requesterId,
  templateId: "prepare-a-financial-review",
  name: "Q3 burn review",
  objective: "Review our monthly burn against the plan for the quarter.",
  context: "Salaries 48200, cloud 9350, lease 12500.",
  desiredOutcome: "A one-page summary with the total and the largest variance.",
  constraints: "Use only the figures given here.",
};

test("a template mission is planned, queued and executed by a worker on the real path", async () => {
  const h = harness([
    financialPlan,
    toolCall("calculator", { expression: "48200 + 9350 + 12500" }),
    "Monthly burn is 70,050.",
  ]);

  const work = await h.missionTemplateService.startMission(reviewInput);

  // Starting a template creates ordinary work and nothing else: no plan, no
  // job and no model call until the same planning step every mission takes.
  assert.equal(work.status, "queued");
  assert.equal(h.modelProvider.requests.length, 0);
  assert.equal(await h.jobs.findActiveByWork(work.id), null);

  await h.workService.planWork(work.id);

  // The planner received the template's brief as the requester's briefing,
  // and it is flagged to the model as binding.
  const planning = h.modelProvider.requests[0]!;
  assert.match(planning.messages[0]!.content, /briefing/i);
  assert.match(planning.messages[1]!.content, /Mission type: Prepare a Financial Review/);
  assert.match(planning.messages[1]!.content, /Use only the figures given here\./);
  assert.match(planning.messages[1]!.content, /Salaries 48200/);

  const queued = await h.executionQueueService.enqueueWork(work.id, "requested");
  assert.equal(queued.enqueued, true);

  const tick = await h.worker.tick();
  assert.equal(tick.claimed, 1);
  assert.equal(tick.completed, 1);

  const executed = (await h.workRepository.findById(work.id))!;
  assert.equal(executed.status, "completed");
  assert.deepEqual(executed.metadata.template, {
    id: "prepare-a-financial-review",
    version: 1,
    name: "Prepare a Financial Review",
  });

  const [task] = await h.taskRepository.findByWork(work.id);
  assert.equal(task!.status, "completed");
  assert.equal(task!.assignedAgentId, harveyId, "the delegator, not the template, chose the agent");
  assert.equal(h.artifacts.size, 1, "the artifact is the agent's real output");
  assert.ok(h.events.some((event) => event.type === "tool.completed"));
  assert.equal(await h.jobs.findActiveByWork(work.id), null);
});

test("governance still stops a template mission until a person approves it", async () => {
  const now = new Date();
  const signOff: Policy = {
    id: "cccccccc-0000-0000-0000-000000000001" as PolicyId,
    organizationId,
    name: "Finance sign-off",
    description: "Every finance step needs a person.",
    subject: "task",
    scope: { agentIds: [], toolIds: [], workspaceIds: [], capabilities: [] },
    effect: "require_approval",
    risk: "high",
    status: "active",
    createdAt: now,
    updatedAt: now,
    metadata: {},
  };

  const h = harness(
    [
      financialPlan,
      toolCall("calculator", { expression: "48200 + 9350 + 12500" }),
      "Monthly burn is 70,050.",
    ],
    { policies: [signOff] },
  );

  // The template view warns about the rule up front...
  const view = await h.missionTemplateService.getTemplate(organizationId, reviewInput.templateId);
  assert.deepEqual(view.governance.gatingPolicies.map((p) => p.name), ["Finance sign-off"]);

  // ...and nothing about starting from a template gets past it.
  const work = await h.missionTemplateService.startMission(reviewInput);
  await h.workService.planWork(work.id);
  await h.executionQueueService.enqueueWork(work.id, "requested");
  await h.worker.tick();

  const pending = [...h.approvals.values()].filter((a) => a.status === "pending");
  assert.equal(pending.length, 1, "the rule raised a real approval request");
  assert.equal(h.artifacts.size, 0, "nothing was produced before the approval");
  assert.notEqual((await h.workRepository.findById(work.id))!.status, "completed");

  await h.workApprovalService.approve(pending[0]!.id, "resolver-1", organizationId);
  const resumed = await h.executionQueueService.enqueueWork(work.id, "approval_resumed");
  assert.equal(resumed.enqueued, true);

  const tick = await h.worker.tick();
  assert.equal(tick.completed, 1);
  assert.equal((await h.workRepository.findById(work.id))!.status, "completed");
  assert.equal(h.artifacts.size, 1);
});

test("a planner that returns no usable plan leaves nothing queued or running", async () => {
  const h = harness(["I would rather not produce JSON today."]);

  const work = await h.missionTemplateService.startMission(reviewInput);

  await assert.rejects(h.workService.planWork(work.id));

  assert.deepEqual(await h.taskRepository.findByWork(work.id), []);
  assert.equal(await h.jobs.findActiveByWork(work.id), null);
  assert.equal(h.artifacts.size, 0);
  assert.notEqual((await h.workRepository.findById(work.id))!.status, "completed");
});

test("a queue that cannot accept the job does not start the mission some other way", async () => {
  const h = harness([financialPlan]);

  const work = await h.missionTemplateService.startMission(reviewInput);
  await h.workService.planWork(work.id);
  const planned = (await h.workRepository.findById(work.id))!;

  h.jobs.enqueue = async () => {
    throw new Error("The job table is unavailable.");
  };

  await assert.rejects(
    h.executionQueueService.enqueueWork(work.id, "requested"),
    /job table is unavailable/,
  );

  // No fallback execution: the work and its steps are exactly as planning left
  // them, and the only model call made was the plan itself.
  assert.equal((await h.workRepository.findById(work.id))!.status, planned.status);
  const tasks = await h.taskRepository.findByWork(work.id);
  assert.ok(tasks.length > 0);
  assert.ok(tasks.every((task) => task.status !== "running" && task.status !== "completed"));
  assert.equal(h.modelProvider.requests.length, 1);
  assert.equal(h.artifacts.size, 0);
});

test("input the template refuses never reaches the planner or the queue", async () => {
  const h = harness([financialPlan]);

  await assert.rejects(
    h.missionTemplateService.startMission({ ...reviewInput, objective: "go" }),
    MissionTemplateValidationError,
  );

  await assert.rejects(
    h.missionTemplateService.startMission({ ...reviewInput, templateId: "grant-every-tool" }),
    /Mission template not found/,
  );

  assert.equal(h.works.size, 0);
  assert.equal(h.modelProvider.requests.length, 0);
});
