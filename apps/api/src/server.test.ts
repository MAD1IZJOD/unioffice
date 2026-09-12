import assert from "node:assert/strict";
import { request as httpRequest } from "node:http";
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
    attentionService: {} as ApiServices["attentionService"],
    governanceService: {} as ApiServices["governanceService"],
    governanceOverviewService: {} as ApiServices["governanceOverviewService"],
    executionRoomService: {} as ApiServices["executionRoomService"],
    executionStream: {} as ApiServices["executionStream"],
    toolRegistry: {} as ApiServices["toolRegistry"],
    healthCheck: async () => ({}),
    corsOrigins: ["http://localhost:5173"],
    ...overrides,
  };
}

test("returns a generic message for an unmapped internal error, never the raw error", async () => {
  const workQueryService = {
    assertWorkInOrganization: async () => {
      throw new Error("Sensitive internal detail: password=hunter2 host=db.internal");
    },
  } as unknown as WorkQueryService;
  const app = buildApiServer(baseServices({
    workQueryService,
    developmentOrganizationId: "org-1" as OrganizationId,
  }));

  const response = await app.inject({
    method: "GET",
    url: "/work/11111111-1111-1111-1111-111111111111?organizationId=org-1",
  });

  assert.equal(response.statusCode, 500);
  const body = response.json();
  assert.equal(body.error.code, "INTERNAL_ERROR");
  assert.equal(body.error.message, "An internal error occurred.");
  assert.doesNotMatch(JSON.stringify(body), /hunter2/);
});

test("still returns the specific message for an intentional not-found error", async () => {
  const workQueryService = {
    assertWorkInOrganization: async (id: WorkId) => {
      throw new Error(`Work not found: ${id}`);
    },
  } as unknown as WorkQueryService;
  const app = buildApiServer(baseServices({
    workQueryService,
    developmentOrganizationId: "org-1" as OrganizationId,
  }));

  const response = await app.inject({
    method: "GET",
    url: "/work/22222222-2222-2222-2222-222222222222?organizationId=org-1",
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

/* --------------------------------------------------------------------------
   The live channel.

   Exercised against a real listening socket rather than through inject: the
   route hands the connection to Node once it hijacks the reply, and a test
   that never opened a socket would not be testing the thing that does the
   work.
   -------------------------------------------------------------------------- */

/** Reads server-sent frames off a live response until `wanted` have arrived. */
async function readFrames(
  response: Response,
  wanted: number,
  timeoutMs = 4_000,
): Promise<string[]> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  const frames: string[] = [];
  const deadline = Date.now() + timeoutMs;

  let buffer = "";

  try {
    while (frames.length < wanted && Date.now() < deadline) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      let boundary = buffer.indexOf("\n\n");

      while (boundary !== -1) {
        frames.push(buffer.slice(0, boundary));
        buffer = buffer.slice(boundary + 2);
        boundary = buffer.indexOf("\n\n");
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
  }

  return frames;
}

test("the live channel opens and carries events through as frames", async () => {
  const listeners = new Set<(events: unknown[]) => void>();

  const executionStream = {
    subscribe: (_organizationId: OrganizationId, listener: (events: unknown[]) => void) => {
      listeners.add(listener);
      return { close: () => listeners.delete(listener) };
    },
  } as unknown as ApiServices["executionStream"];

  const app = buildApiServer(baseServices({
    executionStream,
    developmentOrganizationId: "org-1" as OrganizationId,
  }));

  const address = await app.listen({ port: 0, host: "127.0.0.1" });

  try {
    const response = await fetch(`${address}/stream`);

    assert.equal(response.status, 200);
    assert.match(
      response.headers.get("content-type") ?? "",
      /text\/event-stream/,
    );

    // The subscription is live before anything is pushed through it.
    await waitFor(() => listeners.size === 1);

    listeners.forEach((listener) =>
      listener([
        {
          id: "e1",
          organizationId: "org-1",
          workId: "w1",
          actorType: "system",
          type: "task.started",
          timestamp: new Date("2026-01-01T00:00:00.000Z"),
          payload: { title: "Research the market" },
          metadata: {},
        },
      ]),
    );

    const frames = await readFrames(response, 2);

    assert.match(frames[0] ?? "", /^event: open/);
    assert.match(frames[1] ?? "", /^event: activity/);

    const activity = JSON.parse(
      (frames[1] ?? "").split("\n")[1]!.replace("data: ", ""),
    );

    assert.equal(activity.events[0].id, "e1");
    assert.equal(activity.events[0].type, "task.started");
    assert.equal(activity.events[0].payload.title, "Research the market");
  } finally {
    await app.close();
  }
});

test("a client that goes away takes its subscription with it", async () => {
  let closed = 0;
  const listeners = new Set<(events: unknown[]) => void>();

  const executionStream = {
    subscribe: (_organizationId: OrganizationId, listener: (events: unknown[]) => void) => {
      listeners.add(listener);

      return {
        close: () => {
          listeners.delete(listener);
          closed += 1;
        },
      };
    },
  } as unknown as ApiServices["executionStream"];

  const app = buildApiServer(baseServices({
    executionStream,
    developmentOrganizationId: "org-1" as OrganizationId,
  }));

  await app.listen({ port: 0, host: "127.0.0.1" });
  const port = (app.server.address() as { port: number }).port;

  try {
    // A raw socket rather than fetch: undici pools connections and can hold
    // one open after the response body is released, so a test driven through
    // fetch would be asserting the pool's behaviour, not the server's.
    const request = httpGet({ host: "127.0.0.1", port, path: "/stream" });

    await waitFor(() => listeners.size === 1);

    request.destroy();

    await waitFor(() => closed === 1);
    assert.equal(listeners.size, 0);
  } finally {
    await app.close();
  }
});

test("the live channel sends only the mission that was asked for", async () => {
  const listeners = new Set<(events: unknown[]) => void>();

  const executionStream = {
    subscribe: (_organizationId: OrganizationId, listener: (events: unknown[]) => void) => {
      listeners.add(listener);
      return { close: () => listeners.delete(listener) };
    },
  } as unknown as ApiServices["executionStream"];

  const app = buildApiServer(baseServices({
    executionStream,
    developmentOrganizationId: "org-1" as OrganizationId,
  }));

  const address = await app.listen({ port: 0, host: "127.0.0.1" });

  try {
    const response = await fetch(`${address}/stream?workId=mine`);
    await waitFor(() => listeners.size === 1);

    const event = (id: string, workId: string) => ({
      id,
      organizationId: "org-1",
      workId,
      actorType: "system",
      type: "task.started",
      timestamp: new Date(),
      payload: {},
      metadata: {},
    });

    listeners.forEach((listener) =>
      listener([event("theirs", "other"), event("ours", "mine")]),
    );

    const frames = await readFrames(response, 2);
    const activity = JSON.parse(
      (frames[1] ?? "").split("\n")[1]!.replace("data: ", ""),
    );

    assert.deepEqual(
      activity.events.map((entry: { id: string }) => entry.id),
      ["ours"],
    );
  } finally {
    await app.close();
  }
});

test("an oversized payload is dropped rather than pushed to every open tab", async () => {
  const listeners = new Set<(events: unknown[]) => void>();

  const executionStream = {
    subscribe: (_organizationId: OrganizationId, listener: (events: unknown[]) => void) => {
      listeners.add(listener);
      return { close: () => listeners.delete(listener) };
    },
  } as unknown as ApiServices["executionStream"];

  const app = buildApiServer(baseServices({
    executionStream,
    developmentOrganizationId: "org-1" as OrganizationId,
  }));

  const address = await app.listen({ port: 0, host: "127.0.0.1" });

  try {
    const response = await fetch(`${address}/stream`);
    await waitFor(() => listeners.size === 1);

    listeners.forEach((listener) =>
      listener([
        {
          id: "big",
          organizationId: "org-1",
          actorType: "agent",
          type: "tool.completed",
          timestamp: new Date(),
          payload: { output: "x".repeat(5_000) },
          metadata: {},
        },
      ]),
    );

    const frames = await readFrames(response, 2);
    const activity = JSON.parse(
      (frames[1] ?? "").split("\n")[1]!.replace("data: ", ""),
    );

    assert.deepEqual(activity.events[0].payload, { truncated: true });
  } finally {
    await app.close();
  }
});

function httpGet(options: {
  host: string;
  port: number;
  path: string;
}): ReturnType<typeof httpRequest> {
  const request = httpRequest({ ...options, method: "GET" });

  request.on("error", () => {
    // Destroying the request mid-stream is the point of the test; the error
    // it raises on this side is expected and carries no information.
  });

  request.end();

  return request;
}

async function waitFor(
  condition: () => boolean,
  timeoutMs = 3_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  throw new Error("Condition was never met.");
}

/* --------------------------------------------------------------------------
   Tenant isolation.

   With no authentication the API is bound to a single organization. These
   assert that a request naming a different one, or reaching for another
   tenant's work by id, is refused rather than served.
   -------------------------------------------------------------------------- */

test("refuses a request that names a different organization", async () => {
  let workListed = false;
  const workQueryService = {
    listWork: async () => {
      workListed = true;
      return [];
    },
  } as unknown as WorkQueryService;

  const app = buildApiServer(baseServices({
    workQueryService,
    developmentOrganizationId: "org-1" as OrganizationId,
  }));

  const response = await app.inject({
    method: "GET",
    url: "/work?organizationId=org-2-someone-elses",
  });

  assert.equal(response.statusCode, 404);
  assert.equal(response.json().error.message, "Organization not found.");
  assert.equal(workListed, false, "the query must never run for a foreign org");
});

test("serves a request that names the bound organization", async () => {
  const workQueryService = {
    listWork: async () => [],
  } as unknown as WorkQueryService;

  const app = buildApiServer(baseServices({
    workQueryService,
    developmentOrganizationId: "org-1" as OrganizationId,
  }));

  const response = await app.inject({
    method: "GET",
    url: "/work?organizationId=org-1",
  });

  assert.equal(response.statusCode, 200);
});

test("a work item in another organization is not reachable by id", async () => {
  let assertedOrg: string | undefined;
  const workQueryService = {
    assertWorkInOrganization: async (_id: unknown, organizationId: string) => {
      assertedOrg = organizationId;
      // The real method throws not-found when the work's org differs; the
      // route must call it with the bound org, never a caller override.
      throw new Error(`Work not found: ${_id}`);
    },
  } as unknown as WorkQueryService;

  const app = buildApiServer(baseServices({
    workQueryService,
    developmentOrganizationId: "org-1" as OrganizationId,
  }));

  const response = await app.inject({
    method: "GET",
    url: "/work/33333333-3333-3333-3333-333333333333?organizationId=org-2-someone-elses",
  });

  // The foreign org override is rejected before the work is even looked up.
  assert.equal(response.statusCode, 404);
  assert.equal(assertedOrg, undefined);
});

test("rejects a malformed work id before it reaches a query", async () => {
  let touched = false;
  const workQueryService = {
    assertWorkInOrganization: async () => {
      touched = true;
      return {} as never;
    },
  } as unknown as WorkQueryService;

  const app = buildApiServer(baseServices({
    workQueryService,
    developmentOrganizationId: "org-1" as OrganizationId,
  }));

  const response = await app.inject({
    method: "GET",
    url: "/work/not-a-uuid?organizationId=org-1",
  });

  assert.equal(response.statusCode, 400);
  assert.equal(touched, false);
});

test("drops a caller-supplied work metadata object, keeping only the briefing", async () => {
  let created: CreateWorkInput | undefined;
  const applicationService = {
    createWork: async (input: CreateWorkInput) => {
      created = input;
      return { id: "w1", metadata: input.metadata ?? {} } as never;
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
      organizationId: "org-1",
      objective: "do the thing",
      briefing: "some context",
      metadata: { interrupted: true, injected: "PWNED" },
    },
  });

  assert.equal(response.statusCode, 201);
  assert.deepEqual(created?.metadata, { briefing: "some context" });
});
