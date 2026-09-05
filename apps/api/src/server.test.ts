import assert from "node:assert/strict";
import test from "node:test";

import type { OrganizationId, Work, WorkId } from "@unioffice/core";

import { buildApiServer, type ApiServices } from "./server.js";
import type { WorkQueryService } from "./work-query-service.js";

function baseServices(overrides: Partial<ApiServices> = {}): ApiServices {
  return {
    applicationService: {} as ApiServices["applicationService"],
    workService: {} as ApiServices["workService"],
    workExecutionService: {} as ApiServices["workExecutionService"],
    workApprovalService: {} as ApiServices["workApprovalService"],
    workQueryService: {} as ApiServices["workQueryService"],
    companyBrainService: {} as ApiServices["companyBrainService"],
    healthCheck: async () => ({}),
    corsOrigins: ["http://localhost:5173"],
    ...overrides,
  };
}

test("returns a generic message for an unmapped internal error, never the raw error", async () => {
  const workQueryService = {
    getWork: async () => {
      throw new Error("Sensitive internal detail: password=hunter2 host=db.internal");
    },
  } as unknown as WorkQueryService;
  const app = buildApiServer(baseServices({ workQueryService }));

  const response = await app.inject({
    method: "GET",
    url: "/work/11111111-1111-1111-1111-111111111111",
  });

  assert.equal(response.statusCode, 500);
  const body = response.json();
  assert.equal(body.error.code, "INTERNAL_ERROR");
  assert.equal(body.error.message, "An internal error occurred.");
  assert.doesNotMatch(JSON.stringify(body), /hunter2/);
});

test("still returns the specific message for an intentional not-found error", async () => {
  const workQueryService = {
    getWork: async (id: WorkId) => {
      throw new Error(`Work not found: ${id}`);
    },
  } as unknown as WorkQueryService;
  const app = buildApiServer(baseServices({ workQueryService }));

  const response = await app.inject({
    method: "GET",
    url: "/work/22222222-2222-2222-2222-222222222222",
  });

  assert.equal(response.statusCode, 404);
  const body = response.json();
  assert.equal(body.error.code, "NOT_FOUND");
  assert.match(body.error.message, /Work not found: 22222222/);
});

test("returns a validation error with its intended message for bad input", async () => {
  const app = buildApiServer(baseServices({
    developmentOrganizationId: "org-1" as OrganizationId,
  }));

  const response = await app.inject({
    method: "POST",
    url: "/work",
    payload: {},
  });

  assert.equal(response.statusCode, 400);
  const body = response.json();
  assert.equal(body.error.code, "VALIDATION_ERROR");
  assert.match(body.error.message, /objective is required/);
});

test("returns the created work for a valid request", async () => {
  const now = new Date();
  const work: Work = {
    id: "work-1" as WorkId,
    organizationId: "org-1" as OrganizationId,
    requesterId: "user-1" as Work["requesterId"],
    objective: "Ship the thing.",
    status: "queued",
    priority: "normal",
    createdAt: now,
    updatedAt: now,
    metadata: {},
  };
  const applicationService = {
    createWork: async () => work,
  } as unknown as ApiServices["applicationService"];
  const app = buildApiServer(baseServices({
    applicationService,
    developmentOrganizationId: "org-1" as OrganizationId,
  }));

  const response = await app.inject({
    method: "POST",
    url: "/work",
    payload: { objective: "Ship the thing." },
  });

  assert.equal(response.statusCode, 201);
  const body = response.json();
  assert.equal(body.work.id, "work-1");
});
