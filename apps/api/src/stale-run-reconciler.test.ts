import assert from "node:assert/strict";
import test from "node:test";

import type { Work } from "@unioffice/core";
import type { SupabaseWorkRepository } from "@unioffice/database";

import { StaleRunReconciler } from "./stale-run-reconciler.js";

const now = new Date("2026-11-06T06:30:00.000Z");
const old = new Date("2026-11-06T06:00:00.000Z");

function mission(id: string, status: Work["status"], updatedAt = old): Work {
  return {
    id: id as Work["id"],
    organizationId: "organization-1" as Work["organizationId"],
    requesterId: "user-1" as Work["requesterId"],
    objective: "Test objective.",
    priority: "normal",
    status,
    createdAt: old,
    updatedAt,
    metadata: {},
  };
}

test("only stale planning and executing missions reach the guarded reconciliation", async () => {
  const candidates = [
    mission("owned-by-worker", "executing"),
    mission("abandoned", "executing"),
    mission("stale-planning", "planning"),
    mission("recent", "executing", new Date("2026-11-06T06:29:00.000Z")),
    mission("completed", "completed"),
  ];
  const reconciled: string[] = [];
  const repository: Pick<SupabaseWorkRepository, "findByStatuses" | "reconcileAbandonedRun"> = {
    async findByStatuses(statuses) {
      assert.deepEqual(statuses, ["executing", "planning"]);
      return candidates.filter((work) => statuses.includes(work.status));
    },
    async reconcileAbandonedRun(candidate, cutoff, detectedAt) {
      reconciled.push(candidate.id);
      assert.equal(cutoff.toISOString(), "2026-11-06T06:15:00.000Z");
      assert.equal(detectedAt, now);
      if (candidate.id === "owned-by-worker") return null;
      return {
        work: { ...candidates.find((work) => work.id === candidate.id)!, status: "failed" },
        interruptedTaskCount: candidate.status === "executing" ? 2 : 0,
      };
    },
  };

  const result = await new StaleRunReconciler(repository, 15 * 60_000, () => now).reconcile();

  assert.deepEqual(reconciled, ["owned-by-worker", "abandoned", "stale-planning"]);
  assert.deepEqual(result.recoveredWork.map((work) => work.id), ["abandoned", "stale-planning"]);
  assert.equal(result.interruptedTaskCount, 2);
});
