import Fastify from "fastify";

import rateLimit from "@fastify/rate-limit";

import type {
  AgentId,
  AgentStatus,
  AgentType,
  Event,
  OrganizationId,
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
  ExecutionRoomService,
} from "./execution-room-service.js";

import type {
  ExecutionStream,
} from "./execution-stream.js";

import type {
  CompanyBrainService,
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
  workspaceService: WorkspaceService;
  agentDirectoryService: AgentDirectoryService;
  toolRegistry: ToolRegistry;
  healthCheck: () => Promise<Record<string, unknown>>;
  developmentOrganizationId?: OrganizationId;
  corsOrigins: string[];
}

export function buildApiServer(
  services: ApiServices,
) {
  const app = Fastify({ logger: true });

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
      const input: CreateWorkInput = {
        organizationId: requiredOrganizationId(
          services,
          body.organizationId,
        ),
        requesterId:
          (optionalText(body.requesterId) ??
            developmentRequesterId) as UserId,
        objective: requiredText(body.objective, "objective"),
        priority: parsePriority(body.priority),
        workspaceId: optionalText(body.workspaceId) as
          | CreateWorkInput["workspaceId"]
          | undefined,
        metadata: withBriefing(
          objectMetadata(body.metadata),
          parseBriefing(body.briefing),
        ),
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
      return services.executionRoomService.getRoom(parameterId(request.params));
    });

    instance.get("/work/:id/detail", async (request) => {
      const workId = parameterId(request.params);
      const [detail, job] = await Promise.all([
        services.workQueryService.getWorkDetail(workId),
        services.executionQueueService.getActiveJob(workId),
      ]);

      // Real queue state, read from the job row - never a guess about what a
      // worker might be doing.
      return { ...detail, executionJob: job };
    });

    instance.get("/work/:id", async (request) => {
      const work = await services.workQueryService.getWork(
        parameterId(request.params),
      );
  
      return { work };
    });
  
    instance.post("/work/:id/plan", async (request) => {
      return services.workService.planWork(
        parameterId(request.params),
      );
    });
  
    // Puts the work on the durable queue and returns immediately. A worker
    // executes it, so the run no longer depends on this process staying
    // alive. Callers watch progress through /work/:id/detail, which reads the
    // same rows the worker is writing.
    instance.post("/work/:id/execute", async (request) => {
      return services.executionQueueService.enqueueWork(
        parameterId(request.params),
        "requested",
      );
    });
  
    instance.post("/work/:id/retry", async (request) => {
      const workId = parameterId(request.params);
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
        parameterId(request.params),
      );
  
      return { tasks };
    });
  
    instance.get("/work/:id/events", async (request) => {
      const events = await services.workQueryService.getEvents(
        parameterId(request.params),
      );
  
      return { events };
    });
  
    instance.get("/work/:id/artifacts", async (request) => {
      const artifacts = await services.workQueryService.getArtifacts(
        parameterId(request.params),
      );
  
      return { artifacts };
    });
  
    instance.get("/work/:id/approvals", async (request) => {
      const approvals = await services.workApprovalService.getWorkApprovals(
        parameterId(request.params),
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
      );
      return { approval };
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
  
    instance.get("/memory", async (request) => {
      const query = objectBody(request.query);
      const organizationId = requiredOrganizationId(
        services,
        query.organizationId,
      );
      const searchQuery = optionalText(query.query);

      const memories = searchQuery
        ? await services.companyBrainService.retrieveRelevant({
            organizationId,
            query: searchQuery,
            limit: parseOptionalLimit(query.limit),
          })
        : await services.companyBrainService.listByOrganization(
            organizationId,
          );

      return { memories };
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

function safeLength(payload: Record<string, unknown>): number {
  try {
    return JSON.stringify(payload)?.length ?? 0;
  } catch {
    // A payload that will not serialize cannot be sent either way.
    return Number.POSITIVE_INFINITY;
  }
}

/**
 * Every organization-scoped read resolves the same way: an explicit id, or
 * the seeded development organization when one exists. This was copy-pasted
 * into five handlers before the second wave of routes made that untenable.
 */
function requiredOrganizationId(
  services: ApiServices,
  value: unknown,
): OrganizationId {
  const organizationId =
    optionalText(value) ?? services.developmentOrganizationId;

  if (!organizationId) {
    throw new ApiError(
      400,
      "organizationId is required when no development workforce is seeded.",
    );
  }

  return organizationId as OrganizationId;
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

function parameterId(params: unknown): WorkId {
  if (typeof params !== "object" || params === null) {
    throw new ApiError(400, "Route id is required.");
  }

  return requiredText(
    (params as Record<string, unknown>).id,
    "id",
  ) as WorkId;
}

function parameterApprovalId(params: unknown): ApprovalId {
  if (typeof params !== "object" || params === null) {
    throw new ApiError(400, "Route id is required.");
  }
  return requiredText(
    (params as Record<string, unknown>).id,
    "id",
  ) as ApprovalId;
}

function resolverId(body: unknown): string {
  return requiredText(objectBody(body).resolvedBy, "resolvedBy");
}

/**
 * A required field, named in its own error. This used to defer to
 * optionalText, which meant an empty string was reported as the generic
 * "Expected a non-empty string." - true, but it never told the caller which
 * field they had left blank.
 */
function requiredText(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new ApiError(400, `${field} is required.`);
  }

  return value.trim();
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

function objectMetadata(
  value: unknown,
): Record<string, unknown> | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "object" || value === null) {
    throw new ApiError(400, "metadata must be an object.");
  }

  return value as Record<string, unknown>;
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
    error instanceof AgentNotFoundError
  ) {
    return 404;
  }

  if (
    error instanceof WorkspaceValidationError ||
    error instanceof AgentValidationError
  ) {
    return 400;
  }

  if (error.message.startsWith("Work not found:")) {
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
