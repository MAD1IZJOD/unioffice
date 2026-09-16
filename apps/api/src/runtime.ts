import {
  DefaultAgentRuntime,
  OllamaModelProvider,
} from "@unioffice/agents";

import {
  createSupabaseAdminClient,
  SupabaseAgentRepository,
  SupabaseApprovalRepository,
  SupabaseArtifactRepository,
  SupabaseConnectionRepository,
  SupabaseEventRepository,
  SupabaseExecutionJobRepository,
  SupabaseKnowledgeLinkRepository,
  SupabaseMembershipRepository,
  SupabaseMemoryRepository,
  SupabaseOperationalReadRepository,
  SupabaseOrganizationRepository,
  SupabasePolicyRepository,
  SupabaseTaskRepository,
  SupabaseWorkRepository,
  SupabaseWorkspaceRepository,
} from "@unioffice/database";

import {
  KnowledgeExtractor,
  OllamaEmbeddingProvider,
} from "@unioffice/memory";

import {
  DefaultDelegator,
  DefaultExecutionEngine,
  OllamaPlanner,
} from "@unioffice/orchestrator";

import { createDefaultToolRegistry } from "@unioffice/tools";

import { createDriveTools, createGitHubTools } from "@unioffice/connect";

import { AccessResolver } from "./access/access-resolver.js";
import { SupabaseAuthenticator } from "./access/authenticator.js";
import { MemberService } from "./access/member-service.js";
import { AgentDirectoryService } from "./agent-directory-service.js";
import { createConnectionProviders } from "./connections/connection-providers.js";
import { ConnectionResolver } from "./connections/connection-resolver.js";
import { ConnectionService } from "./connections/connection-service.js";
import { GovernanceOverviewService } from "./governance-overview-service.js";
import { GovernanceService } from "./governance-service.js";
import { GovernanceToolGuard } from "./governance-tool-guard.js";
import { PolicyTaskGovernanceGate } from "./task-governance-gate.js";
import { MissionControlService } from "./mission-control-service.js";
import { WorkforceService } from "./workforce-service.js";
import { WorkApplicationService } from "./application.js";
import { CompanyBrainService } from "./company-brain-service.js";
import { CompanyOverviewService } from "./company-overview-service.js";
import { EventRecorder } from "./event-recorder.js";
import { KnowledgeCaptureService } from "./knowledge-capture-service.js";
import { KnowledgeGovernance } from "./knowledge-governance.js";
import { KnowledgeRecallService } from "./knowledge-recall-service.js";
import { MissionTemplateService } from "./mission-template-service.js";
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
import { WorkCancellationService } from "./work-cancellation-service.js";
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
  const knowledgeLinkRepository = new SupabaseKnowledgeLinkRepository(supabase);
  const executionJobRepository = new SupabaseExecutionJobRepository(supabase);
  const policyRepository = new SupabasePolicyRepository(supabase);
  const workspaceRepository = new SupabaseWorkspaceRepository(supabase);
  const membershipRepository = new SupabaseMembershipRepository(supabase);
  const connectionRepository = new SupabaseConnectionRepository(supabase);

  // Tokens are checked with the auth server; what a verified person may do
  // comes from their membership, which only the API reads and writes.
  const authenticator = new SupabaseAuthenticator(supabase);
  const accessResolver = new AccessResolver(membershipRepository);

  const eventRecorder = new EventRecorder(eventRepository);

  const memberService = new MemberService(
    membershipRepository,
    workspaceRepository,
    eventRecorder,
  );

  const toolRegistry = createDefaultToolRegistry();

  // External systems join the same registry as every other tool, so they go
  // through the same grant check, the same governance guard and the same
  // executor. What makes them external - a connection resolved from the
  // mission's own organization at call time - lives behind the resolver, and
  // a tool has no way to name a connection of its own choosing.
  const connectionProviders = createConnectionProviders(config.connect);
  const connectionResolver = new ConnectionResolver(
    connectionRepository,
    connectionProviders,
    eventRecorder,
  );

  for (const tool of [
    ...createGitHubTools(connectionResolver),
    ...createDriveTools(connectionResolver),
  ]) {
    toolRegistry.register(tool);
  }

  const connectionService = new ConnectionService({
    connections: connectionRepository,
    members: membershipRepository,
    workspaces: workspaceRepository,
    providers: connectionProviders,
    toolRegistry,
    eventRecorder,
    publicApiUrl: config.connect.publicApiUrl,
    webUrl: config.connect.webUrl,
  });

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

  // Company knowledge. Built after governance for the same reason the tool
  // executor is: recall and capture both go through policy, so there is no
  // configuration in which knowledge reaches an agent without it.
  const embeddingProvider = config.embeddingModel
    ? new OllamaEmbeddingProvider({
        baseUrl: config.ollamaBaseUrl,
        model: config.embeddingModel,
      })
    : undefined;

  const knowledgeGovernance = new KnowledgeGovernance(
    policyRepository,
    governanceService,
  );

  const knowledgeRecallService = new KnowledgeRecallService(
    memoryRepository,
    knowledgeLinkRepository,
    knowledgeGovernance,
    eventRecorder,
    workRepository,
    taskRepository,
    artifactRepository,
    embeddingProvider,
  );

  const knowledgeCaptureService = new KnowledgeCaptureService(
    memoryRepository,
    knowledgeLinkRepository,
    knowledgeGovernance,
    eventRecorder,
    new KnowledgeExtractor(modelProvider, config.ollamaModel),
    embeddingProvider,
  );

  const companyBrainService = new CompanyBrainService(
    memoryRepository,
    knowledgeLinkRepository,
    knowledgeRecallService,
    knowledgeCaptureService,
    eventRecorder,
    workRepository,
    taskRepository,
    artifactRepository,
    workspaceRepository,
    agentRepository,
    embeddingProvider?.model,
  );

  const applicationService = new WorkApplicationService(
    workRepository,
    eventRecorder,
  );

  // Templates brief a mission and hand it to the same application service;
  // they own no execution of their own.
  const missionTemplateService = new MissionTemplateService(
    applicationService,
    agentRepository,
    workspaceRepository,
    policyRepository,
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
    knowledgeRecallService,
  );

  const taskExecutionService = new TaskExecutionService(
    taskRepository,
    artifactRepository,
    workRepository,
    agentRepository,
    executionEngine,
    eventRecorder,
    {
      recall: knowledgeRecallService,
      capture: knowledgeCaptureService,
    },
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

  // A plan older than the same window startup uses to call a run abandoned is
  // no longer being written, so a mission stuck there can be cancelled.
  const workCancellationService = new WorkCancellationService(
    workRepository,
    taskRepository,
    executionJobRepository,
    approvalRepository,
    eventRecorder,
    { planningStaleAfterMs: config.staleRunAfterMs },
  );

  // The company's operational state, and what needs a person, from one set of
  // lean reads. A mission sitting untouched past the same window startup uses
  // to call a run abandoned is reported as stalled rather than as in flight.
  const operationalReads = new SupabaseOperationalReadRepository(supabase);

  const missionControlService = new MissionControlService(
    {
      reads: operationalReads,
      works: workRepository,
      approvals: approvalRepository,
      jobs: executionJobRepository,
      agents: agentRepository,
      memories: memoryRepository,
      links: knowledgeLinkRepository,
      eventRecorder,
    },
    { stalledAfterMs: config.staleRunAfterMs },
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
    toolRegistry,
    eventRecorder,
  );

  // The roster and each agent's profile, from the same lean reads Mission
  // Control uses, so the two can never disagree about who is working.
  const workforceService = new WorkforceService({
    agents: agentRepository,
    reads: operationalReads,
    workspaces: workspaceRepository,
    policies: policyRepository,
    tools: toolRegistry,
    connections: connectionRepository,
  });

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
    knowledgeLinkRepository,
    executionJobRepository,
    policyRepository,
    membershipRepository,
    connectionRepository,
    connectionService,
    authenticator,
    accessResolver,
    memberService,
    eventRecorder,
    toolRegistry,
    applicationService,
    missionTemplateService,
    workService,
    taskExecutionService,
    workApprovalService,
    workExecutionService,
    workQueryService,
    missionControlService,
    executionQueueService,
    executionRoomService,
    executionStream,
    executionJobRunner,
    workRecoveryService,
    workCancellationService,
    companyBrainService,
    knowledgeRecallService,
    knowledgeCaptureService,
    knowledgeGovernance,
    companyOverviewService,
    governanceService,
    governanceOverviewService,
    taskGovernanceGate,
    workspaceService,
    agentDirectoryService,
    workforceService,
    staleRunReconciler,
  };
}

export type ExecutionRuntime = ReturnType<typeof createExecutionRuntime>;
