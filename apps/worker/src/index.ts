import { fileURLToPath } from "node:url";

import {
  createExecutionRuntime,
  ExecutionWorker,
  loadApiConfig,
} from "@unioffice/api";

/**
 * The worker process.
 *
 * It shares the API's runtime wiring - same repositories, same execution
 * pipeline, same event recorder - and differs only in what starts the work.
 * The API accepts objectives and puts them on the durable queue; this takes
 * them off and executes them, so a run survives the API restarting, and the
 * two can be started, stopped and scaled independently.
 */
export async function startWorker(): Promise<ExecutionWorker> {
  const config = loadApiConfig();
  const runtime = createExecutionRuntime(config);

  const worker = new ExecutionWorker(
    runtime.executionJobRepository,
    runtime.executionJobRunner,
    {
      pollIntervalMs: config.workerPollIntervalMs,
      leaseMs: config.workerLeaseMs,
      concurrency: config.workerConcurrency,
    },
  );

  const shutdown = () => {
    console.log("Stopping worker; finishing in-flight jobs first.");
    void worker.stop().then(() => process.exit(0));
  };

  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);

  void worker.run();

  return worker;
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === process.argv[1]
) {
  startWorker().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
