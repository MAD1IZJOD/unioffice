import { AsyncLocalStorage } from "node:async_hooks";

import type { ExecutionJob } from "@unioffice/core";

const attempts = new AsyncLocalStorage<{
  job: ExecutionJob;
  controller: AbortController;
}>();

export function runInExecutionAttempt<T>(
  job: ExecutionJob,
  controller: AbortController,
  run: () => Promise<T>,
): Promise<T> {
  return attempts.run({ job, controller }, run);
}

export function loseExecutionClaim(controller: AbortController): void {
  controller.abort(new Error("The execution job claim was lost."));
}

/** Carry the claim to PostgREST so guarded writes can check it in their own transaction. */
export function executionDatabaseFetch(fetchImpl: typeof fetch = fetch): typeof fetch {
  return async (input, init) => {
    const attempt = attempts.getStore();
    if (!attempt) return fetchImpl(input, init);

    const { job, controller } = attempt;
    controller.signal.throwIfAborted();
    const headers = new Headers(init?.headers);
    headers.set("x-unioffice-job-id", job.id);
    headers.set("x-unioffice-job-attempt", String(job.attempts));
    headers.set("x-unioffice-job-worker", job.claimedBy ?? "");
    const response = await fetchImpl(input, {
      ...init,
      headers,
      signal: combinedSignal(controller.signal, init?.signal),
    });

    if (response.status === 409) {
      const error = await response.clone().json().catch(() => null);
      if (error?.code === "PT409" && error.message === "execution_job_claim_lost") {
        loseExecutionClaim(controller);
      }
    }

    controller.signal.throwIfAborted();
    return response;
  };
}

/** Check ownership before each outbound request, including a connector's internal follow-up calls. */
export function executionProviderFetch(
  assertClaim: () => Promise<void>,
  fetchImpl: typeof fetch = fetch,
): typeof fetch {
  return async (input, init) => {
    const attempt = attempts.getStore();
    if (!attempt) return fetchImpl(input, init);

    const signal = combinedSignal(attempt.controller.signal, init?.signal);
    signal.throwIfAborted();
    await assertClaim();
    signal.throwIfAborted();
    return fetchImpl(input, { ...init, signal });
  };
}

function combinedSignal(signal: AbortSignal, other?: AbortSignal | null): AbortSignal {
  return other ? AbortSignal.any([signal, other]) : signal;
}
