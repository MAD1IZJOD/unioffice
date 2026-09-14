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
  MemberId,
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
  Work,
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

import {
  WorkCancellationError,
  type WorkCancellationService,
} from "./work-cancellation-service.js";

import type {
  MissionControlService,
} from "./mission-control-service.js";

import {
  MissionNotFoundError,
  MissionStateError,
} from "./mission-control-service.js";

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

import { AccessError, type AccessResolver } from "./access/access-resolver.js";
import { bearerToken, type Authenticator, type Identity } from "./access/authenticator.js";
import {
  canActIn,
  canDecideApproval,
  permissionsOf,
  reachableWorkspaces,
  reaches,
  type Access,
  type Permission,
} from "./access/permissions.js";
import { authorize, authorizeRead } from "./access/authorize.js";
import type { StreamTickets } from "./access/stream-tickets.js";
import {
  MemberNotFoundError,
  MemberStateError,
  MemberValidationError,
  type MemberService,
} from "./access/member-service.js";
import { LastOwnerError, MemberConflictError } from "@unioffice/database";

declare module "fastify" {
  interface FastifyRequest {
    /** Set once the caller's token (or stream ticket) is verified. */
    identity?: Identity;
    /** Set once the caller's membership is resolved. */
    access?: Access;
  }
}

export interface ApiServices {
  authenticator: Authenticator;
  accessResolver: Pick<AccessResolver, "resolve" | "organizationsFor">;
  streamTickets: StreamTickets;
  memberService: MemberService;
  applicationService: WorkApplicationService;
  workService: WorkService;
  workExecutionService: WorkExecutionService;
  workApprovalService: WorkApprovalService;
  workQueryService: WorkQueryService;
  workRecoveryService: WorkRecoveryService;
  workCancellationService: WorkCancellationService;
  missionControlService: MissionControlService;
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
      reply.header("access-control-allow-headers", "authorization, content-type");

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

    // Every route but the health check is a signed-in member acting inside
    // one organization. The token says who the caller is; their membership,
    // read fresh, says where and as what. The organization a request names is
    // only a choice among the caller's own - it is never trusted on its own -
    // and handlers read the organization and the actor from here, not from
    // the request.
    instance.addHook("preHandler", async (request) => {
      const route = request.routeOptions.url;

      if (request.method === "OPTIONS" || route === "/health") return;

      // The live channel cannot send headers, so a browser opens it with a
      // single-use ticket bought by a signed-in request. The ticket names who
      // and where; the membership behind it is still resolved fresh here.
      const ticket = route === "/stream"
        ? optionalText(fieldOf(request.query, "ticket"))
        : undefined;

      if (ticket !== undefined) {
        const holder = services.streamTickets.redeem(ticket);

        if (!holder) throw new ApiError(401, "Sign in to continue.");

        const requested = requestedOrganization(request);

        if (requested !== undefined && requested !== holder.organizationId) {
          throw new ApiError(404, "Organization not found.");
        }

        request.identity = holder.identity;
        request.access = await services.accessResolver.resolve(
          holder.identity,
          holder.organizationId,
        );
        return;
      }

      const token = bearerToken(request.headers.authorization);
      const identity = token ? await services.authenticator.verify(token) : null;

      if (!identity) {
        throw new ApiError(401, "Sign in to continue.");
      }

      request.identity = identity;

      // Answerable before belonging anywhere: it is how someone new, or
      // suspended, learns where they stand.
      if (route === "/me") return;

      request.access = await services.accessResolver.resolve(
        identity,
        requestedOrganization(request),
      );
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
    // Who the caller is, where they belong, and what they may do in the
    // organization they asked about. The web app shapes itself from this;
    // the server checks every action again regardless.
    instance.get("/me", async (request) => {
      const identity = request.identity;

      if (!identity) throw new ApiError(401, "Sign in to continue.");

      const memberships = await services.accessResolver.organizationsFor(identity);
      let access: Access | null = null;
      let standing: "active" | "suspended" | "none" = "none";

      try {
        access = await services.accessResolver.resolve(identity, requestedOrganization(request));
        standing = "active";
      } catch (error) {
        if (!(error instanceof AccessError)) throw error;
        if (error.statusCode === 403) standing = "suspended";
      }

      return {
        user: { id: identity.userId, email: identity.email },
        standing,
        organization: access
          ? {
              id: access.organizationId,
              memberId: access.memberId,
              role: access.role,
              permissions: permissionsOf(access.role),
              workspaces: [...access.workspaces].map(([workspaceId, level]) => ({
                workspaceId,
                access: level,
              })),
            }
          : null,
        memberships: memberships.map((member) => ({
          organizationId: member.organizationId,
          role: member.role,
          status: member.status,
        })),
      };
    });

    instance.post(
      "/stream/tickets",
      { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
      async (request, reply) => {
        const access = accessOf(request);

        if (!request.identity) throw new ApiError(401, "Sign in to continue.");

        return reply
          .status(201)
          .send(services.streamTickets.issue(request.identity, access.organizationId));
      },
    );

    instance.get("/stream", (request, reply) => {
      // Validated before the reply is hijacked. Afterwards the shared error
      // handler no longer owns this response, so a rejected request has to be
      // rejected while it can still be answered normally.
      const query = objectBody(request.query);
      const organizationId = organizationOf(request);
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

      let reach = reachOf(accessOf(request));
      let index: Map<WorkId, WorkspaceId | undefined> | undefined;

      // Someone who reaches only some workspaces is sent only those missions'
      // events. Which mission is where is read once, and again when an event
      // names a mission not seen yet - one just opened.
      const visible = async (events: Event[]): Promise<Event[]> => {
        const narrow = reach;

        if (!narrow) return events;

        if (!index || events.some((event) => event.workId && !index!.has(event.workId))) {
          index = await services.workQueryService.workspaceIndex(organizationId);
        }

        const known = index;

        return events.filter((event) =>
          !event.workId || (known.has(event.workId) && narrow(known.get(event.workId))));
      };

      const subscription = services.executionStream.subscribe(
        organizationId,
        (events) => {
          const relevant = workId
            ? events.filter((event) => event.workId === workId)
            : events;

          if (relevant.length === 0) return;

          visible(relevant).then(
            (shown) => {
              if (shown.length > 0) send("activity", { events: shown.map(streamFrame) });
            },
            (error: unknown) => {
              request.log.warn({ err: error }, "Could not narrow live events to the caller's workspaces.");
            },
          );
        },
      );

      // An idle connection is indistinguishable from a dead one, and every
      // layer between here and the browser will eventually reclaim it. The
      // comment frame is the protocol's own keep-alive and costs one line.
      //
      // Each heartbeat also re-reads the membership behind the channel, so
      // someone suspended, removed or moved out of a workspace stops receiving
      // that activity within one interval rather than whenever they reconnect.
      const heartbeat = setInterval(() => {
        if (raw.writableEnded) return;
        raw.write(`: keep-alive ${Date.now()}\n\n`);

        const identity = request.identity;
        if (!identity) return;

        services.accessResolver.resolve(identity, organizationId).then(
          (fresh) => {
            request.access = fresh;
            reach = reachOf(fresh);
            index = undefined;
          },
          () => {
            close();
            if (!raw.writableEnded) raw.end();
          },
        );
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
      const organizationId = organizationOf(request);
      const workspaceId = optionalUuid(body.workspaceId, "workspaceId") as
        | WorkspaceId
        | undefined;

      // A workspace id from the caller is only a claim. Filing work under a
      // workspace that belongs to another organization would let it route to
      // that workspace's agents, so it has to be ours before it is used.
      if (workspaceId) {
        await services.workspaceService.getWorkspace(organizationId, workspaceId);
      }

      const access = await confirmAllowed(services, request, "missions.create", workspaceId);

      const input: CreateWorkInput = {
        organizationId,
        // The requester is the signed-in caller, not a field they get to fill
        // in. A caller-supplied requesterId used to be honoured, which was
        // authorship spoofing.
        requesterId: access.userId,
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
        organizationOf(request),
        {
          status: parseWorkStatus(query.status),
          limit: parseOptionalLimit(query.limit),
          reach: reachOf(accessOf(request)),
        },
      );

      return { work };
    });

    instance.get("/overview", async (request) => {
      const query = objectBody(request.query);

      return services.companyOverviewService.getOverview(
        organizationOf(request),
        {
          activityLimit: parseOptionalLimit(query.activityLimit),
          reach: reachOf(accessOf(request)),
        },
      );
    });

    // What needs a person, in one ranked answer every surface reads. The rail
    // badge, the drawer and the Command Center opening used to each count
    // this for themselves and could disagree on one screen.
    instance.get("/attention", async (request) => {
      const query = objectBody(request.query);

      return services.missionControlService.getAttention(
        organizationOf(request),
        { limit: parseOptionalLimit(query.limit), reach: reachOf(accessOf(request)) },
      );
    });

    // The company's operational state in one read: what is running, what is
    // blocked and why, what finished, what needs a person, and what the
    // company recently decided and learned. Built from the same state the
    // attention queue is, so the two cannot disagree.
    instance.get("/mission-control", async (request) => {
      return services.missionControlService.getMissionControl(
        organizationOf(request),
        { reach: reachOf(accessOf(request)) },
      );
    });

    // A person has seen a stopped or stalled mission. Nothing in the body but
    // the organization is read: who marked it is the server's requester, and
    // the service decides whether the mission is in a state that can be marked.
    instance.post("/work/:id/acknowledge", async (request) => {
      const work = await visibleWork(services, request);
      await confirmAllowed(services, request, "missions.operate", work.workspaceId);

      return services.missionControlService.acknowledge(
        organizationOf(request),
        work.id,
        actorOf(request),
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
      const access = accessOf(request);
      const artifacts =
        await services.workQueryService.getOrganizationArtifacts(
          access.organizationId,
          parseOptionalLimit(query.limit),
        );

      return { artifacts: await reachableByWork(services, access, artifacts) };
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
      return { work: await visibleWork(services, request) };
    });

    instance.post("/work/:id/plan", async (request) => {
      const workId = await operableWorkId(services, request);
      return services.workService.planWork(workId);
    });

    // Puts the work on the durable queue and returns immediately. A worker
    // executes it, so the run no longer depends on this process staying
    // alive. Callers watch progress through /work/:id/detail, which reads the
    // same rows the worker is writing.
    instance.post("/work/:id/execute", async (request) => {
      const workId = await operableWorkId(services, request);
      return services.executionQueueService.enqueueWork(workId, "requested");
    });

    instance.post("/work/:id/retry", async (request) => {
      const workId = await operableWorkId(services, request);
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

    // Only the reason is read from the body. Who cancelled is the server's
    // requester, and whether the mission can be cancelled - not while a worker
    // or the planner is on it - is the service's decision.
    instance.post("/work/:id/cancel", async (request) => {
      const workId = await operableWorkId(services, request);
      const body = objectBody(request.body);

      return services.workCancellationService.cancelWork(workId, {
        actorId: accessOf(request).userId,
        reason: optionalBoundedText(body.reason, "reason", 500),
      });
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
      const access = accessOf(request);
      const approvals = await services.workApprovalService.getPendingApprovals(
        access.organizationId,
      );

      return { approvals: await reachableByWork(services, access, approvals) };
    });

    // Who decided is the signed-in caller, never a field in the request. A
    // resolvedBy in the body used to be recorded as the decider, so any
    // request could put any name on a decision.
    instance.post("/approvals/:id/approve", async (request) => {
      const approvalId = await decidableApproval(services, request);
      const approval = await services.workApprovalService.approve(
        approvalId,
        accessOf(request).userId,
        organizationOf(request),
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
      const approvalId = await decidableApproval(services, request);
      const approval = await services.workApprovalService.reject(
        approvalId,
        accessOf(request).userId,
        organizationOf(request),
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
        organizationOf(request),
        { activityLimit: parseOptionalLimit(query.activityLimit) },
      );
    });

    instance.get("/policies", async (request) => {
      const query = objectBody(request.query);

      const policies = await services.governanceService.listPolicies(
        organizationOf(request),
        { includeArchived: query.includeArchived === "true" },
      );

      return { policies };
    });

    instance.get("/policies/:id", async (request) => {
      const query = objectBody(request.query);

      const policy = await services.governanceService.getPolicy(
        organizationOf(request),
        parameterId(request.params) as unknown as PolicyId,
      );

      return { policy };
    });

    instance.post("/policies", async (request, reply) => {
      const body = objectBody(request.body);
      const access = await confirmAllowed(services, request, "policies.manage");

      const policy = await services.governanceService.createPolicy({
        organizationId: access.organizationId,
        name: requiredText(body.name, "name"),
        description: optionalText(body.description) ?? "",
        subject: parsePolicySubject(body.subject),
        effect: parsePolicyEffect(body.effect),
        risk: parseRiskLevel(body.risk),
        status: parsePolicyStatus(body.status),
        scope: parsePolicyScope(body.scope),
        approvalPrompt: optionalText(body.approvalPrompt),
        // The author is the signed-in caller. A createdBy in the body used to
        // be recorded as the author of a governance rule.
        createdBy: actorOf(request),
      });

      return reply.status(201).send({ policy });
    });

    instance.post("/policies/:id", async (request) => {
      const body = objectBody(request.body);
      const access = await confirmAllowed(services, request, "policies.manage");

      const policy = await services.governanceService.updatePolicy({
        organizationId: access.organizationId,
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
    // Every one of these acts inside the caller's organization and refuses a
    // workspace or agent belonging to another one. Changing workspaces,
    // agents and their tool grants is for the roles that run the
    // organization; which tools an agent may call stays the agent's grant and
    // governance's decision, never the person's.
    // ---------------------------------------------------------------------

    // ---------------------------------------------------------------------
    // Members.
    //
    // Who belongs, at what role, and in which workspaces. Whether the caller
    // may make a change - and to whom - is decided in the service against
    // their own membership, read fresh; these handlers only read the route
    // and the few fields each change takes.
    // ---------------------------------------------------------------------

    instance.get("/members", async (request) => {
      return { members: await services.memberService.listMembers(accessOf(request)) };
    });

    instance.post("/members", { config: { rateLimit: MEMBER_WRITE_LIMIT } }, async (request, reply) => {
      const body = objectBody(request.body);
      const member = await services.memberService.invite(accessOf(request), {
        email: body.email,
        role: body.role,
      });

      return reply.status(201).send({ member });
    });

    instance.post("/members/:id/role", { config: { rateLimit: MEMBER_WRITE_LIMIT } }, async (request) => {
      const body = objectBody(request.body);

      return {
        member: await services.memberService.changeRole(accessOf(request), parameterMemberId(request.params), {
          role: body.role,
        }),
      };
    });

    instance.post("/members/:id/suspend", { config: { rateLimit: MEMBER_WRITE_LIMIT } }, async (request) => {
      return { member: await services.memberService.suspend(accessOf(request), parameterMemberId(request.params)) };
    });

    instance.post("/members/:id/reactivate", { config: { rateLimit: MEMBER_WRITE_LIMIT } }, async (request) => {
      return { member: await services.memberService.reactivate(accessOf(request), parameterMemberId(request.params)) };
    });

    instance.post("/members/:id/remove", { config: { rateLimit: MEMBER_WRITE_LIMIT } }, async (request) => {
      return services.memberService.remove(accessOf(request), parameterMemberId(request.params));
    });

    // access is "member", "viewer", or null to take the grant away.
    instance.post("/members/:id/workspaces", { config: { rateLimit: MEMBER_WRITE_LIMIT } }, async (request) => {
      const body = objectBody(request.body);

      return {
        member: await services.memberService.setWorkspaceAccess(accessOf(request), parameterMemberId(request.params), {
          workspaceId: body.workspaceId,
          access: body.access === undefined ? "missing" : body.access,
        }),
      };
    });

    instance.get("/organization", async (request) => {
      const query = objectBody(request.query);

      return services.workspaceService.getOrganizationOverview(
        organizationOf(request),
      );
    });

    instance.get("/workspaces", async (request) => {
      const query = objectBody(request.query);
      const workspaces = await services.workspaceService.listWorkspaces(
        organizationOf(request),
      );

      return { workspaces };
    });

    instance.post("/workspaces", async (request, reply) => {
      const body = objectBody(request.body);
      const access = await confirmAllowed(services, request, "workspaces.manage");

      const workspace = await services.workspaceService.createWorkspace({
        organizationId: access.organizationId,
        name: requiredText(body.name, "name"),
        description: optionalText(body.description),
      });

      return reply.status(201).send({ workspace });
    });

    instance.get("/workspaces/:id", async (request) => {
      const access = accessOf(request);
      const workspaceId = parameterId(request.params) as unknown as WorkspaceId;

      // A workspace the caller was not given reads as one that does not exist.
      authorizeRead(access, workspaceId, () => new ApiError(404, "Workspace not found."));

      return services.workspaceService.getWorkspaceDetail(access.organizationId, workspaceId);
    });

    instance.post("/workspaces/:id", async (request) => {
      const body = objectBody(request.body);
      const workspaceId = parameterId(request.params) as unknown as WorkspaceId;
      const access = await confirmAllowed(services, request, "workspaces.manage", workspaceId);

      const workspace = await services.workspaceService.updateWorkspace({
        organizationId: access.organizationId,
        workspaceId,
        name: optionalText(body.name),
        description: nullableText(body.description),
        status: parseWorkspaceStatus(body.status),
      });

      return { workspace };
    });

    instance.get("/agents/:id", async (request) => {
      const query = objectBody(request.query);

      return services.agentDirectoryService.getAgentDetail(
        organizationOf(request),
        parameterId(request.params) as unknown as AgentId,
      );
    });

    instance.post("/agents", async (request, reply) => {
      const body = objectBody(request.body);
      const access = await confirmAllowed(services, request, "agents.configure");

      const agent = await services.agentDirectoryService.createAgent({
        organizationId: access.organizationId,
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
      const access = await confirmAllowed(services, request, "agents.configure");

      const agent = await services.agentDirectoryService.updateAgent({
        organizationId: access.organizationId,
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
        organizationOf(request),
      );

      return { agents };
    });

    instance.get("/activity", async (request) => {
      const query = objectBody(request.query);
      const access = accessOf(request);
      const events = await services.workQueryService.getOrganizationActivity(
        access.organizationId,
        parseOptionalLimit(query.limit),
      );

      return { events: await reachableByWork(services, access, events) };
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
        organizationOf(request),
      );

      return { templates };
    });

    instance.get("/mission-templates/:templateId", async (request) => {
      const query = objectBody(request.query);

      return services.missionTemplateService.getTemplate(
        organizationOf(request),
        parameterTemplateId(request.params),
      );
    });

    instance.post(
      "/mission-templates/:templateId/missions",
      { config: { rateLimit: KNOWLEDGE_WRITE_LIMIT } },
      async (request, reply) => {
        const body = objectBody(request.body);
        const workspaceId = optionalUuid(body.workspaceId, "workspaceId") as WorkspaceId | undefined;
        const access = await confirmAllowed(services, request, "missions.create", workspaceId);

        // Only these fields are read. Anything else in the body - a status,
        // agents, tasks, approval state, another requester - never reaches the
        // service.
        const work = await services.missionTemplateService.startMission({
          organizationId: access.organizationId,
          requesterId: access.userId,
          templateId: parameterTemplateId(request.params),
          name: templateText(body.name, "name"),
          objective: templateText(body.objective, "objective") ?? "",
          context: templateText(body.context, "context"),
          desiredOutcome: templateText(body.desiredOutcome, "desiredOutcome") ?? "",
          constraints: templateText(body.constraints, "constraints"),
          priority: parsePriority(body.priority),
          workspaceId,
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
        organizationOf(request),
        {
          query: optionalBoundedText(query.query, "query", MAX_KNOWLEDGE_QUERY_CHARS),
          limit: parseOptionalLimit(query.limit),
        },
        reachOf(accessOf(request)),
      );

      return { memories: result.items.map((item) => item.knowledge) };
    });

    instance.get("/knowledge", { config: { rateLimit: KNOWLEDGE_SEARCH_LIMIT } }, async (request) => {
      const query = objectBody(request.query);
      const access = accessOf(request);
      const workspaceId = parseWorkspaceFilter(query.workspaceId);

      if (workspaceId) {
        authorizeRead(access, workspaceId, () => new KnowledgeNotFoundError("Workspace not found."));
      }

      return services.companyBrainService.search(
        access.organizationId,
        {
          query: optionalBoundedText(query.query, "query", MAX_KNOWLEDGE_QUERY_CHARS),
          types: parseKnowledgeTypes(query.types),
          statuses: parseKnowledgeStatuses(query.statuses),
          workspaceId,
          sourceType: parseKnowledgeSourceType(query.sourceType),
          minImportance: parseUnitNumber(query.minImportance, "minImportance"),
          createdAfter: parseOptionalDate(query.createdAfter, "createdAfter"),
          createdBefore: parseOptionalDate(query.createdBefore, "createdBefore"),
          limit: parseOptionalLimit(query.limit),
          offset: parseOptionalOffset(query.offset),
        },
        reachOf(access),
      );
    });

    instance.get("/knowledge/overview", async (request) => {
      return services.companyBrainService.getOverview(
        organizationOf(request),
        reachOf(accessOf(request)),
      );
    });

    instance.get("/knowledge/recall-preview", { config: { rateLimit: KNOWLEDGE_SEARCH_LIMIT } }, async (request) => {
      const query = objectBody(request.query);
      const access = accessOf(request);
      const workspaceId = optionalUuid(query.workspaceId, "workspaceId") as WorkspaceId | undefined;

      authorizeRead(access, workspaceId, () => new KnowledgeNotFoundError("Workspace not found."));

      return services.companyBrainService.previewRecall(
        access.organizationId,
        {
          query: requiredText(query.query, "query", MAX_KNOWLEDGE_QUERY_CHARS),
          workspaceId,
          agentId: optionalUuid(query.agentId, "agentId") as AgentId | undefined,
        },
        reachOf(access),
      );
    });

    instance.get("/knowledge/:id", async (request) => {
      const access = accessOf(request);
      const knowledgeId = parameterUuid(request.params) as MemoryId;
      const workspaceId = await services.companyBrainService.locateKnowledge(access.organizationId, knowledgeId);

      authorizeRead(access, workspaceId, () => new KnowledgeNotFoundError());

      return services.companyBrainService.getDetail(access.organizationId, knowledgeId, reachOf(access));
    });

    // Anyone who may propose knowledge may write it; only someone who may
    // curate it there has it count straight away. Everyone else's waits for
    // review, however it was phrased.
    instance.post("/knowledge", { config: { rateLimit: KNOWLEDGE_WRITE_LIMIT } }, async (request, reply) => {
      const body = objectBody(request.body);
      const workspaceId = optionalUuid(body.workspaceId, "workspaceId") as WorkspaceId | undefined;
      const access = await confirmAllowed(services, request, "knowledge.propose", workspaceId);

      const knowledge = await services.companyBrainService.createKnowledge({
        organizationId: access.organizationId,
        title: requiredText(body.title, "title", 200),
        content: requiredText(body.content, "content", 4_000),
        type: parseKnowledgeType(body.type),
        importance: parseUnitNumber(body.importance, "importance"),
        confidence: parseUnitNumber(body.confidence, "confidence"),
        workspaceId,
        createdBy: actorOf(request),
        proposeOnly: !canActIn(access, "knowledge.curate", workspaceId),
      });

      return reply.status(201).send({ knowledge });
    });

    instance.post("/knowledge/:id", { config: { rateLimit: KNOWLEDGE_WRITE_LIMIT } }, async (request) => {
      const body = objectBody(request.body);
      const knowledgeId = parameterUuid(request.params) as MemoryId;
      const movingTo = typeof body.workspaceId === "string"
        ? (requiredUuid(body.workspaceId, "workspaceId") as WorkspaceId)
        : undefined;

      await curatableKnowledge(services, request, [knowledgeId], movingTo);

      const knowledge = await services.companyBrainService.updateKnowledge({
        organizationId: organizationOf(request),
        knowledgeId,
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
        updatedBy: actorOf(request),
      });

      return { knowledge };
    });

    instance.post("/knowledge/:id/approve", { config: { rateLimit: KNOWLEDGE_WRITE_LIMIT } }, async (request) => {
      const knowledgeId = parameterUuid(request.params) as MemoryId;
      await curatableKnowledge(services, request, [knowledgeId]);

      const knowledge = await services.companyBrainService.approveKnowledge(
        organizationOf(request),
        knowledgeId,
        actorOf(request),
      );

      return { knowledge };
    });

    instance.post("/knowledge/:id/archive", { config: { rateLimit: KNOWLEDGE_WRITE_LIMIT } }, async (request) => {
      const body = objectBody(request.body);
      const knowledgeId = parameterUuid(request.params) as MemoryId;
      await curatableKnowledge(services, request, [knowledgeId]);

      const knowledge = await services.companyBrainService.archiveKnowledge(
        organizationOf(request),
        knowledgeId,
        {
          by: actorOf(request),
          reason: optionalBoundedText(body.reason, "reason", 500),
        },
      );

      return { knowledge };
    });

    instance.post("/knowledge/:id/restore", { config: { rateLimit: KNOWLEDGE_WRITE_LIMIT } }, async (request) => {
      const knowledgeId = parameterUuid(request.params) as MemoryId;
      await curatableKnowledge(services, request, [knowledgeId]);

      const knowledge = await services.companyBrainService.restoreKnowledge(
        organizationOf(request),
        knowledgeId,
        actorOf(request),
      );

      return { knowledge };
    });

    // The knowledge in the route is the restatement; intoId is the entry it
    // says the same as. Both ids are resolved inside the caller's organization.
    instance.post("/knowledge/:id/merge", { config: { rateLimit: KNOWLEDGE_WRITE_LIMIT } }, async (request) => {
      const body = objectBody(request.body);
      const duplicateId = parameterUuid(request.params) as MemoryId;
      const intoId = requiredUuid(body.intoId, "intoId") as MemoryId;
      await curatableKnowledge(services, request, [duplicateId, intoId]);

      const { kept, merged } = await services.companyBrainService.mergeKnowledge(
        organizationOf(request),
        duplicateId,
        intoId,
        actorOf(request),
      );

      return { knowledge: kept, merged };
    });

    // The knowledge in the route is the newer entry; replacesId is the older
    // one it retires.
    instance.post("/knowledge/:id/supersede", { config: { rateLimit: KNOWLEDGE_WRITE_LIMIT } }, async (request) => {
      const body = objectBody(request.body);
      const newerId = parameterUuid(request.params) as MemoryId;
      const olderId = requiredUuid(body.replacesId, "replacesId") as MemoryId;
      await curatableKnowledge(services, request, [newerId, olderId]);

      const { current, replaced } = await services.companyBrainService.supersedeKnowledge(
        organizationOf(request),
        newerId,
        olderId,
        actorOf(request),
        optionalBoundedText(body.note, "note", 500),
      );

      return { knowledge: current, replaced };
    });

    instance.post("/knowledge/conflicts/:id/resolve", { config: { rateLimit: KNOWLEDGE_WRITE_LIMIT } }, async (request) => {
      const body = objectBody(request.body);
      const conflictId = parameterUuid(request.params) as KnowledgeConflictId;
      const access = accessOf(request);
      const sides = await services.companyBrainService.locateConflict(access.organizationId, conflictId);

      for (const side of sides) {
        authorizeRead(access, side, () => new KnowledgeNotFoundError("Conflict not found."));
      }

      await confirmCurating(services, request, sides);

      const conflict = await services.companyBrainService.resolveConflict(
        organizationOf(request),
        conflictId,
        parseConflictResolution(body),
        actorOf(request),
        optionalBoundedText(body.note, "note", 500),
      );

      return { conflict };
    });

    // Asks a model to read the artifact, so it is the most expensive write
    // here and limited accordingly.
    instance.post("/artifacts/:id/knowledge", { config: { rateLimit: KNOWLEDGE_DERIVE_LIMIT } }, async (request) => {
      const access = await confirmAllowed(services, request, "knowledge.propose");

      const report = await services.companyBrainService.deriveFromArtifact(
        access.organizationId,
        parameterUuid(request.params) as ArtifactId,
        actorOf(request),
        reachOf(access),
      );

      return report;
    });

    instance.get("/work/:id/knowledge", async (request) => {
      const workId = await authorizedWorkId(services, request);

      return services.companyBrainService.getMissionKnowledge(
        organizationOf(request),
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
const MEMBER_WRITE_LIMIT = { max: 30, timeWindow: "1 minute" };

/** The verified caller. Only the sign-in hook sets it. */
function accessOf(request: { access?: Access }): Access {
  if (!request.access) throw new ApiError(401, "Sign in to continue.");
  return request.access;
}

/** The organization the caller is acting in, as their membership says. */
function organizationOf(request: { access?: Access }): OrganizationId {
  return accessOf(request).organizationId;
}

/**
 * Who is acting, for provenance: the signed-in user, never anything the
 * request says about itself.
 */
function actorOf(request: { access?: Access }): string {
  return `user:${accessOf(request).userId}`;
}

/**
 * The organization a request names, if any. A query string and a body that
 * name two different ones are refused rather than one being picked.
 */
function requestedOrganization(request: { query: unknown; body: unknown }): string | undefined {
  const fromQuery = optionalText(fieldOf(request.query, "organizationId"));
  const fromBody = optionalText(fieldOf(request.body, "organizationId"));

  if (fromQuery && fromBody && fromQuery !== fromBody) {
    throw new ApiError(404, "Organization not found.");
  }

  return fromQuery ?? fromBody;
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

/** One field of a query or body that may not be an object at all (a GET has no body). */
function fieldOf(value: unknown, field: string): unknown {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)[field]
    : undefined;
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
  request: { params: unknown; access?: Access },
): Promise<WorkId> {
  return (await visibleWork(services, request)).id;
}

/**
 * The work in the route, as something the caller may see: in their
 * organization, and in a workspace they reach. A mission in a workspace they
 * were never given reads exactly like one that does not exist.
 */
async function visibleWork(
  services: ApiServices,
  request: { params: unknown; access?: Access },
): Promise<Work> {
  const workId = parameterId(request.params);
  const access = accessOf(request);
  const work = await services.workQueryService.assertWorkInOrganization(
    workId,
    access.organizationId,
  );

  authorizeRead(access, work.workspaceId, () => new Error(`Work not found: ${workId}`));

  return work;
}

/**
 * The approval in the route, confirmed as one the caller may decide right now.
 *
 * In order: it must be in their organization and a workspace they reach (or
 * it reads as not found); their role and grant there must allow deciding,
 * checked against their membership as it stands at this moment; and a step a
 * governance policy put in front of a person needs an owner or an admin. The
 * one governance model decides which steps wait; this only decides who may
 * answer them.
 */
async function decidableApproval(
  services: ApiServices,
  request: { params: unknown; access?: Access; identity?: Identity },
): Promise<ApprovalId> {
  const approvalId = parameterApprovalId(request.params);
  const access = accessOf(request);
  const context = await services.workApprovalService.getDecisionContext(
    approvalId,
    access.organizationId,
  );

  authorizeRead(access, context.workspaceId, () => new Error(`Approval not found: ${approvalId}`));

  const current = await confirmAllowed(services, request, "approvals.decide", context.workspaceId);

  if (!canDecideApproval(current, context)) {
    throw new AccessError(403, "Only an owner or admin can decide a step a governance policy requires.");
  }

  return approvalId;
}

/**
 * Narrows anything tied to a mission to the missions the caller reaches.
 * Owners and admins reach everything, so they cost no extra read. An item
 * naming a mission that cannot be placed is left out rather than shown.
 */
async function reachableByWork<T extends { workId?: WorkId }>(
  services: ApiServices,
  access: Access,
  items: T[],
): Promise<T[]> {
  if (reachableWorkspaces(access) === "all") return items;

  const index = await services.workQueryService.workspaceIndex(access.organizationId);

  return items.filter((item) =>
    !item.workId || (index.has(item.workId) && reaches(access, index.get(item.workId))));
}

/**
 * A caller's workspace reach as a filter, or nothing for owners and admins,
 * who reach every workspace and so need nothing narrowed.
 */
function reachOf(access: Access): ((workspaceId: WorkspaceId | undefined) => boolean) | undefined {
  return reachableWorkspaces(access) === "all"
    ? undefined
    : (workspaceId) => reaches(access, workspaceId);
}

/**
 * Knowledge the caller may curate right now: every entry named must be in a
 * workspace they reach (or it reads as not found), and they must be allowed
 * to curate in each of those workspaces - and in the one it is moving to.
 */
async function curatableKnowledge(
  services: ApiServices,
  request: { access?: Access; identity?: Identity },
  knowledgeIds: MemoryId[],
  movingTo?: WorkspaceId,
): Promise<Access> {
  const access = accessOf(request);
  const workspaces = await Promise.all(
    knowledgeIds.map((id) => services.companyBrainService.locateKnowledge(access.organizationId, id)),
  );

  for (const workspaceId of workspaces) {
    authorizeRead(access, workspaceId, () => new KnowledgeNotFoundError());
  }

  return confirmCurating(services, request, movingTo ? [...workspaces, movingTo] : workspaces);
}

/** Curating in every one of these workspaces, checked against the membership as it stands now. */
async function confirmCurating(
  services: ApiServices,
  request: { access?: Access; identity?: Identity },
  workspaces: Array<WorkspaceId | undefined>,
): Promise<Access> {
  for (const workspaceId of workspaces) authorize(accessOf(request), "knowledge.curate", workspaceId);

  const fresh = await confirmAllowed(services, request, "knowledge.curate", workspaces[0]);

  for (const workspaceId of workspaces) authorize(fresh, "knowledge.curate", workspaceId);

  return fresh;
}

/** The work in the route, confirmed as something the caller may operate right now. */
async function operableWorkId(
  services: ApiServices,
  request: { params: unknown; access?: Access; identity?: Identity },
): Promise<WorkId> {
  const work = await visibleWork(services, request);
  await confirmAllowed(services, request, "missions.operate", work.workspaceId);
  return work.id;
}

/**
 * Checks the caller may do this here - then checks again against their
 * membership as it stands now.
 *
 * Reads use the membership resolved when the request arrived. A change that
 * starts work, stops it or decides a step re-reads it immediately before
 * acting, so a role change, suspension or removed workspace grant that landed
 * while the request was in flight is honoured rather than outrun.
 */
async function confirmAllowed(
  services: ApiServices,
  request: { access?: Access; identity?: Identity },
  permission: Permission,
  workspaceId?: WorkspaceId | null,
): Promise<Access> {
  const current = accessOf(request);

  authorize(current, permission, workspaceId);

  if (!request.identity) throw new ApiError(401, "Sign in to continue.");

  const fresh = await services.accessResolver.resolve(request.identity, current.organizationId);

  authorize(fresh, permission, workspaceId);
  request.access = fresh;

  return fresh;
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

function parameterMemberId(params: unknown): MemberId {
  return parameterUuid(params) as MemberId;
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
  if (error instanceof ApiError || error instanceof AccessError) {
    return error.statusCode;
  }

  if (error instanceof ApprovalConflictError) {
    return 409;
  }

  if (
    error instanceof WorkspaceNotFoundError ||
    error instanceof AgentNotFoundError ||
    error instanceof KnowledgeNotFoundError ||
    error instanceof MissionTemplateNotFoundError ||
    error instanceof MissionNotFoundError ||
    error instanceof MemberNotFoundError
  ) {
    return 404;
  }

  if (error instanceof MemberValidationError) {
    return 400;
  }

  if (
    error instanceof MemberStateError ||
    error instanceof MemberConflictError ||
    error instanceof LastOwnerError
  ) {
    return 409;
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

  if (
    error instanceof KnowledgeStateError ||
    error instanceof MissionStateError ||
    error instanceof WorkCancellationError
  ) {
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
  if (statusCode === 401) return "UNAUTHENTICATED";
  if (statusCode === 403) return "FORBIDDEN";
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
