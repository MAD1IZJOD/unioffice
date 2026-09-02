import Fastify from "fastify";

import type {
  OrganizationId,
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

const developmentRequesterId =
  "1db667b1-3bd4-4d64-a7e4-dd5a5f2f4b09" as UserId;

export interface ApiServices {
  applicationService: WorkApplicationService;
  workService: WorkService;
  workExecutionService: WorkExecutionService;
  workQueryService: WorkQueryService;
  healthCheck: () => Promise<Record<string, unknown>>;
  developmentOrganizationId?: OrganizationId;
}

export function buildApiServer(
  services: ApiServices,
) {
  const app = Fastify({ logger: true });

  app.addHook("onRequest", async (_request, reply) => {
    reply.header(
      "access-control-allow-origin",
      "http://localhost:5173",
    );
    reply.header(
      "access-control-allow-methods",
      "GET,POST,OPTIONS",
    );
    reply.header(
      "access-control-allow-headers",
      "content-type",
    );
  });

  app.options("/*", async (_request, reply) => {
    return reply.status(204).send();
  });

  app.setErrorHandler((error, _request, reply) => {
    const resolvedError = toError(error);
    const statusCode = statusForError(resolvedError);

    return reply.status(statusCode).send({
      error: {
        code: errorCode(statusCode),
        message: resolvedError.message,
      },
    });
  });

  app.get("/health", healthHandler(services));
  app.post("/health", healthHandler(services));

  app.post("/work", async (request, reply) => {
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

  app.get("/work/:id", async (request) => {
    const work = await services.workQueryService.getWork(
      parameterId(request.params),
    );

    return { work };
  });

  app.post("/work/:id/plan", async (request) => {
    return services.workService.planWork(
      parameterId(request.params),
    );
  });

  app.post("/work/:id/execute", async (request) => {
    return services.workExecutionService.executeWork(
      parameterId(request.params),
    );
  });

  app.get("/work/:id/tasks", async (request) => {
    const tasks = await services.workQueryService.getTasks(
      parameterId(request.params),
    );

    return { tasks };
  });

  app.get("/work/:id/events", async (request) => {
    const events = await services.workQueryService.getEvents(
      parameterId(request.params),
    );

    return { events };
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

  return 500;
}

function errorCode(statusCode: number): string {
  if (statusCode === 400) return "VALIDATION_ERROR";
  if (statusCode === 404) return "NOT_FOUND";
  if (statusCode === 409) return "INVALID_STATE";
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
