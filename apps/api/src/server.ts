import Fastify from "fastify";

import rateLimit from "@fastify/rate-limit";

import type {
  OrganizationId,
  ApprovalId,
  UserId,
  WorkId,
  WorkPriority,
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
  CompanyBrainService,
} from "./company-brain-service.js";

const developmentRequesterId =
  "1db667b1-3bd4-4d64-a7e4-dd5a5f2f4b09" as UserId;

export interface ApiServices {
  applicationService: WorkApplicationService;
  workService: WorkService;
  workExecutionService: WorkExecutionService;
  workApprovalService: WorkApprovalService;
  workQueryService: WorkQueryService;
  companyBrainService: CompanyBrainService;
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
  
    instance.post("/work", async (request, reply) => {
      const body = objectBody(request.body);
      const organizationId =
        optionalText(body.organizationId) ??
        services.developmentOrganizationId;
  
      if (!organizationId) {
        throw new ApiError(
          400,
          "organizationId is required when no development workforce is seeded.",
        );
      }
  
      const input: CreateWorkInput = {
        organizationId: organizationId as OrganizationId,
        requesterId:
          (optionalText(body.requesterId) ??
            developmentRequesterId) as UserId,
        objective: requiredText(body.objective, "objective"),
        priority: parsePriority(body.priority),
        workspaceId: optionalText(body.workspaceId) as
          | CreateWorkInput["workspaceId"]
          | undefined,
        metadata: objectMetadata(body.metadata),
      };
  
      const work =
        await services.applicationService.createWork(input);
  
      return reply.status(201).send({ work });
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
  
    instance.post("/work/:id/execute", async (request) => {
      return services.workExecutionService.executeWork(
        parameterId(request.params),
      );
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
      const organizationId = optionalText(query.organizationId) ??
        services.developmentOrganizationId;
      if (!organizationId) {
        throw new ApiError(400, "organizationId is required when no development workforce is seeded.");
      }
      const approvals = await services.workApprovalService.getPendingApprovals(
        organizationId as OrganizationId,
      );
      return { approvals };
    });
  
    instance.post("/approvals/:id/approve", async (request) => {
      const approval = await services.workApprovalService.approve(
        parameterApprovalId(request.params),
        resolverId(request.body),
      );
      const execution = await services.workExecutionService.executeWork(
        approval.workId,
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
  
    instance.get("/agents", async (request) => {
      const query = objectBody(request.query);
      const organizationId = optionalText(query.organizationId) ??
        services.developmentOrganizationId;
  
      if (!organizationId) {
        throw new ApiError(400, "organizationId is required when no development workforce is seeded.");
      }
  
      const agents = await services.workQueryService.getAgents(
        organizationId as OrganizationId,
      );
  
      return { agents };
    });
  
    instance.get("/activity", async (request) => {
      const query = objectBody(request.query);
      const organizationId = optionalText(query.organizationId) ??
        services.developmentOrganizationId;
  
      if (!organizationId) {
        throw new ApiError(400, "organizationId is required when no development workforce is seeded.");
      }
  
      const events = await services.workQueryService.getOrganizationActivity(
        organizationId as OrganizationId,
        parseOptionalLimit(query.limit),
      );
  
      return { events };
    });
  
    instance.get("/memory", async (request) => {
      const query = objectBody(request.query);
      const organizationId = optionalText(query.organizationId) ??
        services.developmentOrganizationId;
  
      if (!organizationId) {
        throw new ApiError(400, "organizationId is required when no development workforce is seeded.");
      }
  
      const searchQuery = optionalText(query.query);
  
      const memories = searchQuery
        ? await services.companyBrainService.retrieveRelevant({
            organizationId: organizationId as OrganizationId,
            query: searchQuery,
            limit: parseOptionalLimit(query.limit),
          })
        : await services.companyBrainService.listByOrganization(
            organizationId as OrganizationId,
          );
  
      return { memories };
      });
  });

  return app;
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

function requiredText(value: unknown, field: string): string {
  const text = optionalText(value);

  if (!text) {
    throw new ApiError(400, `${field} is required.`);
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

  if (error.message.startsWith("Work not found:")) {
    return 404;
  }

  if (
    error.message.includes("cannot execute") ||
    error.message.includes("cannot be planned") ||
    error.message.includes("without planned tasks")
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
