import assert from "node:assert/strict";
import test from "node:test";

import type { OrganizationId, Work, WorkId } from "@unioffice/core";

import type { CreateWorkInput } from "./application.js";
import { AgentValidationError } from "./agent-directory-service.js";
import { buildApiServer, type ApiServices } from "./server.js";
import {
  WorkspaceNotFoundError,
  WorkspaceValidationError,
} from "./workspace-service.js";
import type { WorkQueryService } from "./work-query-service.js";

function baseServices(overrides: Partial<ApiServices> = {}): ApiServices {
  return {
    applicationService: {} as ApiServices["applicationService"],
    workService: {} as ApiServices["workService"],
    workExecutionService: {} as ApiServices["workExecutionService"],
    workApprovalService: {} as ApiServices["workApprovalService"],
    workQueryService: {} as ApiServices["workQueryService"],
    companyBrainService: {} as ApiServices["companyBrainService"],
    companyOverviewService: {} as ApiServices["companyOverviewService"],
    workspaceService: {} as ApiServices["workspaceService"],
    agentDirectoryService: {} as ApiServices["agentDirectoryService"],
    workRecoveryService: {} as ApiServices["workRecoveryService"],
    executionQueueService: {} as ApiServices["executionQueueService"],
    toolRegistry: {} as ApiServices["toolRegistry"],
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

test("rate limits a client that exceeds the request budget", async () => {
  const app = buildApiServer(baseServices());
  await app.ready();

  let lastResponse;
  for (let i = 0; i < 121; i += 1) {
    lastResponse = await app.inject({ method: "GET", url: "/health" });
  }

  assert.equal(lastResponse!.statusCode, 429);
  const body = lastResponse!.json();
  assert.equal(body.error.code, "RATE_LIMITED");
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

test("stores a mission briefing on the work it creates", async () => {
  const now = new Date();
  let received: CreateWorkInput | undefined;
  const applicationService = {
    createWork: async (input: CreateWorkInput) => {
      received = input;

      return {
        id: "work-2" as WorkId,
        organizationId: "org-1" as OrganizationId,
        requesterId: "user-1" as Work["requesterId"],
        objective: input.objective,
        status: "queued",
        priority: "normal",
        createdAt: now,
        updatedAt: now,
        metadata: input.metadata ?? {},
      } satisfies Work;
    },
  } as unknown as ApiServices["applicationService"];
  const app = buildApiServer(baseServices({
    applicationService,
    developmentOrganizationId: "org-1" as OrganizationId,
  }));

  const response = await app.inject({
    method: "POST",
    url: "/work",
    payload: {
      objective: "Plan the launch.",
      briefing: "  Budget is capped at 40k and legal must see the copy.  ",
    },
  });

  assert.equal(response.statusCode, 201);
  assert.equal(
    received?.metadata?.briefing,
    "Budget is capped at 40k and legal must see the copy.",
  );
});

test("rejects a briefing too long to put in front of the planner", async () => {
  const app = buildApiServer(baseServices({
    developmentOrganizationId: "org-1" as OrganizationId,
  }));

  const response = await app.inject({
    method: "POST",
    url: "/work",
    payload: { objective: "Plan the launch.", briefing: "x".repeat(4_001) },
  });

  assert.equal(response.statusCode, 400);
  assert.match(response.json().error.message, /4000 characters/);
});

test("treats a blank briefing as no briefing at all", async () => {
  const now = new Date();
  let received: CreateWorkInput | undefined;
  const applicationService = {
    createWork: async (input: CreateWorkInput) => {
      received = input;

      return {
        id: "work-3" as WorkId,
        organizationId: "org-1" as OrganizationId,
        requesterId: "user-1" as Work["requesterId"],
        objective: input.objective,
        status: "queued",
        priority: "normal",
        createdAt: now,
        updatedAt: now,
        metadata: input.metadata ?? {},
      } satisfies Work;
    },
  } as unknown as ApiServices["applicationService"];
  const app = buildApiServer(baseServices({
    applicationService,
    developmentOrganizationId: "org-1" as OrganizationId,
  }));

  const response = await app.inject({
    method: "POST",
    url: "/work",
    payload: { objective: "Plan the launch.", briefing: "   " },
  });

  assert.equal(response.statusCode, 201);
  assert.equal(received?.metadata, undefined);
});

test("creating a workspace returns it and reports validation failures plainly", async () => {
  const now = new Date();
  const workspaceService = {
    createWorkspace: async (input: { name: string }) => {
      if (input.name === "  ") {
        throw new WorkspaceValidationError("A workspace needs a name.");
      }

      return {
        id: "workspace-1",
        organizationId: "org-1",
        name: input.name,
        slug: "engineering",
        status: "active",
        createdAt: now,
        updatedAt: now,
        metadata: {},
      };
    },
  } as unknown as ApiServices["workspaceService"];
  const app = buildApiServer(baseServices({
    workspaceService,
    developmentOrganizationId: "org-1" as OrganizationId,
  }));

  const created = await app.inject({
    method: "POST",
    url: "/workspaces",
    payload: { name: "Engineering" },
  });

  assert.equal(created.statusCode, 201);
  assert.equal(created.json().workspace.name, "Engineering");

  const rejected = await app.inject({
    method: "POST",
    url: "/workspaces",
    payload: { name: "" },
  });

  assert.equal(rejected.statusCode, 400);
  assert.match(rejected.json().error.message, /name is required/);
});

test("a workspace from another organization is not found rather than forbidden", async () => {
  const workspaceService = {
    getWorkspaceDetail: async () => {
      throw new WorkspaceNotFoundError("Workspace not found: workspace-9");
    },
  } as unknown as ApiServices["workspaceService"];
  const app = buildApiServer(baseServices({
    workspaceService,
    developmentOrganizationId: "org-1" as OrganizationId,
  }));

  const response = await app.inject({
    method: "GET",
    url: "/workspaces/33333333-3333-3333-3333-333333333333",
  });

  assert.equal(response.statusCode, 404);
  assert.equal(response.json().error.code, "NOT_FOUND");
});

test("rejects an agent type the domain model does not have", async () => {
  const app = buildApiServer(baseServices({
    developmentOrganizationId: "org-1" as OrganizationId,
  }));

  const response = await app.inject({
    method: "POST",
    url: "/agents",
    payload: {
      name: "Dana",
      description: "Does things.",
      type: "wizard",
      capabilities: ["research"],
      toolIds: [],
    },
  });

  assert.equal(response.statusCode, 400);
  assert.match(response.json().error.message, /specialist, manager or orchestrator/);
});

test("surfaces an unknown tool grant as a client error, not a server one", async () => {
  const agentDirectoryService = {
    createAgent: async () => {
      throw new AgentValidationError("No such tool: telepathy");
    },
  } as unknown as ApiServices["agentDirectoryService"];
  const app = buildApiServer(baseServices({
    agentDirectoryService,
    developmentOrganizationId: "org-1" as OrganizationId,
  }));

  const response = await app.inject({
    method: "POST",
    url: "/agents",
    payload: {
      name: "Dana",
      description: "Does things.",
      type: "specialist",
      capabilities: ["research"],
      toolIds: ["telepathy"],
    },
  });

  assert.equal(response.statusCode, 400);
  assert.match(response.json().error.message, /No such tool: telepathy/);
});

test("clearing an agent's workspace is passed through as null, not dropped", async () => {
  let received: { workspaceId?: unknown } | undefined;
  const agentDirectoryService = {
    updateAgent: async (input: { workspaceId?: unknown }) => {
      received = input;
      return { id: "agent-1", name: "Dana" };
    },
  } as unknown as ApiServices["agentDirectoryService"];
  const app = buildApiServer(baseServices({
    agentDirectoryService,
    developmentOrganizationId: "org-1" as OrganizationId,
  }));

  const response = await app.inject({
    method: "POST",
    url: "/agents/44444444-4444-4444-4444-444444444444",
    payload: { workspaceId: null },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(received?.workspaceId, null);
});

test("names the field that was left blank, not just that it was blank", async () => {
  const app = buildApiServer(baseServices({
    developmentOrganizationId: "org-1" as OrganizationId,
  }));

  const response = await app.inject({
    method: "POST",
    url: "/work",
    payload: { objective: "   " },
  });

  assert.equal(response.statusCode, 400);
  assert.match(response.json().error.message, /objective is required/);
});
