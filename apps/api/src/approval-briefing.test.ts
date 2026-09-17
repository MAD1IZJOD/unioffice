import assert from "node:assert/strict";
import test from "node:test";

import type {
  Agent,
  AgentId,
  ApprovalId,
  ApprovalRequest,
  MemberId,
  OrganizationId,
  OrganizationRole,
  Task,
  TaskId,
  UserId,
  Work,
  WorkId,
} from "@unioffice/core";

import { createGitHubTools } from "@unioffice/connect";
import { createDefaultToolRegistry } from "@unioffice/tools";

import type { Access } from "./access/permissions.js";
import { briefApprovals } from "./approval-briefing.js";

const orgA = "aaaaaaaa-0000-4000-8000-000000000001" as OrganizationId;
const orgB = "bbbbbbbb-0000-4000-8000-000000000002" as OrganizationId;
const now = new Date("2026-09-17T12:00:00.000Z");

function person(role: OrganizationRole, organizationId = orgA): Access {
  return { userId: "u" as UserId, email: "p@example.test", organizationId, memberId: "m" as MemberId, role, workspaces: new Map() };
}

const mission: Work = {
  id: "work-1" as WorkId,
  organizationId: orgA,
  requesterId: "user" as Work["requesterId"],
  objective: "File the regression as an issue.",
  status: "waiting_approval",
  priority: "normal",
  createdAt: now,
  updatedAt: now,
  metadata: {},
};

const step: Task = {
  id: "task-1" as TaskId,
  workId: mission.id,
  title: "Open the issue",
  description: "Create an issue in acme/app describing the regression.",
  status: "waiting",
  assignedAgentId: "agent-tony" as AgentId,
  dependsOn: [],
  createdAt: now,
  updatedAt: now,
  metadata: { routing: { requiredTools: ["github_create_issue"] }, governance: { risk: "high" } },
};

const tony = { id: "agent-tony" as AgentId, organizationId: orgA, name: "Tony", metadata: { systemInstructions: "SECRET PROMPT" } } as unknown as Agent;

function dependencies(overrides: { work?: Work; agent?: Agent } = {}) {
  const tools = createDefaultToolRegistry();
  for (const tool of createGitHubTools({ async use() { throw new Error("unused"); } })) tools.register(tool);

  return {
    tasks: { async findById() { return step; } },
    works: { async findById() { return overrides.work ?? mission; } },
    agents: { async findById() { return overrides.agent ?? tony; } },
    workspaces: { async findById() { return null; } },
    tools,
  };
}

function approval(metadata: Record<string, unknown>): ApprovalRequest {
  return {
    id: "approval-1" as ApprovalId,
    organizationId: orgA,
    workId: mission.id,
    taskId: step.id,
    agentId: tony.id,
    action: step.title,
    resource: `task:${step.id}`,
    reason: "Needs a person.",
    status: "pending",
    createdAt: now,
    metadata,
  };
}

test("an external write explains what will change, who waits, and that only managers decide", async () => {
  const [briefed] = await briefApprovals(dependencies(), person("member"), [approval({ externalWrites: ["github_create_issue"] })]);
  const briefing = briefed!.briefing;

  assert.equal(briefing.requestedBy, "external_write");
  assert.deepEqual(briefing.externalWrites, ["Create GitHub issue"]);
  assert.equal(briefing.agent?.name, "Tony");
  assert.equal(briefing.step?.title, "Open the issue");
  assert.equal(briefing.risk, "high");
  assert.match(briefing.onApprove, /Create GitHub issue once/);
  assert.equal(briefing.decidedBy, "owners_and_admins");
  assert.equal(briefing.youCanDecide, false, "a member may not decide an external write");

  const [asAdmin] = await briefApprovals(dependencies(), person("admin"), [approval({ externalWrites: ["github_create_issue"] })]);
  assert.equal(asAdmin!.briefing.youCanDecide, true);
});

test("the reason names the policy or skill, and a planner request stays with members", async () => {
  const [policy] = await briefApprovals(dependencies(), person("member"), [approval({ policyId: "p1", policyName: "Finance review" })]);
  assert.equal(policy!.briefing.requestedBy, "policy");
  assert.equal(policy!.briefing.policy?.name, "Finance review");

  const [skill] = await briefApprovals(dependencies(), person("member"), [approval({ skill: "Candidate screening" })]);
  assert.equal(skill!.briefing.requestedBy, "skill");
  assert.equal(skill!.briefing.decidedBy, "owners_and_admins");

  const [planner] = await briefApprovals(dependencies(), person("member"), [approval({})]);
  assert.equal(planner!.briefing.requestedBy, "planner");
  assert.equal(planner!.briefing.youCanDecide, true);
  assert.equal((await briefApprovals(dependencies(), person("viewer"), [approval({})]))[0]!.briefing.youCanDecide, false);
});

test("nothing from another organization is described, and no agent instructions leave", async () => {
  const foreignMission = { ...mission, organizationId: orgB };
  const [briefed] = await briefApprovals(dependencies({ work: foreignMission, agent: { ...tony, organizationId: orgB } }), person("owner"), [approval({})]);

  assert.equal(briefed!.briefing.mission, null);
  assert.equal(briefed!.briefing.step, null);
  assert.equal(briefed!.briefing.agent, null);
  assert.doesNotMatch(JSON.stringify(briefed), /SECRET PROMPT/);
});
