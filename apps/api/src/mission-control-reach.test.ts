import assert from "node:assert/strict";
import test from "node:test";

import type { KnowledgeConflictId, WorkspaceId } from "@unioffice/core";

import { asOwner, asRole, missionControlFixture, orgA } from "./mission-control.fixture.js";

const finance = "f0000000-0000-4000-8000-00000000000f" as WorkspaceId;

/** Only company-wide missions: someone with no workspace grants. */
const companyOnly = (workspaceId: WorkspaceId | undefined) => !workspaceId;

function financeCompany() {
  const f = missionControlFixture();
  const company = f.work("Company-wide stall", { updatedAt: f.ago(120) });
  f.work("Finance stall", { workspaceId: finance, updatedAt: f.ago(120) });
  const deciding = f.work("Finance sign-off", { workspaceId: finance, status: "waiting_approval", updatedAt: f.ago(3) });
  const step = f.task(deciding, "Sign off the Finance payment", { status: "waiting" });
  f.approval(deciding, step, { reason: "Finance policy needs a person." });

  return { f, company };
}

test("Mission Control shows a narrowed caller only the missions, approvals and knowledge they reach", async () => {
  const { f, company } = financeCompany();
  await f.memory({ type: "decision", title: "Company decision" });
  await f.memory({ type: "decision", title: "Finance decision", workspaceId: finance });

  const narrowed = await f.service.getMissionControl(orgA, { ...asOwner, reach: companyOnly });
  const full = await f.service.getMissionControl(orgA, asOwner);

  assert.equal(narrowed.summary.total, 1);
  assert.equal(narrowed.summary.needsYou, 1, "the stall they can see still needs them");
  assert.deepEqual(narrowed.blocked.map((card) => card.id), [company.id]);
  assert.doesNotMatch(JSON.stringify(narrowed), /Finance/);

  assert.equal(full.summary.total, 3);
  assert.match(JSON.stringify(full), /Finance decision/);
  assert.match(JSON.stringify(full), /Finance sign-off/);
});

test("the workforce roster leaves out agents working in workspaces the caller was not given", async () => {
  const { f } = financeCompany();
  f.agent("Tony");
  f.agent("Ledger", { workspaceId: finance, status: "paused" });

  const narrowed = await f.service.getMissionControl(orgA, { ...asOwner, reach: companyOnly });
  const full = await f.service.getMissionControl(orgA, asOwner);

  assert.deepEqual(narrowed.workforce.roster.map((entry) => entry.name), ["Tony"]);
  assert.equal(narrowed.workforce.total, 1);
  assert.deepEqual(narrowed.workforce.unavailable, []);
  assert.deepEqual(full.workforce.roster.map((entry) => entry.name).sort(), ["Ledger", "Tony"]);
});

test("the attention queue is narrowed the same way", async () => {
  const { f } = financeCompany();

  const narrowed = await f.service.getAttention(orgA, { ...asOwner, reach: companyOnly });
  const full = await f.service.getAttention(orgA, asOwner);

  assert.doesNotMatch(JSON.stringify(narrowed), /Finance/);
  assert.match(JSON.stringify(full), /Finance/);
  assert.ok(full.items.length > narrowed.items.length);
});

/* --------------------------------------------------------------------------
   Who the queue is for
   -------------------------------------------------------------------------- */

/**
 * The same company, read by people with different standing. Nothing about
 * the rows changes; what changes is which of them this person can do
 * anything about, decided by the production permission rules.
 */
function companyNeedingPeople() {
  const f = missionControlFixture();
  const stopped = f.work("Reconcile the ledger", { status: "failed", updatedAt: f.ago(30), completedAt: f.ago(30) });
  const deciding = f.work("Send the launch email", { status: "waiting_approval", updatedAt: f.ago(3) });
  const step = f.task(deciding, "Send it", { status: "waiting" });
  f.approval(deciding, step, { reason: "This would contact customers directly." });

  return { f, stopped, deciding };
}

test("a viewer is shown what is holding the company up, and never a control they cannot use", async () => {
  const { f } = companyNeedingPeople();

  const queue = await f.service.getAttention(orgA, asRole("viewer"));

  assert.ok(queue.total >= 2, "they can see the state of the company");
  assert.deepEqual(
    queue.items.filter((item) => item.severity === "action").map((item) => item.actionable),
    queue.items.filter((item) => item.severity === "action").map(() => false),
  );
  assert.equal(queue.actionCount, 0, "nothing here is theirs to do");
  assert.ok(queue.waitingOnOthersCount >= 2);
  for (const item of queue.items) {
    if (!item.actionable) assert.ok(item.handoff, `${item.kind} says whose it is`);
  }
});

test("an owner is shown the same entries as theirs to act on", async () => {
  const { f } = companyNeedingPeople();

  const queue = await f.service.getAttention(orgA, asOwner);

  assert.ok(queue.actionCount >= 2);
  assert.equal(queue.waitingOnOthersCount, 0);
  assert.deepEqual(queue.items.map((item) => item.handoff).filter(Boolean), []);
});

test("a member may decide an ordinary approval and run missions, but not settle what the company knows", async () => {
  const { f } = companyNeedingPeople();
  const left = await f.memory({ title: "Enterprise pricing is 100000", content: "From the pricing review." });
  const right = await f.memory({ title: "Enterprise pricing is 120000", content: "From the sales analysis." });
  await f.knowledge.createConflict({
    id: crypto.randomUUID() as KnowledgeConflictId,
    organizationId: orgA,
    memoryId: left.id,
    conflictingMemoryId: right.id,
    reason: "They state different amounts for the same subject.",
    signals: {},
    status: "open",
    detectedAt: f.ago(5),
  });

  const queue = await f.service.getAttention(orgA, asRole("member"));
  const byKind = new Map(queue.items.map((item) => [item.kind, item]));

  assert.equal(byKind.get("decision")?.actionable, true);
  assert.equal(byKind.get("failure")?.actionable, true);
  assert.equal(byKind.get("conflict")?.actionable, false);
  assert.match(byKind.get("conflict")?.handoff ?? "", /owner or an admin/);
});

test("a step a governance policy stopped is an owner's or an admin's, and says why", async () => {
  const f = missionControlFixture();
  const governed = f.work("Pay the invoice", { status: "waiting_approval", updatedAt: f.ago(2) });
  const step = f.task(governed, "Pay it", { status: "waiting" });
  f.approval(governed, step, {
    reason: "A rule asks a person about payments.",
    metadata: { policyId: "9f0c3a1e-0000-4000-8000-00000000000a" },
  });

  const member = await f.service.getAttention(orgA, asRole("member"));
  const admin = await f.service.getAttention(orgA, asRole("admin"));

  assert.equal(member.items[0]?.actionable, false);
  assert.match(member.items[0]?.handoff ?? "", /A policy stopped this step/);
  assert.equal(admin.items[0]?.actionable, true);
});

test("a member reaching a workspace only as a viewer is not offered its missions", async () => {
  const f = missionControlFixture();
  f.work("Finance clean-up", { workspaceId: finance, status: "failed", updatedAt: f.ago(30), completedAt: f.ago(30) });

  const watching = await f.service.getAttention(orgA, asRole("member", new Map([[finance, "viewer"]])));
  const working = await f.service.getAttention(orgA, asRole("member", new Map([[finance, "member"]])));

  assert.equal(watching.items[0]?.actionable, false, "a viewer grant never lets them act, whatever the role says");
  assert.equal(watching.items[0]?.acknowledgeable, false);
  assert.equal(working.items[0]?.actionable, true);
  assert.equal(working.items[0]?.acknowledgeable, true);
});
