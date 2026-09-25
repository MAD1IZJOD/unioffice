import assert from "node:assert/strict";
import test from "node:test";

import type { Agent, AgentId, OrganizationId, Skill, SkillId, Task, UserId, Work, WorkId } from "@unioffice/core";

import { WorkService } from "./work-service.js";

/**
 * Which skill a step follows is decided from the step, not from the mission.
 *
 * Found on a live launch-plan mission for an "AI meeting-summary feature":
 * the objective's words were counted as every step's own, so steps that never
 * mentioned meetings were put on the Meeting summary skill - and delegation,
 * which then only considers the skill's holders, can give such a step to the
 * communications agent instead of the engineer who fits it. A step whose own
 * title names the skill's words still matches it; that is outside this fix.
 */

const organizationId = "bbbbbbbb-0000-4000-8000-000000000002" as OrganizationId;
const mission = "aaaaaaaa-0000-4000-8000-000000000001" as WorkId;
const now = new Date("2026-09-25T00:00:00.000Z");

const meetingSummary = {
  id: "system:meeting-summary" as SkillId,
  scope: "system",
  slug: "meeting-summary",
  name: "Meeting summary",
  description: "Turns meeting notes into decisions, actions and owners.",
  category: "communication",
  version: 1,
  status: "active",
  instructions: "List decisions, then actions with owners.",
  inputs: [],
  outputs: [],
  requiredTools: [],
  requiredCapabilities: ["writing"],
  approval: "none",
  memory: "recall",
  createdAt: now,
  updatedAt: now,
} as unknown as Skill;

function agent(name: string, capabilities: string[], skills: string[]): Agent {
  return {
    id: `dddddddd-0000-4000-8000-00000000000${name.length}` as AgentId,
    organizationId,
    name,
    description: "",
    type: "specialist",
    status: "active",
    capabilities,
    toolIds: [],
    skills,
    createdAt: now,
    updatedAt: now,
    metadata: {},
  } as unknown as Agent;
}

function harness(steps: Array<{ title: string; description: string; requiredCapabilities: string[] }>) {
  const peter = agent("Peter", ["communication", "writing"], ["meeting-summary"]);
  const tony = agent("Tony", ["coding", "technical_design", "writing"], []);
  const created: Task[] = [];
  let stored: Work = {
    id: mission,
    organizationId,
    requesterId: "cccccccc-0000-4000-8000-000000000003" as UserId,
    objective: "Create a launch plan for a new AI meeting-summary feature",
    status: "queued",
    priority: "normal",
    createdAt: now,
    updatedAt: now,
    metadata: {},
  };

  const service = new WorkService(
    {
      async findById() { return { ...stored }; },
      async update(next: Work) { stored = { ...next }; return { ...next }; },
    } as never,
    { async create(task: Task) { created.push(task); return task; } } as never,
    { async findByOrganization() { return [peter, tony]; } } as never,
    {
      async plan() {
        return {
          workId: mission,
          summary: "plan",
          tasks: steps.map((step, index) => ({
            id: `eeeeeeee-0000-4000-8000-00000000000${index}`,
            ref: `s${index}`,
            dependsOn: [],
            requiredTools: [],
            metadata: {},
            ...step,
          })),
          metadata: {},
        };
      },
    } as never,
    {
      // Routes to the skill's holder when a skill was chosen, otherwise to
      // whoever has every capability the step needs - the shape of the real
      // delegator's decision, without its scoring.
      async delegate(context: { task: { id: string; skill?: string; requiredCapabilities: string[] } }) {
        const pool = context.task.skill ? [peter] : [peter, tony];
        const chosen = pool.find((candidate) => context.task.requiredCapabilities.every((capability) => candidate.capabilities.includes(capability))) ?? pool[0]!;
        return { taskId: context.task.id, agentId: chosen.id, metadata: { skill: context.task.skill } };
      },
    } as never,
    { async record(event: unknown) { return event; } } as never,
    [],
    undefined,
    { async effective() { return new Map([["meeting-summary", meetingSummary]]); } },
  );

  return { service, created, peter, tony };
}

const skillOf = (task: Task) => (task.metadata.routing as { skill?: { slug: string } }).skill?.slug;

test("a step that does not mention a skill is not put on it because the mission's objective does", async () => {
  const { service, created, tony } = harness([
    { title: "Design and build the feature", description: "Implement the backend and the API.", requiredCapabilities: ["coding", "technical_design"] },
  ]);

  await service.planWork(mission);

  assert.equal(skillOf(created[0]!), undefined);
  assert.equal(created[0]!.assignedAgentId, tony.id, "the engineer who fits the step does it");
});

test("a step that is itself about the skill's work still follows it", async () => {
  const { service, created, peter } = harness([
    { title: "Write the meeting summary", description: "Summarise the launch review meeting into decisions and actions.", requiredCapabilities: ["writing"] },
  ]);

  await service.planWork(mission);

  assert.equal(skillOf(created[0]!), "meeting-summary");
  assert.equal(created[0]!.assignedAgentId, peter.id);
});
