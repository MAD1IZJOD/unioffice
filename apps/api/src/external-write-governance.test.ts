import assert from "node:assert/strict";
import test from "node:test";

import type {
  ApprovalRequest,
  OrganizationId,
  Policy,
  PolicyId,
  Task,
  TaskId,
  Work,
  WorkId,
} from "@unioffice/core";

import type { PolicyRepository } from "@unioffice/database";

import { createGitHubTools } from "@unioffice/connect";
import { createDefaultToolRegistry } from "@unioffice/tools";

import { canDecideApproval, type Access } from "./access/permissions.js";
import { GovernanceService } from "./governance-service.js";
import { PolicyTaskGovernanceGate } from "./task-governance-gate.js";
import { isGovernedByPolicy } from "./work-approval-service.js";

/**
 * An agent changing something in another system always waits for a person.
 *
 * Not a policy anyone can pause: with no rules at all, a step that needs a
 * GitHub write still stops for approval, a deny policy still wins, and the
 * approval can only be decided by someone who runs the organization.
 */

const organizationId = "aaaaaaaa-0000-4000-8000-000000000001" as OrganizationId;
const now = new Date("2026-09-16T12:00:00.000Z");

function governance(policies: Policy[] = []) {
  const registry = createDefaultToolRegistry();
  const unusedAccess = { async use() { throw new Error("not called"); } };
  for (const tool of createGitHubTools(unusedAccess)) registry.register(tool);

  const repository = { async findEnforced() { return policies; } } as unknown as PolicyRepository;
  const events: unknown[] = [];
  const service = new GovernanceService(repository, registry, { async record(event: unknown) { events.push(event); return event as never; } } as never);
  return { service, events };
}

const work = { id: "work-1" as WorkId, organizationId, objective: "Triage", status: "running", priority: "normal", createdAt: now, updatedAt: now, metadata: {} } as unknown as Work;

function step(requiredTools: string[]): Task {
  return {
    id: "task-1" as TaskId,
    workId: work.id,
    title: "File the bug",
    description: "",
    status: "pending",
    dependsOn: [],
    createdAt: now,
    updatedAt: now,
    metadata: { routing: { requiredTools } },
  } as Task;
}

function policy(overrides: Partial<Policy>): Policy {
  return {
    id: "00000000-0000-4000-8000-0000000000p1" as PolicyId,
    organizationId,
    name: "Rule",
    description: "A rule.",
    subject: "task",
    effect: "allow",
    risk: "low",
    status: "active",
    scope: { agentIds: [], toolIds: [], workspaceIds: [], capabilities: [] },
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } as Policy;
}

test("with no policies, a step needing an external write requires approval at high risk", async () => {
  const { service } = governance();

  const decision = await service.evaluateTask(work, step(["github_create_issue"]), undefined);

  assert.equal(decision.outcome, "require_approval");
  assert.equal(decision.risk, "high");
  assert.match(decision.summary, /changes something in GitHub/);
  assert.match(decision.approvalPrompt ?? "", /github_create_issue/);
});

test("reads and local tools are not held up", async () => {
  const { service } = governance();

  assert.equal((await service.evaluateTask(work, step(["github_issue", "github_pull_requests"]), undefined)).outcome, "allow");
  assert.equal((await service.evaluateTask(work, step(["calculator"]), undefined)).outcome, "allow");
  assert.equal((await service.evaluateTask(work, step([]), undefined)).outcome, "allow");
});

test("an allow policy cannot lower it, and a deny policy still wins", async () => {
  const allowing = governance([policy({ effect: "allow", name: "Engineering may use GitHub" })]);
  assert.equal((await allowing.service.evaluateTask(work, step(["github_create_pull_request"]), undefined)).outcome, "require_approval");

  const denying = governance([policy({ effect: "deny", risk: "critical", name: "No agent writes" })]);
  const denied = await denying.service.evaluateTask(work, step(["github_create_pull_request"]), undefined);
  assert.equal(denied.outcome, "deny");
  assert.equal(denied.decidingPolicyName, "No agent writes");
});

test("a policy's own approval prompt is kept", async () => {
  const { service } = governance([policy({ effect: "require_approval", name: "Review writes", approvalPrompt: "Check the repository first." })]);

  const decision = await service.evaluateTask(work, step(["github_create_branch"]), undefined);

  assert.equal(decision.outcome, "require_approval");
  assert.equal(decision.approvalPrompt, "Check the repository first.");
});

test("the gate names exactly which external writes the approval allows", async () => {
  const { service } = governance();
  const gate = new PolicyTaskGovernanceGate(service, { async findById() { return null; } } as never);

  const outcome = await gate.evaluate(work, step(["github_issue", "github_create_issue"]));

  assert.deepEqual(outcome.externalWrites, ["github_create_issue"]);
});

test("an approval for an external write is decided by an owner or admin, never a member", () => {
  const approval = { metadata: { externalWrites: ["github_create_issue"] } } as unknown as ApprovalRequest;
  const planner = { metadata: {} } as unknown as ApprovalRequest;

  assert.equal(isGovernedByPolicy(approval), true);
  assert.equal(isGovernedByPolicy(planner), false);
  assert.equal(isGovernedByPolicy(planner, { metadata: { approval: { externalWrites: ["github_create_issue"] } } } as unknown as Task), true);

  const person = (role: Access["role"]): Access => ({
    userId: "u" as Access["userId"],
    email: "p@example.test",
    organizationId,
    memberId: "m" as Access["memberId"],
    role,
    workspaces: new Map(),
  });

  assert.equal(canDecideApproval(person("member"), { governedByPolicy: isGovernedByPolicy(approval) }), false);
  assert.equal(canDecideApproval(person("admin"), { governedByPolicy: isGovernedByPolicy(approval) }), true);
});
