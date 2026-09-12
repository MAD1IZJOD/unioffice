import { fileURLToPath } from "node:url";

import { loadApiConfig } from "./config.js";
import { ensureDevelopmentWorkforce } from "./development-workforce.js";
import { createExecutionRuntime } from "./runtime.js";
import { buildApiServer } from "./server.js";

export { createExecutionRuntime } from "./runtime.js";
export type { ExecutionRuntime } from "./runtime.js";
export { loadApiConfig } from "./config.js";
export type { ApiConfig } from "./config.js";
export { ExecutionWorker } from "./execution-worker.js";
export { ExecutionStream } from "./execution-stream.js";
export type { ExecutionWorkerOptions } from "./execution-worker.js";

export async function createApiServer() {
  const config = loadApiConfig();
  const runtime = createExecutionRuntime(config);

  // Work interrupted by a previous restart is put back on a recoverable
  // footing. The worker owns queue-level lease recovery; this handles work
  // rows left mid-run by a process that predates the queue.
  try {
    const reconciled = await runtime.staleRunReconciler.reconcile();

    if (reconciled.recoveredWork.length > 0) {
      console.warn(
        `Recovered ${reconciled.recoveredWork.length} work item(s) interrupted by a previous restart, ` +
        `covering ${reconciled.interruptedTaskCount} unfinished task(s). They can be retried.`,
      );
    }
  } catch (error) {
    // Startup must not depend on reconciliation succeeding; the worst case is
    // that stale work stays stale until the next boot.
    console.warn(
      `Could not reconcile interrupted runs: ${errorMessage(error)}`,
    );
  }

  const developmentOrganization = config.seedDevelopmentWorkforce
    ? await ensureDevelopmentWorkforce(
        runtime.organizationRepository,
        runtime.agentRepository,
      )
    : undefined;

  return buildApiServer({
    applicationService: runtime.applicationService,
    workService: runtime.workService,
    workExecutionService: runtime.workExecutionService,
    workApprovalService: runtime.workApprovalService,
    workQueryService: runtime.workQueryService,
    workRecoveryService: runtime.workRecoveryService,
    attentionService: runtime.attentionService,
    executionQueueService: runtime.executionQueueService,
    executionRoomService: runtime.executionRoomService,
    executionStream: runtime.executionStream,
    companyBrainService: runtime.companyBrainService,
    companyOverviewService: runtime.companyOverviewService,
    governanceService: runtime.governanceService,
    governanceOverviewService: runtime.governanceOverviewService,
    workspaceService: runtime.workspaceService,
    agentDirectoryService: runtime.agentDirectoryService,
    toolRegistry: runtime.toolRegistry,
    developmentOrganizationId: developmentOrganization?.organization.id,
    corsOrigins: config.corsOrigins,
    healthCheck: async () => {
      const { error } = await runtime.supabase
        .from("organizations")
        .select("id")
        .limit(1);

      if (error) {
        throw new Error(`Supabase health check failed: ${error.message}`);
      }

      const ollamaResponse = await fetch(`${config.ollamaBaseUrl}/api/tags`);

      if (!ollamaResponse.ok) {
        throw new Error(`Ollama health check failed: ${ollamaResponse.status}`);
      }

      // The queue is the API's link to the worker, so an unreachable queue
      // table is a real outage even when everything else answers.
      const queueDepth = await runtime.executionJobRepository
        .findByOrganization(
          developmentOrganization?.organization.id ??
            ("00000000-0000-0000-0000-000000000000" as never),
          1,
        )
        .then(() => "ready")
        .catch((queueError: unknown) => {
          throw new Error(
            `Execution queue health check failed: ${errorMessage(queueError)}`,
          );
        });

      return {
        supabase: "ready",
        ollama: "ready",
        executionQueue: queueDepth,
        model: config.ollamaModel,
        developmentOrganizationId: developmentOrganization?.organization.id,
      };
    },
  });
}

async function start(): Promise<void> {
  const config = loadApiConfig();
  const app = await createApiServer();

  await app.listen({
    port: config.port,
    host: "127.0.0.1",
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === process.argv[1]
) {
  start().catch((error: unknown) => {
    console.error(errorMessage(error));
    process.exitCode = 1;
  });
}
