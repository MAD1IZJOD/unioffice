import Fastify from "fastify";

import rateLimit from "@fastify/rate-limit";

import {
  KNOWLEDGE_SOURCE_TYPES,
  KNOWLEDGE_STATUSES,
  KNOWLEDGE_TYPES,
} from "@unioffice/core";

import type {
  AgentId,
  AgentStatus,
  AgentType,
  ArtifactId,
  Event,
  KnowledgeConflictId,
  KnowledgeSourceType,
  KnowledgeStatus,
  MemoryId,
  MemoryType,
  OrganizationId,
  PolicyEffect,
  PolicyId,
  PolicyStatus,
  PolicySubject,
  RiskLevel,
  ApprovalId,
  UserId,
  WorkId,
  WorkPriority,
  WorkspaceId,
  WorkspaceStatus,
  WorkStatus,
} from "@unioffice/core";

import type {
  CreateWorkInput,
  WorkApplicationService,
} from "./application.js";

import type {
  WorkExecutionService,
} from "./work-execution-service.js";

import type {
  WorkQueryService,
} from "./work-query-service.js";

import type {
  WorkService,
} from "./work-service.js";

import type {
  WorkApprovalService,
} from "./work-approval-service.js";

import { ApprovalConflictError } from "./work-approval-service.js";

import type {
  WorkRecoveryService,
} from "./work-recovery-service.js";

import type {
  AttentionService,
} from "./attention-service.js";

import type {
  ExecutionQueueService,
} from "./execution-queue-service.js";

import type {
  GovernanceService,
} from "./governance-service.js";

import {
  PolicyNotFoundError,
  PolicyValidationError,
} from "./governance-service.js";

import type {
  GovernanceOverviewService,
} from "./governance-overview-service.js";

import type {
  ExecutionRoomService,
} from "./execution-room-service.js";

import type {
  ExecutionStream,
} from "./execution-stream.js";

import type {
  CompanyBrainService,
  ConflictResolution,
} from "./company-brain-service.js";

import {
  KnowledgeNotFoundError,
  KnowledgeStateError,
  KnowledgeValidationError,
} from "./company-brain-service.js";

import type {
  CompanyOverviewService,
} from "./company-overview-service.js";

import type {
  WorkspaceService,
} from "./workspace-service.js";

import {
  WorkspaceNotFoundError,
  WorkspaceValidationError,
} from "./workspace-service.js";

import type {
  AgentDirectoryService,
} from "./agent-directory-service.js";

import type {
  MissionTemplateService,
} from "./mission-template-service.js";

import {
  MissionTemplateNotFoundError,
  MissionTemplateValidationError,
} from "./mission-template-service.js";

import {
  AgentNotFoundError,
  AgentValidationError,
} from "./agent-directory-service.js";

import type {
  ToolRegistry,
} from "@unioffice/tools";

const developmentRequesterId =
  "1db667b1-3bd4-4d64-a7e4-dd5a5f2f4b09" as UserId;

export interface ApiServices {
  applicationService: WorkApplicationService;
  workService: WorkService;
  workExecutionService: WorkExecutionService;
  workApprovalService: WorkApprovalService;
  workQueryService: WorkQueryService;
  workRecoveryService: WorkRecoveryService;
  attentionService: AttentionService;
  executionQueueService: ExecutionQueueService;
  executionRoomService: ExecutionRoomService;
  executionStream: ExecutionStream;
  companyBrainService: CompanyBrainService;
  companyOverviewService: CompanyOverviewService;
  governanceService: GovernanceService;
  governanceOverviewService: GovernanceOverviewService;
  workspaceService: WorkspaceService;
  agentDirectoryService: AgentDirectoryService;
  missionTemplateService: MissionTemplateService;
  toolRegistry: ToolRegistry;
  healthCheck: () => Promise<Record<string, unknown>>;
  developmentOrganizationId?: OrganizationId;
  corsOrigins: string[];
}

export function buildApiServer(
  services: ApiServices,
) {
  const app = Fastify({
    logger: true,
    // Every legitimate request here is small - an objective, a briefing, a
    // policy's scope arrays. The framework default is 1MB, which is room for
    // a caller to hand the planner an enormous prompt or bloat a row; 256KB
    // is still far more than any real payload needs.
    bodyLimit: 256 * 1024,
  });

  // Routes are declared inside this nested register() so the rate-limit
  // plugin's onRoute hook (installed once its own registration resolves)
  // is guaranteed to be in place before any route below it is defined.
  // Fastify's onRoute hooks only affect routes added after they exist, and
  // a plain top-level app.register(rateLimit, ...) doesn't resolve before
  // the synchronous app.get(...) calls that would otherwise follow it.
  app.register(async (instance) => {
    await instance.register(rateLimit, {
      max: 120,
      timeWindow: "1 minute",
      // Returns a real Error carrying .statusCode, matching the convention
      // the shared setErrorHandler below relies on for every other error.
      errorResponseBuilder: () => {
        const error = new Error(
          "Too many requests. Please slow down and try again shortly.",
        ) as Error & { statusCode: number };
        error.statusCode = 429;
        return error;
      },
    });

    instance.addHook("onRequest", async (request, reply) => {
      const origin = request.headers.origin;

      if (origin && services.corsOrigins.includes(origin)) {
        reply.header("access-control-allow-origin", origin);
        reply.header("vary", "Origin");
      }

      reply.header(
        "access-control-allow-methods",
        "GET,POST,OPTIONS",
      );
      reply.header("access-control-allow-headers", "content-type");

      // Defence in depth for a JSON API. It should never be framed, its
      // content type should never be sniffed into something executable, and
      // it should leak no referrer. CSP frame-ancestors is the modern
      // clickjacking control; X-Frame-Options covers older clients.
      reply.header("x-content-type-options", "nosniff");
      reply.header("x-frame-options", "DENY");
      reply.header("content-security-policy", "default-src 'none'; frame-ancestors 'none'");
      reply.header("referrer-policy", "no-referrer");
    });

    instance.options("/*", async (_request, reply) => {
      return reply.status(204).send();
    });

    instance.setErrorHandler((error, request, reply) => {
      const resolvedError = toError(error);
      const statusCode = statusForError(resolvedError);

      // Only intentionally client-facing errors (ApiError, domain 404/409s)
      // carry a message safe to return as-is. An unmapped error could be
      // anything bubbling up from the database driver or model provider, so
      // the client gets a generic message while the real one is logged.
      const message = statusCode === 500
        ? "An internal error occurred."
        : resolvedError.message;

      if (statusCode === 500) {
        request.log.error(resolvedError);
      }

      return reply.status(statusCode).send({
        error: {
          code: errorCode(statusCode),
          message,
        },
      });
    });

    instance.get("/health", healthHandler(services));
    instance.post("/health", healthHandler(services));

    // ---------------------------------------------------------------------
    // The live channel.
    //
    // One long-lived connection replaces a page's worth of independent polls.
    // It carries events, not state: the client learns that something was
    // written and re-reads the surface it is showing, so there is exactly one
    // description of what a mission is - the one the services compute - and
    // the browser never becomes a second place where that is decided.
    // ---------------------------------------------------------------------
    instance.get("/stream", (request, reply) => {
      // Validated before the reply is hijacked. Afterwards the shared error
      // handler no longer owns this response, so a rejected request has to be
      // rejected while it can still be answered normally.
      const query = objectBody(request.query);
      const organizationId = requiredOrganizationId(
        services,
        query.organizationId,
      );
      const workId = optionalText(query.workId);

      reply.hijack();

      const raw = reply.raw;
      const origin = request.headers.origin;
      const headers: Record<string, string> = {
        "content-type": "text/event-stream",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        // Proxies that buffer a response would hold every frame until the
        // connection ended, which for a stream is never.
        "x-accel-buffering": "no",
      };

      if (origin && services.corsOrigins.includes(origin)) {
        headers["access-control-allow-origin"] = origin;
        headers.vary = "Origin";
      }

      raw.writeHead(200, headers);

      const send = (event: string, data: unknown): void => {
        if (raw.writableEnded) return;

        raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      };

      send("open", {
        organizationId,
        workId: workId ?? null,
        at: new Date().toISOString(),
      });

      const subscription = services.executionStream.subscribe(
        organizationId,
        (events) => {
          const relevant = workId
            ? events.filter((event) => event.workId === workId)
            : events;

          if (relevant.length === 0) return;

          send("activity", { events: relevant.map(streamFrame) });
        },
      );

      // An idle connection is indistinguishable from a dead one, and every
      // layer between here and the browser will eventually reclaim it. The
      // comment frame is the protocol's own keep-alive and costs one line.
      const heartbeat = setInterval(() => {
        if (raw.writableEnded) return;
        raw.write(`: keep-alive ${Date.now()}\n\n`);
      }, 20_000);

      heartbeat.unref?.();

      // A dropped connection raises both close and error, and a reload
      // raises close alone. Tearing down once covers every case; doing it
      // twice was how the heartbeat outlived one of the two.
      let released = false;

      const close = (): void => {
        if (released) return;
        released = true;

        clearInterval(heartbeat);
        subscription.close();
      };

      request.raw.on("close", close);
      request.raw.on("error", close);
    });

    instance.post("/work", async (request, reply) => {
      const body = objectBody(request.body);
      const organizationId = requiredOrganizationId(
        services,
        body.organizationId,
      );
      const workspaceId = optionalUuid(body.workspaceId, "workspaceId") as
        | WorkspaceId
        | undefined;

      // A workspace id from the caller is only a claim. Filing work under a
      // workspace that belongs to another organization would let it route to
      // that workspace's agents, so it has to be ours before it is used.
      if (workspaceId) {
        await services.workspaceService.getWorkspace(organizationId, workspaceId);
      }

      const input: CreateWorkInput = {
        organizationId,
        // The requester is the authenticated caller, not a field they get to
        // fill in. There is no auth yet, so it is the seeded development
        // requester; a caller-supplied requesterId used to be honoured, which
        // is authorship spoofing waiting to matter the day identity lands.
        requesterId: developmentRequesterId,
        objective: requiredText(body.objective, "objective", 4_000),
        priority: parsePriority(body.priority),
        workspaceId,
        // The only context a caller may attach is the briefing, which is
        // parsed and length-bounded on its own. A free-form metadata object
        // used to be accepted verbatim here, which let a request seed the
        // very fields the pipeline writes itself - interrupted, retry,
        // executionError - and grow the row without bound. Everything else on
        // work.metadata is set by the system, so nothing else is read in.
        metadata: withBriefing(undefined, parseBriefing(body.briefing)),
      };

      const work =
        await services.applicationService.createWork(input);

      return reply.status(201).send({ work });
    });

    instance.get("/work", async (request) => {
      const query = objectBody(request.query);
      const work = await services.workQueryService.listWork(
        requiredOrganizationId(services, query.organizationId),
        {
          status: parseWorkStatus(query.status),
          limit: parseOptionalLimit(query.limit),
        },
      );

      return { work };
    });

    instance.get("/overview", async (request) => {
      const query = objectBody(request.query);

      return services.companyOverviewService.getOverview(
        requiredOrganizationId(services, query.organizationId),
        { activityLimit: parseOptionalLimit(query.activityLimit) },
      );
    });

    // What needs a person, in one ranked answer every surface reads. The rail
    // badge, the drawer and the Command Center opening used to each count
    // this for themselves and could disagree on one screen.
    instance.get("/attention", async (request) => {
      const query = objectBody(request.query);

      return services.attentionService.getQueue(
        requiredOrganizationId(services, query.organizationId),
        { limit: parseOptionalLimit(query.limit) },
      );
    });

    instance.get("/tools", async () => {
      // The registry is the single source of truth for what can actually be
      // called; the catalog is projected from it rather than duplicated.
      const tools = services.toolRegistry.list().map((tool) => ({
        id: tool.id,
        name: tool.name,
        description: tool.description,
        version: tool.version,
        inputSchema: tool.inputSchema,
      }));

      return { tools };
    });

    instance.get("/artifacts", async (request) => {
      const query = objectBody(request.query);
      const artifacts =
        await services.workQueryService.getOrganizationArtifacts(
          requiredOrganizationId(services, query.organizationId),
          parseOptionalLimit(query.limit),
        );

      return { artifacts };
    });

    // The execution room reads here and nowhere else. Kept separate from
    // /work/:id/detail, which several surfaces still use for the narrower
    // answer it gives.
    instance.get("/work/:id/room", async (request) => {
      const workId = await authorizedWorkId(services, request);
      return services.executionRoomService.getRoom(workId);
    });

    instance.get("/work/:id/detail", async (request) => {
      const workId = await authorizedWorkId(services, request);
      const [detail, job] = await Promise.all([
        services.workQueryService.getWorkDetail(workId),
        services.executionQueueService.getActiveJob(workId),
      ]);

      // Real queue state, read from the job row - never a guess about what a
      // worker might be doing.
      return { ...detail, executionJob: job };
    });

    instance.get("/work/:id", async (request) => {
      const work = await services.workQueryService.assertWorkInOrganization(
        parameterId(request.params),
        requiredOrganizationId(services, objectBody(request.query).organizationId),
      );

      return { work };
    });

    instance.post("/work/:id/plan", async (request) => {
      const workId = await authorizedWorkId(services, request);
      return services.workService.planWork(workId);
    });

    // Puts the work on the durable queue and returns immediately. A worker
    // executes it, so the run no longer depends on this process staying
    // alive. Callers watch progress through /work/:id/detail, which reads the
    // same rows the worker is writing.
    instance.post("/work/:id/execute", async (request) => {
      const workId = await authorizedWorkId(services, request);
      return services.executionQueueService.enqueueWork(workId, "requested");
    });

    instance.post("/work/:id/retry", async (request) => {
      const workId = await authorizedWorkId(services, request);
      const retried = await services.workRecoveryService.retryWork(workId);

      // A retry that only reset rows would sit there until someone pressed
      // Execute, so it goes back on the queue itself. Work that has to be
      // replanned is left for the planner; only a resumable plan is queued.
      if (retried.mode === "resume") {
        const queued = await services.executionQueueService.enqueueWork(
          workId,
          "retry",
        );

        return { ...retried, job: queued.job };
      }

      return retried;
    });

    instance.get("/work/:id/tasks", async (request) => {
      const tasks = await services.workQueryService.getTasks(
        await authorizedWorkId(services, request),
      );

      return { tasks };
    });

    instance.get("/work/:id/events", async (request) => {
      const events = await services.workQueryService.getEvents(
        await authorizedWorkId(services, request),
      );

      return { events };
    });

    instance.get("/work/:id/artifacts", async (request) => {
      const artifacts = await services.workQueryService.getArtifacts(
        await authorizedWorkId(services, request),
      );

      return { artifacts };
    });

    instance.get("/work/:id/approvals", async (request) => {
      const approvals = await services.workApprovalService.getWorkApprovals(
        await authorizedWorkId(services, request),
      );
      return { approvals };
    });

    instance.get("/approvals", async (request) => {
      const query = objectBody(request.query);
      const approvals = await services.workApprovalService.getPendingApprovals(
        requiredOrganizationId(services, query.organizationId),
      );

      return { approvals };
    });

    instance.post("/approvals/:id/approve", async (request) => {
      const approval = await services.workApprovalService.approve(
        parameterApprovalId(request.params),
        resolverId(request.body),
        requiredOrganizationId(services, objectBody(request.body).organizationId),
      );
      // Resuming is a durable enqueue too, so an approval granted while no
      // worker happens to be up is still executed once one starts.
      const execution = await services.executionQueueService.enqueueWork(
        approval.workId,
        "approval_resumed",
      );

      return { approval, ...execution };
    });

    instance.post("/approvals/:id/reject", async (request) => {
      const approval = await services.workApprovalService.reject(
        parameterApprovalId(request.params),
        resolverId(request.body),
        requiredOrganizationId(services, objectBody(request.body).organizationId),
      );
      return { approval };
    });

    // ---------------------------------------------------------------------
    // Governance.
    //
    // Reads and authoring only. Enforcement is not reachable from here - it
    // happens inside execution, which is the point: a control plane a caller
    // can talk their way past is not one.
    // ---------------------------------------------------------------------

    instance.get("/governance", async (request) => {
      const query = objectBody(request.query);

      return services.governanceOverviewService.getOverview(
        requiredOrganizationId(services, query.organizationId),
        { activityLimit: parseOptionalLimit(query.activityLimit) },
      );
    });

    instance.get("/policies", async (request) => {
      const query = objectBody(request.query);

      const policies = await services.governanceService.listPolicies(
        requiredOrganizationId(services, query.organizationId),
        { includeArchived: query.includeArchived === "true" },
      );

      return { policies };
    });

    instance.get("/policies/:id", async (request) => {
      const query = objectBody(request.query);

      const policy = await services.governanceService.getPolicy(
        requiredOrganizationId(services, query.organizationId),
        parameterId(request.params) as unknown as PolicyId,
      );

      return { policy };
    });

    instance.post("/policies", async (request, reply) => {
      const body = objectBody(request.body);

      const policy = await services.governanceService.createPolicy({
        organizationId: requiredOrganizationId(services, body.organizationId),
        name: requiredText(body.name, "name"),
        description: optionalText(body.description) ?? "",
        subject: parsePolicySubject(body.subject),
        effect: parsePolicyEffect(body.effect),
        risk: parseRiskLevel(body.risk),
        status: parsePolicyStatus(body.status),
        scope: parsePolicyScope(body.scope),
        approvalPrompt: optionalText(body.approvalPrompt),
        createdBy: optionalText(body.createdBy),
      });

      return reply.status(201).send({ policy });
    });

    instance.post("/policies/:id", async (request) => {
      const body = objectBody(request.body);

      const policy = await services.governanceService.updatePolicy({
        organizationId: requiredOrganizationId(services, body.organizationId),
        policyId: parameterId(request.params) as unknown as PolicyId,
        name: optionalText(body.name),
        description:
          body.description === undefined
            ? undefined
            : (optionalText(body.description) ?? ""),
        effect:
          body.effect === undefined ? undefined : parsePolicyEffect(body.effect),
        risk: body.risk === undefined ? undefined : parseRiskLevel(body.risk),
        status: parsePolicyStatus(body.status),
        scope:
          body.scope === undefined ? undefined : parsePolicyScope(body.scope),
        // null clears the prompt; undefined leaves it as it was.
        approvalPrompt:
          body.approvalPrompt === undefined
            ? undefined
            : body.approvalPrompt === null
              ? null
              : (optionalText(body.approvalPrompt) ?? null),
      });

      return { policy };
    });

    // ---------------------------------------------------------------------
    // Organization, workspaces and the workforce.
    //
    // Every one of these resolves the organization first and refuses to act
    // on a workspace or agent belonging to another one. There is no
    // authentication yet; this is the shape that lets one be added without
    // revisiting each handler.
    // ---------------------------------------------------------------------

    instance.get("/organization", async (request) => {
      const query = objectBody(request.query);

      return services.workspaceService.getOrganizationOverview(
        requiredOrganizationId(services, query.organizationId),
      );
    });

    instance.get("/workspaces", async (request) => {
      const query = objectBody(request.query);
      const workspaces = await services.workspaceService.listWorkspaces(
        requiredOrganizationId(services, query.organizationId),
      );

      return { workspaces };
    });

    instance.post("/workspaces", async (request, reply) => {
      const body = objectBody(request.body);

      const workspace = await services.workspaceService.createWorkspace({
        organizationId: requiredOrganizationId(services, body.organizationId),
        name: requiredText(body.name, "name"),
        description: optionalText(body.description),
      });

      return reply.status(201).send({ workspace });
    });

    instance.get("/workspaces/:id", async (request) => {
      const query = objectBody(request.query);

      return services.workspaceService.getWorkspaceDetail(
        requiredOrganizationId(services, query.organizationId),
        parameterId(request.params) as unknown as WorkspaceId,
      );
    });

    instance.post("/workspaces/:id", async (request) => {
      const body = objectBody(request.body);

      const workspace = await services.workspaceService.updateWorkspace({
        organizationId: requiredOrganizationId(services, body.organizationId),
        workspaceId: parameterId(request.params) as unknown as WorkspaceId,
        name: optionalText(body.name),
        description: nullableText(body.description),
        status: parseWorkspaceStatus(body.status),
      });

      return { workspace };
    });

    instance.get("/agents/:id", async (request) => {
      const query = objectBody(request.query);

      return services.agentDirectoryService.getAgentDetail(
        requiredOrganizationId(services, query.organizationId),
        parameterId(request.params) as unknown as AgentId,
      );
    });

    instance.post("/agents", async (request, reply) => {
      const body = objectBody(request.body);

      const agent = await services.agentDirectoryService.createAgent({
        organizationId: requiredOrganizationId(services, body.organizationId),
        name: requiredText(body.name, "name"),
        description: requiredText(body.description, "description"),
        type: parseAgentType(body.type),
        capabilities: stringArray(body.capabilities, "capabilities"),
        toolIds: stringArray(body.toolIds, "toolIds"),
        workspaceId: optionalText(body.workspaceId) as
          | WorkspaceId
          | undefined,
      });

      return reply.status(201).send({ agent });
    });

    instance.post("/agents/:id", async (request) => {
      const body = objectBody(request.body);

      const agent = await services.agentDirectoryService.updateAgent({
        organizationId: requiredOrganizationId(services, body.organizationId),
        agentId: parameterId(request.params) as unknown as AgentId,
        description: optionalText(body.description),
        capabilities:
          body.capabilities === undefined
            ? undefined
            : stringArray(body.capabilities, "capabilities"),
        toolIds:
          body.toolIds === undefined
            ? undefined
            : stringArray(body.toolIds, "toolIds"),
        // null is meaningful: it takes the agent out of its workspace.
        workspaceId:
          body.workspaceId === undefined
            ? undefined
            : body.workspaceId === null
              ? null
              : (requiredText(body.workspaceId, "workspaceId") as WorkspaceId),
        status: parseAgentStatus(body.status),
      });

      return { agent };
    });

    instance.get("/agents", async (request) => {
      const query = objectBody(request.query);
      const agents = await services.workQueryService.getAgents(
        requiredOrganizationId(services, query.organizationId),
      );

      return { agents };
    });

    instance.get("/activity", async (request) => {
      const query = objectBody(request.query);
      const events = await services.workQueryService.getOrganizationActivity(
        requiredOrganizationId(services, query.organizationId),
        parseOptionalLimit(query.limit),
      );

      return { events };
    });

    // ---------------------------------------------------------------------
    // Mission templates.
    //
    // A template only briefs a mission. Starting one creates ordinary work
    // through the same application service as POST /work, and everything
    // after that - planning, governance, approvals, the queue - happens on the
    // one path every mission takes, driven from the execution room exactly as
    // it is for a mission typed from scratch.
    // ---------------------------------------------------------------------

    instance.get("/mission-templates", async (request) => {
      const query = objectBody(request.query);
      const templates = await services.missionTemplateService.listTemplates(
        requiredOrganizationId(services, query.organizationId),
      );

      return { templates };
    });

    instance.get("/mission-templates/:templateId", async (request) => {
      const query = objectBody(request.query);

      return services.missionTemplateService.getTemplate(
        requiredOrganizationId(services, query.organizationId),
        parameterTemplateId(request.params),
      );
    });

    instance.post(
      "/mission-templates/:templateId/missions",
      { config: { rateLimit: KNOWLEDGE_WRITE_LIMIT } },
      async (request, reply) => {
        const body = objectBody(request.body);

        // Only these fields are read. Anything else in the body - a status,
        // agents, tasks, approval state, another requester - never reaches the
        // service.
        const work = await services.missionTemplateService.startMission({
          organizationId: requiredOrganizationId(services, body.organizationId),
          requesterId: developmentRequesterId,
          templateId: parameterTemplateId(request.params),
          name: templateText(body.name, "name"),
          objective: templateText(body.objective, "objective") ?? "",
          context: templateText(body.context, "context"),
          desiredOutcome: templateText(body.desiredOutcome, "desiredOutcome") ?? "",
          constraints: templateText(body.constraints, "constraints"),
          priority: parsePriority(body.priority),
          workspaceId: optionalUuid(body.workspaceId, "workspaceId") as WorkspaceId | undefined,
        });

        return reply.status(201).send({ work });
      },
    );

    // ---------------------------------------------------------------------
    // Company knowledge.
    //
    // Reads, authoring and review. Recall into an agent is not reachable from
    // here - it happens inside planning and execution, through governance -
    // and the preview route runs that same recall without recording it.
    //
    // The actor on every write is the server's notion of the caller, never a
    // field in the body: a knowledge record whose "reviewed by" a caller can
    // type is provenance anyone can forge.
    // ---------------------------------------------------------------------

    // Kept for the surfaces that still read the company's memory as a list.
    // It is the same search the Brain uses, not a second retrieval path.
    instance.get("/memory", { config: { rateLimit: KNOWLEDGE_SEARCH_LIMIT } }, async (request) => {
      const query = objectBody(request.query);
      const result = await services.companyBrainService.search(
        requiredOrganizationId(services, query.organizationId),
        {
          query: optionalBoundedText(query.query, "query", MAX_KNOWLEDGE_QUERY_CHARS),
          limit: parseOptionalLimit(query.limit),
        },
      );

      return { memories: result.items.map((item) => item.knowledge) };
    });

    instance.get("/knowledge", { config: { rateLimit: KNOWLEDGE_SEARCH_LIMIT } }, async (request) => {
      const query = objectBody(request.query);

      return services.companyBrainService.search(
        requiredOrganizationId(services, query.organizationId),
        {
          query: optionalBoundedText(query.query, "query", MAX_KNOWLEDGE_QUERY_CHARS),
          types: parseKnowledgeTypes(query.types),
          statuses: parseKnowledgeStatuses(query.statuses),
          workspaceId: parseWorkspaceFilter(query.workspaceId),
          sourceType: parseKnowledgeSourceType(query.sourceType),
          minImportance: parseUnitNumber(query.minImportance, "minImportance"),
          createdAfter: parseOptionalDate(query.createdAfter, "createdAfter"),
          createdBefore: parseOptionalDate(query.createdBefore, "createdBefore"),
          limit: parseOptionalLimit(query.limit),
          offset: parseOptionalOffset(query.offset),
        },
      );
    });

    instance.get("/knowledge/overview", async (request) => {
      const query = objectBody(request.query);

      return services.companyBrainService.getOverview(
        requiredOrganizationId(services, query.organizationId),
      );
    });

    instance.get("/knowledge/recall-preview", { config: { rateLimit: KNOWLEDGE_SEARCH_LIMIT } }, async (request) => {
      const query = objectBody(request.query);

      return services.companyBrainService.previewRecall(
        requiredOrganizationId(services, query.organizationId),
        {
          query: requiredText(query.query, "query", MAX_KNOWLEDGE_QUERY_CHARS),
          workspaceId: optionalUuid(query.workspaceId, "workspaceId") as WorkspaceId | undefined,
          agentId: optionalUuid(query.agentId, "agentId") as AgentId | undefined,
        },
      );
    });

    instance.get("/knowledge/:id", async (request) => {
      const query = objectBody(request.query);

      return services.companyBrainService.getDetail(
        requiredOrganizationId(services, query.organizationId),
        parameterUuid(request.params) as MemoryId,
      );
    });

    instance.post("/knowledge", { config: { rateLimit: KNOWLEDGE_WRITE_LIMIT } }, async (request, reply) => {
      const body = objectBody(request.body);

      const knowledge = await services.companyBrainService.createKnowledge({
        organizationId: requiredOrganizationId(services, body.organizationId),
        title: requiredText(body.title, "title", 200),
        content: requiredText(body.content, "content", 4_000),
        type: parseKnowledgeType(body.type),
        importance: parseUnitNumber(body.importance, "importance"),
        confidence: parseUnitNumber(body.confidence, "confidence"),
        workspaceId: optionalUuid(body.workspaceId, "workspaceId") as WorkspaceId | undefined,
        createdBy: actorOf(),
      });

      return reply.status(201).send({ knowledge });
    });

    instance.post("/knowledge/:id", { config: { rateLimit: KNOWLEDGE_WRITE_LIMIT } }, async (request) => {
      const body = objectBody(request.body);

      const knowledge = await services.companyBrainService.updateKnowledge({
        organizationId: requiredOrganizationId(services, body.organizationId),
        knowledgeId: parameterUuid(request.params) as MemoryId,
        title: body.title === undefined ? undefined : requiredText(body.title, "title", 200),
        content: body.content === undefined ? undefined : requiredText(body.content, "content", 4_000),
        type: body.type === undefined ? undefined : parseKnowledgeType(body.type),
        importance: parseUnitNumber(body.importance, "importance"),
        confidence: body.confidence === null ? null : parseUnitNumber(body.confidence, "confidence"),
        // null is meaningful: it makes the knowledge company-wide.
        workspaceId:
          body.workspaceId === undefined
            ? undefined
            : body.workspaceId === null
              ? null
              : (requiredUuid(body.workspaceId, "workspaceId") as WorkspaceId),
        updatedBy: actorOf(),
      });

      return { knowledge };
    });

    instance.post("/knowledge/:id/approve", { config: { rateLimit: KNOWLEDGE_WRITE_LIMIT } }, async (request) => {
      const body = objectBody(request.body);

      const knowledge = await services.companyBrainService.approveKnowledge(
        requiredOrganizationId(services, body.organizationId),
        parameterUuid(request.params) as MemoryId,
        actorOf(),
      );

      return { knowledge };
    });

    instance.post("/knowledge/:id/archive", { config: { rateLimit: KNOWLEDGE_WRITE_LIMIT } }, async (request) => {
      const body = objectBody(request.body);

      const knowledge = await services.companyBrainService.archiveKnowledge(
        requiredOrganizationId(services, body.organizationId),
        parameterUuid(request.params) as MemoryId,
        {
          by: actorOf(),
          reason: optionalBoundedText(body.reason, "reason", 500),
        },
      );

      return { knowledge };
    });

    instance.post("/knowledge/:id/restore", { config: { rateLimit: KNOWLEDGE_WRITE_LIMIT } }, async (request) => {
      const body = objectBody(request.body);

      const knowledge = await services.companyBrainService.restoreKnowledge(
        requiredOrganizationId(services, body.organizationId),
        parameterUuid(request.params) as MemoryId,
        actorOf(),
      );

      return { knowledge };
    });

    // The knowledge in the route is the restatement; intoId is the entry it
    // says the same as. Both ids are resolved inside the caller's organization.
    instance.post("/knowledge/:id/merge", { config: { rateLimit: KNOWLEDGE_WRITE_LIMIT } }, async (request) => {
      const body = objectBody(request.body);

      const { kept, merged } = await services.companyBrainService.mergeKnowledge(
        requiredOrganizationId(services, body.organizationId),
        parameterUuid(request.params) as MemoryId,
        requiredUuid(body.intoId, "intoId") as MemoryId,
        actorOf(),
      );

      return { knowledge: kept, merged };
    });

    // The knowledge in the route is the newer entry; replacesId is the older
    // one it retires.
    instance.post("/knowledge/:id/supersede", { config: { rateLimit: KNOWLEDGE_WRITE_LIMIT } }, async (request) => {
      const body = objectBody(request.body);

      const { current, replaced } = await services.companyBrainService.supersedeKnowledge(
        requiredOrganizationId(services, body.organizationId),
        parameterUuid(request.params) as MemoryId,
        requiredUuid(body.replacesId, "replacesId") as MemoryId,
        actorOf(),
        optionalBoundedText(body.note, "note", 500),
      );

      return { knowledge: current, replaced };
    });

    instance.post("/knowledge/conflicts/:id/resolve", { config: { rateLimit: KNOWLEDGE_WRITE_LIMIT } }, async (request) => {
      const body = objectBody(request.body);

      const conflict = await services.companyBrainService.resolveConflict(
        requiredOrganizationId(services, body.organizationId),
        parameterUuid(request.params) as KnowledgeConflictId,
        parseConflictResolution(body),
        actorOf(),
        optionalBoundedText(body.note, "note", 500),
      );

      return { conflict };
    });

    // Asks a model to read the artifact, so it is the most expensive write
    // here and limited accordingly.
    instance.post("/artifacts/:id/knowledge", { config: { rateLimit: KNOWLEDGE_DERIVE_LIMIT } }, async (request) => {
      const body = objectBody(request.body);

      const report = await services.companyBrainService.deriveFromArtifact(
        requiredOrganizationId(services, body.organizationId),
        parameterUuid(request.params) as ArtifactId,
        actorOf(),
      );

      return report;
    });

    instance.get("/work/:id/knowledge", async (request) => {
      const workId = await authorizedWorkId(services, request);

      return services.companyBrainService.getMissionKnowledge(
        requiredOrganizationId(services, objectBody(request.query).organizationId),
        workId,
      );
    });
  });

  return app;
}

/**
 * What one event looks like on the wire.
 *
 * The payload is capped. A tool call's output can be a page of text, and the
 * stream exists to say that something happened - the surface re-reads the
 * authoritative row for anything it renders in full, so shipping the whole
 * payload down a channel that fires on every write buys nothing and costs
 * bandwidth on every connected tab.
 */
function streamFrame(event: Event): Record<string, unknown> {
  const serialized = safeLength(event.payload);

  return {
    id: event.id,
    type: event.type,
    timestamp: event.timestamp.toISOString(),
    organizationId: event.organizationId,
    workId: event.workId ?? undefined,
    taskId: event.taskId ?? undefined,
    agentId: event.agentId ?? undefined,
    actorType: event.actorType,
    payload:
      serialized <= MAX_STREAM_PAYLOAD_BYTES
        ? event.payload
        : { truncated: true },
  };
}

const MAX_STREAM_PAYLOAD_BYTES = 2_000;

const MAX_KNOWLEDGE_QUERY_CHARS = 500;

/**
 * A search embeds its query on the local model, so it costs more than a plain
 * read; a write re-embeds and re-checks for conflicts; deriving from an
 * artifact runs the generation model. The limits follow the cost.
 */
const KNOWLEDGE_SEARCH_LIMIT = { max: 60, timeWindow: "1 minute" };
const KNOWLEDGE_WRITE_LIMIT = { max: 30, timeWindow: "1 minute" };
const KNOWLEDGE_DERIVE_LIMIT = { max: 5, timeWindow: "1 minute" };

/**
 * Who is acting, for provenance. There is no authentication yet, so every
 * write is attributed to the seeded development requester - the same identity
 * /work uses - rather than to anything the request says about itself.
 */
function actorOf(): string {
  return `user:${developmentRequesterId}`;
}

const TEMPLATE_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * A template id is a short slug. Anything else cannot name a template, and is
 * answered the same way as a slug that names none.
 */
function parameterTemplateId(params: unknown): string {
  const value = typeof params === "object" && params !== null
    ? (params as Record<string, unknown>).templateId
    : undefined;

  if (typeof value !== "string" || value.length > 64 || !TEMPLATE_ID_PATTERN.test(value)) {
    throw new MissionTemplateNotFoundError();
  }

  return value;
}

/**
 * A template answer: text or nothing. Length and content are the service's to
 * judge, so the same rules apply however a mission is started.
 */
function templateText(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null) return undefined;

  if (typeof value !== "string") {
    throw new ApiError(400, `${field} must be text.`);
  }

  return value;
}

function parseKnowledgeType(value: unknown): MemoryType {
  if (typeof value === "string" && (KNOWLEDGE_TYPES as readonly string[]).includes(value)) {
    return value as MemoryType;
  }

  throw new ApiError(400, `type must be one of ${KNOWLEDGE_TYPES.join(", ")}.`);
}

/** A comma-separated list in a query string, each entry validated. */
function parseKnowledgeTypes(value: unknown): MemoryType[] | undefined {
  const text = optionalBoundedText(value, "types", 200);
  return text === undefined ? undefined : text.split(",").map((entry) => parseKnowledgeType(entry.trim()));
}

function parseKnowledgeStatuses(value: unknown): KnowledgeStatus[] | undefined {
  const text = optionalBoundedText(value, "statuses", 100);

  if (text === undefined) return undefined;

  return text.split(",").map((entry) => {
    const status = entry.trim();

    if (!(KNOWLEDGE_STATUSES as readonly string[]).includes(status)) {
      throw new ApiError(400, `statuses must be drawn from ${KNOWLEDGE_STATUSES.join(", ")}.`);
    }

    return status as KnowledgeStatus;
  });
}

function parseKnowledgeSourceType(value: unknown): KnowledgeSourceType | undefined {
  const text = optionalBoundedText(value, "sourceType", 40);

  if (text === undefined) return undefined;

  if (!(KNOWLEDGE_SOURCE_TYPES as readonly string[]).includes(text)) {
    throw new ApiError(400, `sourceType must be one of ${KNOWLEDGE_SOURCE_TYPES.join(", ")}.`);
  }

  return text as KnowledgeSourceType;
}

/** "company" narrows to company-wide knowledge; a uuid narrows to one workspace. */
function parseWorkspaceFilter(value: unknown): WorkspaceId | null | undefined {
  const text = optionalBoundedText(value, "workspaceId", 64);

  if (text === undefined) return undefined;
  if (text === "company") return null;

  return requiredUuid(text, "workspaceId") as WorkspaceId;
}

/**
 * A number in [0, 1]. Accepts a JSON number or a query-string numeral and
 * nothing else - not NaN, not "0x1", not an array.
 */
function parseUnitNumber(value: unknown, field: string): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;

  const number =
    typeof value === "number"
      ? value
      : typeof value === "string" && /^\d+(\.\d+)?$/.test(value.trim())
        ? Number(value)
        : Number.NaN;

  if (!Number.isFinite(number) || number < 0 || number > 1) {
    throw new ApiError(400, `${field} must be a number between 0 and 1.`);
  }

  return number;
}

function parseOptionalDate(value: unknown, field: string): Date | undefined {
  const text = optionalBoundedText(value, field, 40);

  if (text === undefined) return undefined;

  const date = new Date(text);

  if (Number.isNaN(date.getTime())) {
    throw new ApiError(400, `${field} must be an ISO date.`);
  }

  return date;
}

function parseOptionalOffset(value: unknown): number | undefined {
  const text = optionalText(value);

  if (text === undefined) return undefined;

  const parsed = Number(text);

  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 1_000) {
    throw new ApiError(400, "offset must be an integer between 0 and 1000.");
  }

  return parsed;
}

function parseConflictResolution(body: Record<string, unknown>): ConflictResolution {
  if (body.resolution === "both_hold" || body.resolution === "dismiss") {
    return { kind: body.resolution };
  }

  if (body.resolution === "keep") {
    return { kind: "keep", keepId: requiredUuid(body.keepId, "keepId") as MemoryId };
  }

  throw new ApiError(400, "resolution must be keep, both_hold or dismiss.");
}

function optionalBoundedText(value: unknown, field: string, maxLength: number): string | undefined {
  const text = optionalText(value);

  if (text !== undefined && text.length > maxLength) {
    throw new ApiError(400, `${field} must be ${maxLength} characters or fewer.`);
  }

  return text;
}

function requiredUuid(value: unknown, field: string): string {
  const text = requiredText(value, field, 64);

  if (!UUID_PATTERN.test(text)) {
    throw new ApiError(400, `${field} must be a valid identifier.`);
  }

  return text;
}

function optionalUuid(value: unknown, field: string): string | undefined {
  return value === undefined || value === null ? undefined : requiredUuid(value, field);
}

function safeLength(payload: Record<string, unknown>): number {
  try {
    return JSON.stringify(payload)?.length ?? 0;
  } catch {
    // A payload that will not serialize cannot be sent either way.
    return Number.POSITIVE_INFINITY;
  }
}

/**
 * Resolves the organization every request acts within.
 *
 * There is no authentication yet, so the API is bound to exactly one
 * organization - the seeded one. A request may name that organization
 * explicitly (the web client does, on every scoped call), but it may not name
 * a *different* one: with no caller identity to check an override against,
 * honouring an arbitrary organizationId is a tenant boundary anyone can step
 * across just by changing a query string. So a mismatch is refused rather than
 * trusted. When real authentication lands, the bound organization comes from
 * the caller's token instead of this default, and the same equality check
 * still holds the line.
 */
function requiredOrganizationId(
  services: ApiServices,
  value: unknown,
): OrganizationId {
  const bound = services.developmentOrganizationId;
  const requested = optionalText(value);

  if (!bound) {
    // No auth and no seeded organization: there is nothing to scope to, and
    // trusting a caller-supplied id here would be the whole vulnerability.
    throw new ApiError(
      400,
      "organizationId is required when no development workforce is seeded.",
    );
  }

  if (requested && requested !== bound) {
    // Deliberately "not found" rather than "forbidden": a caller with no
    // identity should not be able to tell a real other organization apart
    // from a made-up one.
    throw new ApiError(
      404,
      "Organization not found.",
    );
  }

  return bound;
}

/**
 * The briefing a requester attaches to an objective: constraints, figures,
 * background. It is stored on the work row and read by the planner, so it is
 * bounded here - an unbounded body would end up verbatim in a model prompt.
 */
function parseBriefing(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new ApiError(400, "briefing must be a string.");
  }

  const briefing = value.trim();

  if (!briefing) {
    return undefined;
  }

  if (briefing.length > 4_000) {
    throw new ApiError(400, "briefing must be 4000 characters or fewer.");
  }

  return briefing;
}

function withBriefing(
  metadata: Record<string, unknown> | undefined,
  briefing: string | undefined,
): Record<string, unknown> | undefined {
  if (briefing === undefined) {
    return metadata;
  }

  return { ...metadata, briefing };
}

function parsePolicySubject(value: unknown): PolicySubject {
  if (
    value === "tool" ||
    value === "task" ||
    value === "knowledge_recall" ||
    value === "knowledge_capture"
  ) {
    return value;
  }

  throw new ApiError(
    400,
    "subject must be tool, task, knowledge_recall or knowledge_capture.",
  );
}

function parsePolicyEffect(value: unknown): PolicyEffect {
  if (value === "allow" || value === "require_approval" || value === "deny") {
    return value;
  }

  throw new ApiError(400, "effect must be allow, require_approval or deny.");
}

function parseRiskLevel(value: unknown): RiskLevel {
  if (
    value === "low" ||
    value === "medium" ||
    value === "high" ||
    value === "critical"
  ) {
    return value;
  }

  throw new ApiError(400, "risk must be low, medium, high or critical.");
}

function parsePolicyStatus(value: unknown): PolicyStatus | undefined {
  if (value === undefined || value === null) return undefined;

  if (
    value === "draft" ||
    value === "active" ||
    value === "paused" ||
    value === "archived"
  ) {
    return value;
  }

  throw new ApiError(400, "status must be draft, active, paused or archived.");
}

/**
 * A policy scope. Every list is optional, and an omitted one means "not
 * narrowed that way" - the same reading the engine uses, so an unfilled form
 * is company-wide rather than inert.
 */
function parsePolicyScope(value: unknown): {
  agentIds: AgentId[];
  toolIds: string[];
  workspaceIds: WorkspaceId[];
  capabilities: string[];
  knowledgeTypes: string[];
} {
  if (value === undefined || value === null) {
    return { agentIds: [], toolIds: [], workspaceIds: [], capabilities: [], knowledgeTypes: [] };
  }

  if (typeof value !== "object") {
    throw new ApiError(400, "scope must be an object.");
  }

  const scope = value as Record<string, unknown>;

  return {
    agentIds: optionalStringArray(scope.agentIds, "scope.agentIds") as AgentId[],
    toolIds: optionalStringArray(scope.toolIds, "scope.toolIds"),
    workspaceIds: optionalStringArray(
      scope.workspaceIds,
      "scope.workspaceIds",
    ) as WorkspaceId[],
    capabilities: optionalStringArray(scope.capabilities, "scope.capabilities"),
    knowledgeTypes: optionalStringArray(scope.knowledgeTypes, "scope.knowledgeTypes"),
  };
}

function optionalStringArray(value: unknown, field: string): string[] {
  if (value === undefined || value === null) return [];

  return stringArray(value, field);
}

function parseWorkspaceStatus(
  value: unknown,
): WorkspaceStatus | undefined {
  if (value === undefined || value === null) return undefined;

  if (value === "active" || value === "archived") {
    return value;
  }

  throw new ApiError(400, "status is invalid.");
}

function parseAgentType(value: unknown): AgentType {
  if (
    value === "specialist" ||
    value === "manager" ||
    value === "orchestrator"
  ) {
    return value;
  }

  throw new ApiError(400, "type must be specialist, manager or orchestrator.");
}

function parseAgentStatus(value: unknown): AgentStatus | undefined {
  if (value === undefined || value === null) return undefined;

  if (value === "active" || value === "paused" || value === "disabled") {
    return value;
  }

  throw new ApiError(400, "status must be active, paused or disabled.");
}

function stringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) {
    throw new ApiError(400, `${field} must be an array of strings.`);
  }

  return value.map((entry) => {
    if (typeof entry !== "string" || !entry.trim()) {
      throw new ApiError(400, `${field} must contain non-empty strings.`);
    }

    return entry.trim();
  });
}

/**
 * Text where null is a real instruction to clear the field, distinct from
 * undefined meaning "leave it as it is".
 */
function nullableText(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;

  return optionalText(value) ?? null;
}

function parseWorkStatus(value: unknown): WorkStatus | undefined {
  const text = optionalText(value);

  if (text === undefined) {
    return undefined;
  }

  const statuses: WorkStatus[] = [
    "queued",
    "planning",
    "executing",
    "waiting_approval",
    "completed",
    "failed",
    "cancelled",
  ];

  if (!statuses.includes(text as WorkStatus)) {
    throw new ApiError(400, "status is invalid.");
  }

  return text as WorkStatus;
}

function healthHandler(services: ApiServices) {
  return async () => ({
    status: "ok",
    checks: await services.healthCheck(),
  });
}

function objectBody(body: unknown): Record<string, unknown> {
  if (typeof body !== "object" || body === null) {
    throw new ApiError(400, "Request body must be a JSON object.");
  }

  return body as Record<string, unknown>;
}

/**
 * The work id in the route, confirmed to belong to the caller's organization.
 *
 * Every /work/:id handler runs this before doing anything. It is the single
 * choke point that turns a bare, guessable UUID into an authorized reference,
 * so a new per-work route cannot silently ship without the check - it has no
 * other way to get the id.
 */
async function authorizedWorkId(
  services: ApiServices,
  request: { params: unknown; query: unknown },
): Promise<WorkId> {
  const workId = parameterId(request.params);
  const organizationId = requiredOrganizationId(
    services,
    objectBody(request.query).organizationId,
  );

  await services.workQueryService.assertWorkInOrganization(
    workId,
    organizationId,
  );

  return workId;
}

/**
 * Every id in the schema is a uuid. Validating the shape at the edge means a
 * malformed id is a clean 400 rather than a 500 from the database rejecting
 * the cast - which also keeps a garbage id from reaching the query at all.
 */
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parameterUuid(params: unknown): string {
  if (typeof params !== "object" || params === null) {
    throw new ApiError(400, "Route id is required.");
  }

  const id = requiredText((params as Record<string, unknown>).id, "id", 64);

  if (!UUID_PATTERN.test(id)) {
    throw new ApiError(400, "id must be a valid identifier.");
  }

  return id;
}

function parameterId(params: unknown): WorkId {
  return parameterUuid(params) as WorkId;
}

function parameterApprovalId(params: unknown): ApprovalId {
  return parameterUuid(params) as ApprovalId;
}

/**
 * Who decided an approval. The column is a uuid, and this used to accept any
 * text - so a malformed value reached the database and came back as a 500
 * rather than being refused at the edge like every other identifier.
 */
function resolverId(body: unknown): string {
  return requiredUuid(objectBody(body).resolvedBy, "resolvedBy");
}

/**
 * A required field, named in its own error. This used to defer to
 * optionalText, which meant an empty string was reported as the generic
 * "Expected a non-empty string." - true, but it never told the caller which
 * field they had left blank.
 */
function requiredText(
  value: unknown,
  field: string,
  maxLength = 2_000,
): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new ApiError(400, `${field} is required.`);
  }

  const text = value.trim();

  // A required string with no ceiling is a resource-exhaustion vector: an
  // objective, for one, is handed straight to the planner's model. The
  // default is generous for every field that does not set its own bound.
  if (text.length > maxLength) {
    throw new ApiError(
      400,
      `${field} must be ${maxLength} characters or fewer.`,
    );
  }

  return text;
}

function optionalText(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "string" || !value.trim()) {
    throw new ApiError(400, "Expected a non-empty string.");
  }

  return value.trim();
}

function parseOptionalLimit(value: unknown): number | undefined {
  const text = optionalText(value);

  if (text === undefined) {
    return undefined;
  }

  const parsed = Number(text);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new ApiError(400, "limit must be a positive integer.");
  }

  return parsed;
}

function parsePriority(value: unknown): WorkPriority | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (
    value === "low" ||
    value === "normal" ||
    value === "high" ||
    value === "critical"
  ) {
    return value;
  }

  throw new ApiError(400, "priority is invalid.");
}


function statusForError(error: Error): number {
  if (error instanceof ApiError) {
    return error.statusCode;
  }

  if (error instanceof ApprovalConflictError) {
    return 409;
  }

  if (
    error instanceof WorkspaceNotFoundError ||
    error instanceof AgentNotFoundError ||
    error instanceof KnowledgeNotFoundError ||
    error instanceof MissionTemplateNotFoundError
  ) {
    return 404;
  }

  if (
    error instanceof WorkspaceValidationError ||
    error instanceof AgentValidationError ||
    error instanceof PolicyValidationError ||
    error instanceof KnowledgeValidationError ||
    error instanceof MissionTemplateValidationError
  ) {
    return 400;
  }

  if (error instanceof KnowledgeStateError) {
    return 409;
  }

  if (error instanceof PolicyNotFoundError) {
    return 404;
  }

  // A duplicate policy name is the author mistyping rather than a server
  // fault, and the repository already phrases it for them.
  if (error.message.includes("already exists in this organization")) {
    return 409;
  }

  if (
    error.message.startsWith("Work not found:") ||
    error.message.startsWith("Approval not found:")
  ) {
    return 404;
  }

  if (
    error.message.includes("cannot execute") ||
    error.message.includes("cannot be planned") ||
    error.message.includes("without planned tasks") ||
    error.message.includes("Only failed work can be retried")
  ) {
    return 409;
  }

  // Follow the Fastify convention: plugin errors (rate-limit, etc.) carry a
  // real .statusCode rather than needing a message pattern matched here.
  const pluginStatusCode = (error as { statusCode?: unknown }).statusCode;

  if (
    typeof pluginStatusCode === "number" &&
    pluginStatusCode >= 400 &&
    pluginStatusCode < 600
  ) {
    return pluginStatusCode;
  }

  return 500;
}

function errorCode(statusCode: number): string {
  if (statusCode === 400) return "VALIDATION_ERROR";
  if (statusCode === 404) return "NOT_FOUND";
  if (statusCode === 409) return "INVALID_STATE";
  if (statusCode === 429) return "RATE_LIMITED";
  return "INTERNAL_ERROR";
}

function toError(error: unknown): Error {
  return error instanceof Error
    ? error
    : new Error(String(error));
}

class ApiError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
  }
}
