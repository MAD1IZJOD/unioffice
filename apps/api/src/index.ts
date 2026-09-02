import {
  DefaultAgentRuntime,
  OllamaModelProvider,
} from "@unioffice/agents";

import {
  createSupabaseAdminClient,
  SupabaseAgentRepository,
  SupabaseEventRepository,
  SupabaseOrganizationRepository,
  SupabaseTaskRepository,
  SupabaseWorkRepository,
} from "@unioffice/database";

import {
  DefaultDelegator,
  DefaultExecutionEngine,
  OllamaPlanner,
} from "@unioffice/orchestrator";

import {
  fileURLToPath,
} from "node:url";

import {
  WorkApplicationService,
} from "./application.js";

import {
  loadApiConfig,
} from "./config.js";

import {
  ensureDevelopmentWorkforce,
} from "./development-workforce.js";

import {
  EventRecorder,
} from "./event-recorder.js";

import {
  buildApiServer,
} from "./server.js";

import {
  TaskExecutionService,
} from "./task-execution-service.js";

import {
  WorkExecutionService,
} from "./work-execution-service.js";

import {
  WorkQueryService,
} from "./work-query-service.js";

import {
  WorkService,
} from "./work-service.js";

export async function createApiServer() {
  const config = loadApiConfig();
  const supabase = createSupabaseAdminClient();
  const organizationRepository =
    new SupabaseOrganizationRepository(supabase);
  const agentRepository =
    new SupabaseAgentRepository(supabase);
  const workRepository =
    new SupabaseWorkRepository(supabase);
  const taskRepository =
    new SupabaseTaskRepository(supabase);
  const eventRepository =
    new SupabaseEventRepository(supabase);
  const eventRecorder = new EventRecorder(eventRepository);
  const modelProvider = new OllamaModelProvider({
    baseUrl: config.ollamaBaseUrl,
    defaultModel: config.ollamaModel,
  });
  const planner = new OllamaPlanner(
    modelProvider,
    config.ollamaModel,
  );
  const delegator = new DefaultDelegator(agentRepository);
  const agentRuntime = new DefaultAgentRuntime(
    modelProvider,
    {
      model: config.ollamaModel,
      think: false,
    },
  );
  const executionEngine = new DefaultExecutionEngine(
    agentRuntime,
  );
  const applicationService = new WorkApplicationService(
    workRepository,
    eventRecorder,
  );
  const workService = new WorkService(
    workRepository,
    taskRepository,
    agentRepository,
    planner,
    delegator,
    eventRecorder,
  );
  const taskExecutionService = new TaskExecutionService(
    taskRepository,
    agentRepository,
    executionEngine,
    eventRecorder,
  );
  const workExecutionService = new WorkExecutionService(
    workRepository,
    taskRepository,
    taskExecutionService,
    eventRecorder,
  );
  const workQueryService = new WorkQueryService(
    workRepository,
    taskRepository,
    eventRepository,
  );

  const developmentOrganization =
    config.seedDevelopmentWorkforce
      ? await ensureDevelopmentWorkforce(
          organizationRepository,
          agentRepository,
        )
      : undefined;

  return buildApiServer({
    applicationService,
    workService,
    workExecutionService,
    workQueryService,
    developmentOrganizationId:
      developmentOrganization?.organization.id,
    healthCheck: async () => {
      const { error } = await supabase
        .from("organizations")
        .select("id")
        .limit(1);

      if (error) {
        throw new Error(
          `Supabase health check failed: ${error.message}`,
        );
      }

      const ollamaResponse = await fetch(
        `${config.ollamaBaseUrl}/api/tags`,
      );

      if (!ollamaResponse.ok) {
        throw new Error(
          `Ollama health check failed: ${ollamaResponse.status}`,
        );
      }

      return {
        supabase: "ready",
        ollama: "ready",
        model: config.ollamaModel,
        developmentOrganizationId:
          developmentOrganization?.organization.id,
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

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === process.argv[1]
) {
  start().catch((error: unknown) => {
    console.error(
      error instanceof Error
        ? error.message
        : error,
    );
    process.exitCode = 1;
  });
}
