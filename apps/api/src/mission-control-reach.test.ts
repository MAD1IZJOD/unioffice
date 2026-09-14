import assert from "node:assert/strict";
import test from "node:test";

import type { WorkspaceId } from "@unioffice/core";

import { missionControlFixture, orgA } from "./mission-control.fixture.js";

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

  const narrowed = await f.service.getMissionControl(orgA, { reach: companyOnly });
  const full = await f.service.getMissionControl(orgA);

  assert.equal(narrowed.summary.total, 1);
  assert.equal(narrowed.summary.needsYou, 1, "the stall they can see still needs them");
  assert.deepEqual(narrowed.blocked.map((card) => card.id), [company.id]);
  assert.doesNotMatch(JSON.stringify(narrowed), /Finance/);

  assert.equal(full.summary.total, 3);
  assert.match(JSON.stringify(full), /Finance decision/);
  assert.match(JSON.stringify(full), /Finance sign-off/);
});

test("the attention queue is narrowed the same way", async () => {
  const { f } = financeCompany();

  const narrowed = await f.service.getAttention(orgA, { reach: companyOnly });
  const full = await f.service.getAttention(orgA);

  assert.doesNotMatch(JSON.stringify(narrowed), /Finance/);
  assert.match(JSON.stringify(full), /Finance/);
  assert.ok(full.items.length > narrowed.items.length);
});
