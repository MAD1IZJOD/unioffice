import assert from "node:assert/strict";
import test from "node:test";

import {
  MODEL_UNAVAILABLE_REASON,
  publicFailureReason,
  STORAGE_FAILURE_REASON,
} from "./public-failure.js";

/**
 * Every raw reason below is one the live store actually recorded on a failed
 * mission, so these are the cases that were reaching the page.
 */

test("a model server crash is named by what it means, not by its output", () => {
  assert.equal(
    publicFailureReason('Ollama request failed (500): {"error":"llama-server process has terminated: exit status 1: ggml_backend_cpu_buffer_type_alloc_buffer: failed"}'),
    MODEL_UNAVAILABLE_REASON,
  );
  assert.equal(
    publicFailureReason('Ollama request failed (500): {"error":"timed out waiting for llama-server to start - "}'),
    MODEL_UNAVAILABLE_REASON,
  );
});

test("a storage failure never reaches a person as a driver message", () => {
  assert.equal(
    publicFailureReason('Failed to update work: duplicate key value violates unique constraint "works_pkey"'),
    STORAGE_FAILURE_REASON,
  );
  assert.equal(publicFailureReason("connection to supabase refused"), STORAGE_FAILURE_REASON);
});

test("a reason the product phrased keeps its words and loses the row id", () => {
  assert.equal(
    publicFailureReason("No eligible agent is authorized for the required tool(s): calculator (task: c26cc1d4-d59b-4733-a26e-61d02fd4f0dc)"),
    "No eligible agent is authorized for the required tool(s): calculator.",
  );
  assert.equal(
    publicFailureReason("No eligible agents available for task: 7d82be15-57a5-4588-8608-76b7caf6190f"),
    "No eligible agents available.",
  );
  assert.equal(
    publicFailureReason("Approval rejected for task: Perform Multiplication"),
    "Approval rejected for task: Perform Multiplication.",
  );
  assert.equal(publicFailureReason("Interrupted by an API restart."), "Interrupted by an API restart.");
});

test("a stack trace is never carried, and length is bounded", () => {
  const reason = publicFailureReason(`Planner returned no tasks.\n    at OllamaPlanner.plan (D:\\app\\planner.ts:12:3)`);
  assert.equal(reason, "Planner returned no tasks.");

  const long = publicFailureReason(`Step failed ${"because ".repeat(100)}`);
  assert.ok(long!.length <= 240);
  assert.ok(long!.endsWith("…"));
});

test("nothing to say is said as nothing", () => {
  assert.equal(publicFailureReason(undefined), undefined);
  assert.equal(publicFailureReason("   "), undefined);
  assert.equal(publicFailureReason("7d82be15-57a5-4588-8608-76b7caf6190f"), undefined);
});
