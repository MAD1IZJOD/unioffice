import assert from "node:assert/strict";
import test from "node:test";

import type { Agent, AgentId, OrganizationId, Skill, SkillId, Task, UserId, Work, WorkId, WorkspaceId } from "@unioffice/core";
import { DefaultDelegator } from "@unioffice/orchestrator";

import { WorkService } from "./work-service.js";

/**
 * A mission's own room comes first when a step's skill is chosen, as it does
 * when the step is routed.
 *
 * Found on a live Product mission: the planner's steps asked for writing and
 * communication, "Announcement drafting" matched, and only Peter - who works
 * for the whole company - held it. A skill is a hard boundary on who gets a
 * step, so all three steps went to Peter and the Product Manager in the
 * mission's own room got none. These run the real delegator.
 */

const organizationId = "bbbbbbbb-0000-4000-8000-000000000002" as OrganizationId;
const product = "f0000000-0000-4000-8000-00000000000f" as WorkspaceId;
const mission = "aaaaaaaa-0000-4000-8000-000000000001" as WorkId;
const now = new Date("2026-09-30T00:00:00.000Z");

function skill(slug: string, name: string, description: string, requiredCapabilities: string[], requiredTools: string[] = []): Skill {
  return {
    id: `system:${slug}` as SkillId,
    scope: "system",
    slug,
    name,
    description,
    category: "communication",
    version: 1,
    status: "active",
    instructions: "Follow the procedure.",
    inputs: [],
    outputs: [],
    requiredTools,
    requiredCapabilities,
    approval: "none",
    memory: "recall",
    createdAt: now,
    updatedAt: now,
  } as unknown as Skill;
}

const skills = new Map([
  ["announcement-drafting", skill("announcement-drafting", "Announcement drafting", "Drafts an announcement for the people it concerns.", ["communication"])],
  ["meeting-summary", skill("meeting-summary", "Meeting summary", "Turns meeting notes into decisions, actions and owners.", ["writing"])],
]);

function agent(id: string, name: string, capabilities: string[], held: string[], workspaceId?: WorkspaceId): Agent {
  return {
    id: id as AgentId,
    organizationId,
    ...(workspaceId ? { workspaceId } : {}),
    name,
    description: "",
    type: "specialist",
    status: "active",
    capabilities,
    toolIds: ["datetime"],
    skills: held,
    createdAt: now,
    updatedAt: now,
    metadata: {},
  } as Agent;
}

// Peter works for the whole company; Jessica works in Product.
const peter = agent("e0000000-0000-4000-8000-000000000506", "Peter", ["communication", "stakeholder_messaging", "writing"], ["announcement-drafting", "meeting-summary"]);
const jessica = agent("e0000000-0000-4000-8000-000000000511", "Jessica", ["product_management", "stakeholder_messaging", "writing"], ["meeting-summary"], product);

async function plan(options: { workspaceId?: WorkspaceId; requestedSkill?: string }) {
  const created: Task[] = [];
  let stored: Work = {
    id: mission,
    organizationId,
    ...(options.workspaceId ? { workspaceId: options.workspaceId } : {}),
    requesterId: "cccccccc-0000-4000-8000-000000000003" as UserId,
    objective: "Write the password-reset announcement",
    status: "queued",
    priority: "normal",
    createdAt: now,
    updatedAt: now,
    metadata: options.requestedSkill ? { skill: options.requestedSkill } : {},
  };
  const agents = { async findByOrganization() { return [peter, jessica]; } };

  const service = new WorkService(
    {
      async findById() { return { ...stored }; },
      async update(next: Work) { stored = { ...next }; return { ...next }; },
    } as never,
    { async create(task: Task) { created.push(task); return task; } } as never,
    agents as never,
    {
      async plan() {
        return {
          workId: mission,
          summary: "plan",
          tasks: [{
            id: "eeeeeeee-0000-4000-8000-000000000001",
            ref: "s1",
            title: "Draft the announcement of the password reset",
            description: "Write the announcement telling users how password reset works.",
            requiredCapabilities: ["writing", "communication"],
            requiredTools: [],
            dependsOn: [],
            metadata: {},
          }],
          metadata: {},
        };
      },
    } as never,
    new DefaultDelegator(agents as never),
    { async record(event: unknown) { return event; } } as never,
    [],
    undefined,
    { async effective() { return skills; } },
  );

  await service.planWork(mission);
  const step = created[0]!;
  return {
    who: step.assignedAgentId === jessica.id ? "Jessica" : step.assignedAgentId === peter.id ? "Peter" : step.assignedAgentId,
    skill: (step.metadata.routing as { skill?: { slug: string } }).skill?.slug,
  };
}

test("in a mission's room, a skill only someone outside it holds does not take the step away", async () => {
  const { who, skill } = await plan({ workspaceId: product });

  assert.equal(who, "Jessica", "the Product Manager in the room does the step");
  assert.equal(skill, "meeting-summary", "with a skill she holds that fits the step");
});

test("a mission for the whole company is routed as before", async () => {
  const { who, skill } = await plan({});

  assert.equal(skill, "announcement-drafting");
  assert.equal(who, "Peter");
});

test("a skill asked for by name is still found outside the room", async () => {
  const { who, skill } = await plan({ workspaceId: product, requestedSkill: "announcement-drafting" });

  assert.equal(skill, "announcement-drafting");
  assert.equal(who, "Peter");
});
