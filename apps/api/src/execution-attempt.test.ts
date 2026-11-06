import assert from "node:assert/strict";
import test from "node:test";

import type { ExecutionJob } from "@unioffice/core";

import { executionDatabaseFetch, executionProviderFetch, runInExecutionAttempt } from "./execution-attempt.js";

const job = { id: "job-1", attempts: 2, claimedBy: "worker-b" } as ExecutionJob;

test("only attempt-scoped database calls carry the claim and its signal", async () => {
  const controller = new AbortController();
  const requests: RequestInit[] = [];
  const send = executionDatabaseFetch(async (_url, init) => {
    requests.push(init ?? {});
    return Response.json({});
  });
  await runInExecutionAttempt(job, controller, () => send("https://database.test/tasks", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
  }));
  await send("https://database.test/approvals", { method: "PATCH" });

  const headers = new Headers(requests[0]?.headers);
  assert.equal(headers.get("x-unioffice-job-id"), job.id);
  assert.equal(headers.get("x-unioffice-job-attempt"), "2");
  assert.equal(headers.get("x-unioffice-job-worker"), "worker-b");
  assert.equal(headers.get("content-type"), "application/json");
  assert.equal(requests[0]?.signal, controller.signal);
  assert.equal(new Headers(requests[1]?.headers).has("x-unioffice-job-id"), false);
});

test("a database claim rejection aborts the attempt before a provider request", async () => {
  const controller = new AbortController();
  let providerCalls = 0;
  const database = executionDatabaseFetch(async () => Response.json({
    code: "PT409",
    message: "execution_job_claim_lost",
  }, { status: 409 }));
  const provider = executionProviderFetch(async () => {
    await database("https://database.test/rpc/assert_execution_job_claim");
  }, async () => {
    providerCalls += 1;
    return Response.json({});
  });

  await runInExecutionAttempt(job, controller, async () => {
    await assert.rejects(provider("https://provider.test/resource"), /claim was lost/);
    await assert.rejects(database("https://database.test/artifacts", { method: "POST" }), /claim was lost/);
  });
  assert.equal(controller.signal.aborted, true);
  assert.equal(providerCalls, 0);
});
