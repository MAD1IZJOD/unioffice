import {
  DefaultAgentRuntime,
  OllamaModelProvider,
} from "@unioffice/agents";

import {
  createSupabaseAdminClient,
  SupabaseAgentRepository,
  SupabaseApprovalRepository,
  SupabaseArtifactRepository,
  SupabaseEventRepository,
  SupabaseExecutionJobRepository,
  SupabaseMemoryRepository,
  SupabaseOrganizationRepository,
  SupabaseTaskRepository,
  SupabaseWorkRepository,
} from "@unioffice/database";

import { DefaultMemoryRetriever } from "@unioffice/memory";

import {
  DefaultDelegator,
  DefaultExecutionEngine,
  OllamaPlanner,
} from "@unioffice/orchestrator";

import { createDefaultToolRegistry } from "@unioffice/tools";

import { WorkApplicationService } from "./application.js";
import { CompanyBrainService } from "./company-brain-service.js";
import { CompanyOverviewService } from "./company-overview-service.js";
import { EventRecorder } from "./event-recorder.js";
import { ExecutionJobRunner } from "./execution-job-runner.js";
import { ExecutionQueueService } from "./execution-queue-service.js";
import { StaleRunReconciler } from "./stale-run-reconciler.js";
import { TaskExecutionService } from "./task-execution-service.js";
import { WorkApprovalService } from "./work-approval-service.js";
import { WorkExecutionService } from "./work-execution-service.js";
import { WorkQueryService } from "./work-query-service.js";
import { WorkRecoveryService } from "./work-recovery-service.js";
import { WorkService } from "./work-service.js";

import type { ApiConfig } from "./config.js";

/**
 * Builds the whole backend runtime from configuration.
 *
 * The API and the worker are two entry points into the same system: the API
 * accepts objectives and puts them on the queue, the worker takes them off and
 * executes them. Both need the same repositories, the same execution pipeline
 * and the same event recorder, so the wiring lives here once rather than being
 * copied into each process where the two copies could drift apart.
 */
export function createExecutionRuntime(config: ApiConfig) {
  const supabase = createSupabaseAdminClient();

  const organizationRepository = new SupabaseOrganizationRepository(supabase);
  const agentRepository = new SupabaseAgentRepository(supabase);
  const workRepository = new SupabaseWorkRepository(supabase);
  const taskRepository = new SupabaseTaskRepository(supabase);
  const approvalRepository = new SupabaseApprovalRepository(supabase);
  const artifactRepository = new SupabaseArtifactRepository(supabase);
  const eventRepository = new SupabaseEventRepository(supabase);
  const memoryRepository = new SupabaseMemoryRepository(supabase);
  const executionJobRepository = new SupabaseExecutionJobRepository(supabase);

  const eventRecorder = new EventRecorder(eventRepository);
  const memoryRetriever = new DefaultMemoryRetriever(memoryRepository);
  const companyBrainService = new CompanyBrainService(
    memoryRepository,
    memoryRetriever,
  );

  const modelProvider = new OllamaModelProvider({
    baseUrl: config.ollamaBaseUrl,
    defaultModel: config.ollamaModel,
  });
  const planner = new OllamaPlanner(modelProvider, config.ollamaModel);
  const delegator = new DefaultDelegator(agentRepository);
  const toolRegistry = createDefaultToolRegistry();
  const agentRuntime = new DefaultAgentRuntime(modelProvider, {
    model: config.ollamaModel,
    think: false,
    toolRegistry,
    // A genuinely multi-step deterministic task (e.g. a month-by-month
    // projection) needs one tool call per step; 3 was too tight for real
    // work and only ever exercised in unit tests with a single call.
    maxToolCalls: 10,
  });
  const executionEngine = new DefaultExecutionEngine(agentRuntime);

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
    toolRegistry.list().map((tool) => ({
      id: tool.id,
      name: tool.name,
      description: tool.description,
    })),
  );

  const taskExecutionService = new TaskExecutionService(
    taskRepository,
    artifactRepository,
    workRepository,
    agentRepository,
    executionEngine,
    eventRecorder,
    companyBrainService,
  );

  const workApprovalService = new WorkApprovalService(
    approvalRepository,
    taskRepository,
    workRepository,
    eventRecorder,
  );

  const workExecutionService = new WorkExecutionService(
    workRepository,
    taskRepository,
    taskExecutionService,
    eventRecorder,
    workApprovalService,
  );

  const workQueryService = new WorkQueryService(
    workRepository,
    taskRepository,
    eventRepository,
    artifactRepository,
    agentRepository,
    approvalRepository,
  );

  const executionQueueService = new ExecutionQueueService(
    executionJobRepository,
    workRepository,
    taskRepository,
    eventRecorder,
  );

  const executionJobRunner = new ExecutionJobRunner(
    workExecutionService,
    executionJobRepository,
    workRepository,
    eventRecorder,
  );

  const workRecoveryService = new WorkRecoveryService(
    workRepository,
    taskRepository,
    eventRecorder,
  );

  const companyOverviewService = new CompanyOverviewService(
    workRepository,
    taskRepository,
    agentRepository,
    approvalRepository,
    artifactRepository,
    eventRepository,
    toolRegistry,
  );

  const staleRunReconciler = new StaleRunReconciler(
    workRepository,
    taskRepository,
    eventRecorder,
    config.staleRunAfterMs,
  );

  return {
    config,
    supabase,
    organizationRepository,
    agentRepository,
    workRepository,
    taskRepository,
    approvalRepository,
    artifactRepository,
    eventRepository,
    memoryRepository,
    executionJobRepository,
    eventRecorder,
    toolRegistry,
    applicationService,
    workService,
    taskExecutionService,
    workApprovalService,
    workExecutionService,
    workQueryService,
    executionQueueService,
    executionJobRunner,
    workRecoveryService,
    companyBrainService,
    companyOverviewService,
    staleRunReconciler,
  };
}

export type ExecutionRuntime = ReturnType<typeof createExecutionRuntime>;
