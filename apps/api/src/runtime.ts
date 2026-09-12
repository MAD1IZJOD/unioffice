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
  SupabasePolicyRepository,
  SupabaseTaskRepository,
  SupabaseWorkRepository,
  SupabaseWorkspaceRepository,
} from "@unioffice/database";

import { DefaultMemoryRetriever } from "@unioffice/memory";

import {
  DefaultDelegator,
  DefaultExecutionEngine,
  OllamaPlanner,
} from "@unioffice/orchestrator";

import { createDefaultToolRegistry } from "@unioffice/tools";

import { AgentDirectoryService } from "./agent-directory-service.js";
import { GovernanceOverviewService } from "./governance-overview-service.js";
import { GovernanceService } from "./governance-service.js";
import { GovernanceToolGuard } from "./governance-tool-guard.js";
import { PolicyTaskGovernanceGate } from "./task-governance-gate.js";
import { AttentionService } from "./attention-service.js";
import { WorkApplicationService } from "./application.js";
import { CompanyBrainService } from "./company-brain-service.js";
import { CompanyOverviewService } from "./company-overview-service.js";
import { EventRecorder } from "./event-recorder.js";
import { ExecutionJobRunner } from "./execution-job-runner.js";
import { ExecutionQueueService } from "./execution-queue-service.js";
import { ExecutionRoomService } from "./execution-room-service.js";
import { ExecutionStream } from "./execution-stream.js";
import { StaleRunReconciler } from "./stale-run-reconciler.js";
import { TaskExecutionService } from "./task-execution-service.js";
import { WorkApprovalService } from "./work-approval-service.js";
import { WorkExecutionService } from "./work-execution-service.js";
import { WorkQueryService } from "./work-query-service.js";
import { WorkRecoveryService } from "./work-recovery-service.js";
import { WorkService } from "./work-service.js";
import { WorkspaceService } from "./workspace-service.js";

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
  const policyRepository = new SupabasePolicyRepository(supabase);
  const workspaceRepository = new SupabaseWorkspaceRepository(supabase);

  const eventRecorder = new EventRecorder(eventRepository);
  const memoryRetriever = new DefaultMemoryRetriever(memoryRepository);
  const companyBrainService = new CompanyBrainService(
    memoryRepository,
    memoryRetriever,
  );

  const toolRegistry = createDefaultToolRegistry();

  // Governance is built before the agent runtime because the runtime's tool
  // executor takes the guard at construction. That ordering is the reason a
  // tool call cannot be made without passing through governance: there is no
  // configuration in which the executor exists without it.
  const governanceService = new GovernanceService(
    policyRepository,
    toolRegistry,
    eventRecorder,
  );

  const governanceToolGuard = new GovernanceToolGuard(governanceService);

  const modelProvider = new OllamaModelProvider({
    baseUrl: config.ollamaBaseUrl,
    defaultModel: config.ollamaModel,
  });
  const planner = new OllamaPlanner(modelProvider, config.ollamaModel);
  const delegator = new DefaultDelegator(agentRepository);
  const agentRuntime = new DefaultAgentRuntime(modelProvider, {
    model: config.ollamaModel,
    think: false,
    toolRegistry,
    toolGuard: governanceToolGuard,
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

  const taskGovernanceGate = new PolicyTaskGovernanceGate(
    governanceService,
    agentRepository,
  );

  const workExecutionService = new WorkExecutionService(
    workRepository,
    taskRepository,
    taskExecutionService,
    eventRecorder,
    workApprovalService,
    taskGovernanceGate,
  );

  const workQueryService = new WorkQueryService(
    workRepository,
    taskRepository,
    eventRepository,
    artifactRepository,
    agentRepository,
    approvalRepository,
    memoryRepository,
  );

  const executionQueueService = new ExecutionQueueService(
    executionJobRepository,
    workRepository,
    taskRepository,
    eventRecorder,
  );

  // Reads the event log forward for everyone connected to the live channel.
  // It is built here rather than in the API entry point because the worker
  // shares this wiring, and a runtime that could only produce half a system
  // depending on who asked is the thing this file exists to prevent.
  const executionStream = new ExecutionStream(eventRepository, {
    tailIntervalMs: config.streamTailIntervalMs,
    log: (message) => console.warn(message),
  });

  const executionJobRunner = new ExecutionJobRunner(
    workExecutionService,
    executionJobRepository,
    workRepository,
    taskRepository,
    eventRecorder,
  );

  // One read for one operation. Everything the execution room renders comes
  // from here, so the browser never assembles a mission out of four requests
  // whose answers were taken at four different moments.
  const executionRoomService = new ExecutionRoomService(
    workRepository,
    taskRepository,
    eventRepository,
    artifactRepository,
    approvalRepository,
    agentRepository,
    memoryRepository,
    workspaceRepository,
    executionJobRepository,
    toolRegistry,
  );

  const workRecoveryService = new WorkRecoveryService(
    workRepository,
    taskRepository,
    eventRecorder,
  );

  // What needs a person, read across the whole company rather than across
  // whichever slice a dashboard read happened to carry.
  const attentionService = new AttentionService(
    approvalRepository,
    workRepository,
    executionJobRepository,
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

  const governanceOverviewService = new GovernanceOverviewService(
    policyRepository,
    agentRepository,
    approvalRepository,
    eventRepository,
    workspaceRepository,
    toolRegistry,
  );

  const workspaceService = new WorkspaceService(
    workspaceRepository,
    organizationRepository,
    agentRepository,
    workRepository,
    artifactRepository,
    eventRepository,
    eventRecorder,
  );

  const agentDirectoryService = new AgentDirectoryService(
    agentRepository,
    workspaceRepository,
    taskRepository,
    workRepository,
    artifactRepository,
    eventRepository,
    toolRegistry,
    eventRecorder,
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
    workspaceRepository,
    agentRepository,
    workRepository,
    taskRepository,
    approvalRepository,
    artifactRepository,
    eventRepository,
    memoryRepository,
    executionJobRepository,
    policyRepository,
    eventRecorder,
    toolRegistry,
    applicationService,
    workService,
    taskExecutionService,
    workApprovalService,
    workExecutionService,
    workQueryService,
    attentionService,
    executionQueueService,
    executionRoomService,
    executionStream,
    executionJobRunner,
    workRecoveryService,
    companyBrainService,
    companyOverviewService,
    governanceService,
    governanceOverviewService,
    taskGovernanceGate,
    workspaceService,
    agentDirectoryService,
    staleRunReconciler,
  };
}

export type ExecutionRuntime = ReturnType<typeof createExecutionRuntime>;
