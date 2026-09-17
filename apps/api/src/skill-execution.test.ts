import assert from "node:assert/strict";
import test from "node:test";

import type {
  Agent,
  AgentId,
  ApprovalRequest,
  OrganizationId,
  Policy,
  PolicyId,
  Skill,
  Task,
  TaskId,
  Work,
  WorkId,
} from "@unioffice/core";

import type { PlanningContext } from "@unioffice/orchestrator";
import { systemSkills } from "@unioffice/skills";
import { createDefaultToolRegistry } from "@unioffice/tools";

import { GovernanceService } from "./governance-service.js";
import { TaskExecutionService } from "./task-execution-service.js";
import { isGovernedByPolicy } from "./work-approval-service.js";
import { WorkService } from "./work-service.js";

const organizationId = "aaaaaaaa-0000-4000-8000-000000000001" as OrganizationId;
const now = new Date("2026-09-17T12:00:00.000Z");

const work: Work = {
  id: "work-1" as WorkId,
  organizationId,
  requesterId: "user-1" as Work["requesterId"],
  objective: "Analyse our Q3 expenses and identify unusual spending.",
  status: "queued",
  priority: "normal",
  createdAt: now,
  updatedAt: now,
  metadata: {},
};

function agent(name: string, overrides: Partial<Agent> = {}): Agent {
  return {
    id: `agent-${name}` as AgentId,
    organizationId,
    name,
    description: "",
    type: "specialist",
    status: "active",
    capabilities: ["financial_analysis"],
    toolIds: ["calculator"],
    skills: [],
    createdAt: now,
    updatedAt: now,
    metadata: {},
    ...overrides,
  };
}

function step(skill?: Record<string, unknown>, extra: Record<string, unknown> = {}): Task {
  return {
    id: "task-1" as TaskId,
    workId: work.id,
    title: "Find unusual spending",
    description: "",
    status: "ready",
    assignedAgentId: "agent-Harvey" as AgentId,
    dependsOn: [],
    createdAt: now,
    updatedAt: now,
    metadata: { routing: { requiredTools: ["calculator"], ...(skill ? { skill } : {}) }, ...extra },
  };
}

function governance(policies: Policy[] = []) {
  return new GovernanceService(
    { async findEnforced() { return policies; } } as never,
    createDefaultToolRegistry(),
    { async record(event: unknown) { return event; } } as never,
  );
}

const effective = (skills: Skill[]) => ({
  async effective() { return new Map(skills.map((skill) => [skill.slug, skill])); },
});

test("a skill that needs approval holds its steps, a policy cannot lower that, and a deny still wins", async () => {
  const required = { slug: "candidate-screening", name: "Candidate screening", version: 1, scope: "system", approval: "required", memory: "none" };

  assert.equal((await governance().evaluateTask(work, step(required), undefined)).outcome, "require_approval");
  assert.equal((await governance().evaluateTask(work, step({ ...required, approval: "none" }), undefined)).outcome, "allow");
  assert.equal((await governance().evaluateTask(work, step(), undefined)).outcome, "allow");

  const policy = (effect: Policy["effect"]): Policy => ({
    id: "00000000-0000-4000-8000-00000000abcd" as PolicyId,
    organizationId,
    name: effect,
    description: "",
    subject: "task",
    effect,
    risk: "low",
    status: "active",
    scope: { agentIds: [], toolIds: [], workspaceIds: [], capabilities: [] },
    createdAt: now,
    updatedAt: now,
    metadata: {},
  } as Policy);

  assert.equal((await governance([policy("allow")]).evaluateTask(work, step(required), undefined)).outcome, "require_approval");
  assert.equal((await governance([policy("deny")]).evaluateTask(work, step(required), undefined)).outcome, "deny");
});

test("the skill a step follows comes only from the server's routing record", async () => {
  // A planner-written field named like a skill, outside routing, is not a skill.
  const forged = step(undefined, { skill: { slug: "x", name: "x", approval: "none" } });
  assert.equal(governance().skillOf(forged), undefined);
});

test("a skill's approval is decided by an owner or admin", () => {
  const approval = { metadata: { skill: "Candidate screening" } } as unknown as ApprovalRequest;
  assert.equal(isGovernedByPolicy(approval), true);
});

function executionHarness(skills: Skill[]) {
  const tasks = new Map<TaskId, Task>();
  let handed: Parameters<ConstructorParameters<typeof TaskExecutionService>[4]["execute"]>[0] | undefined;
  let recalls = 0;

  const service = new TaskExecutionService(
    {
      async findById(id: TaskId) { return tasks.get(id) ?? null; },
      async claimReadyForExecution(id: TaskId) { const task = tasks.get(id)!; const running = { ...task, status: "running" as const }; tasks.set(id, running); return running; },
      async update(task: Task) { tasks.set(task.id, task); return task; },
    } as never,
    { async create(artifact: unknown) { return artifact; } } as never,
    { async findById() { return work; } } as never,
    { async findById() { return agent("Harvey"); } } as never,
    {
      async execute(request) {
        handed = request;
        return { workId: request.workId, taskId: request.taskId, agentId: request.agentId, status: "completed", output: "ok", toolCalls: [], metadata: {} };
      },
    },
    { async record(event: unknown) { return event; } } as never,
    {
      recall: { async recallForStep() { recalls += 1; return { items: [] } as never; } },
      capture: { async captureFromTask() { return undefined as never; } },
    },
    effective(skills),
  );

  return { service, tasks, handed: () => handed, recalls: () => recalls };
}

test("a step runs with the skill as it is now, and without recall when the skill says so", async () => {
  const base = systemSkills().find((skill) => skill.slug === "candidate-screening")!;
  const edited = { ...base, version: 4, instructions: "The current procedure." };
  const harness = executionHarness([edited]);

  harness.tasks.set("task-1" as TaskId, step({ slug: "candidate-screening", name: base.name, version: 1, scope: "system", approval: "required", memory: "none" }));
  const result = await harness.service.executeTask("task-1" as TaskId);

  assert.equal(harness.handed()?.task.skill?.version, 4);
  assert.equal(harness.handed()?.task.skill?.instructions, "The current procedure.");
  assert.equal(harness.recalls(), 0, "memory: none skips recall");
  assert.deepEqual((result.metadata.execution as { skill: unknown }).skill, { slug: "candidate-screening", version: 4, scope: "system" });
});

test("a skill that no longer resolves is not used, and recall happens as usual", async () => {
  const harness = executionHarness([]);

  harness.tasks.set("task-1" as TaskId, step({ slug: "retired-skill", name: "Retired", version: 2, scope: "organization", approval: "none", memory: "none" }));
  await harness.service.executeTask("task-1" as TaskId);

  assert.equal(harness.handed()?.task.skill, undefined);
  assert.equal(harness.recalls(), 1);
});

test("planning offers only skills an available agent holds, and records the routed skill", async () => {
  const skills = systemSkills().filter((skill) => ["financial-analysis", "code-review"].includes(skill.slug));
  const harvey = agent("Harvey", { skills: ["financial-analysis"] });
  let offered: PlanningContext["availableSkills"];
  const created: Task[] = [];

  const service = new WorkService(
    { async findById() { return work; }, async update(next: Work) { return next; } } as never,
    { async create(task: Task) { created.push(task); return task; } } as never,
    { async findByOrganization() { return [harvey]; } } as never,
    {
      async plan(context) {
        offered = context.availableSkills;
        return {
          workId: work.id,
          objective: work.objective,
          metadata: {},
          tasks: [{ id: "task-9" as TaskId, ref: "analyse", title: "Analyse Q3", description: "", requiredTools: ["calculator"], skill: "financial-analysis", dependsOn: [], metadata: {} }],
        };
      },
    },
    { async delegate(context) { return { taskId: context.task.id, agentId: harvey.id, metadata: { skill: "financial-analysis" } }; } },
    { async record(event: unknown) { return event; } } as never,
    [],
    undefined,
    effective(skills),
  );

  await service.planWork(work.id);

  assert.deepEqual(offered?.map((skill) => skill.slug), ["financial-analysis"]);
  const routed = (created[0]!.metadata.routing as { skill: Record<string, unknown> }).skill;
  const { reasons, ...identity } = routed;

  assert.deepEqual(identity, {
    ref: "system:financial-analysis",
    slug: "financial-analysis",
    name: "Financial analysis",
    version: 1,
    scope: "system",
    approval: "none",
    memory: "recall",
  });
  assert.ok(
    (reasons as string[]).includes("Harvey holds it with everything it needs"),
    "the record says why this skill was chosen",
  );
});
