import assert from "node:assert/strict";
import test from "node:test";

import type {
  OrganizationId,
  OrganizationRole,
  UserId,
  Work,
  WorkId,
  WorkspaceAccessLevel,
  WorkspaceId,
} from "@unioffice/core";

import { InMemoryContinuousMissionRepository } from "@unioffice/database";

import { ContinuousMissionService } from "../continuous-mission-service.js";
import { EventRecorder } from "../event-recorder.js";
import { buildApiServer, type ApiServices } from "../server.js";

import { StreamTickets } from "./stream-tickets.js";
import { signedIn, TEST_TOKEN } from "./testing.js";

/**
 * Who may read, create and operate continuous missions, answered by the same
 * permission rules as missions: reading follows the workspace, creating is
 * starting missions there in your own name, and pausing, resuming,
 * cancelling and running one now are operating missions there.
 */

const orgA = "aaaaaaaa-0000-4000-8000-000000000001" as OrganizationId;
const orgB = "bbbbbbbb-0000-4000-8000-000000000002" as OrganizationId;
const finance = "f0000000-0000-4000-8000-00000000000f" as WorkspaceId;
const legal = "a0000000-0000-4000-8000-00000000000a" as WorkspaceId;
const userId = "22222222-0000-4000-8000-000000000002" as UserId;
const otherUser = "33333333-0000-4000-8000-000000000003" as UserId;

const weekly = { cadence: "weekly", dayOfWeek: 1, hour: 9, minute: 0, timezone: "Asia/Kolkata" };

function world() {
  const works = new Map<WorkId, Work>();
  const missions = new InMemoryContinuousMissionRepository({
    async create(work) { works.set(work.id, work); return work; },
    async findById(id) { return works.get(id) ?? null; },
  });
  const enqueued: WorkId[] = [];
  const events: unknown[] = [];

  const service = new ContinuousMissionService({
    missions,
    queue: { async enqueueWork(workId) { enqueued.push(workId); } },
    reads: { async findEventsByTypes() { return []; } },
    eventRecorder: new EventRecorder({
      async create(event) { events.push(event); return event; },
      async findByWork() { return []; },
      async findByOrganization() { return []; },
    }),
  });

  return { service, missions, works, enqueued, events };
}

function server(
  shared: ReturnType<typeof world>,
  role: OrganizationRole,
  workspaces: Record<string, WorkspaceAccessLevel> = {},
  options: { organizationId?: OrganizationId; user?: UserId } = {},
) {
  const services = {
    ...signedIn({ organizationId: options.organizationId ?? orgA, role, userId: options.user ?? userId, workspaces }),
    streamTickets: new StreamTickets(),
    continuousMissionService: shared.service,
    workspaceService: {
      async getWorkspace(organizationId: OrganizationId, id: WorkspaceId) {
        if (organizationId !== orgA || (id !== finance && id !== legal)) {
          const error = new Error("Workspace not found.") as Error & { statusCode: number };
          error.statusCode = 404;
          throw error;
        }
        return { id, organizationId };
      },
    },
    healthCheck: async () => ({}),
    corsOrigins: [],
  } as unknown as ApiServices;

  const app = buildApiServer(services);
  const headers = { authorization: `Bearer ${TEST_TOKEN}` };

  return {
    get: (url: string) => app.inject({ method: "GET", url, headers }),
    post: (url: string, payload: Record<string, unknown> = {}) => app.inject({ method: "POST", url, headers, payload }),
  };
}

async function seeded(workspaceId?: WorkspaceId) {
  const shared = world();
  const owner = server(shared, "owner");
  const created = await owner.post("/continuous-missions", {
    name: workspaceId ? "Finance close watch" : "Competitor pricing watch",
    objective: "Check competitor pricing and say if anything material changed.",
    schedule: weekly,
    ...(workspaceId ? { workspaceId } : {}),
  });

  assert.equal(created.statusCode, 201, created.body);
  return { shared, id: created.json().mission.id as string };
}

test("a continuous mission runs in the creator's name, whatever the body says", async () => {
  const shared = world();
  const response = await server(shared, "member").post("/continuous-missions", {
    name: "Pricing watch",
    objective: "Check competitor pricing weekly.",
    schedule: weekly,
    ownerId: otherUser,
    createdBy: `user:${otherUser}`,
  });

  assert.equal(response.statusCode, 201);
  const [stored] = await shared.missions.findByOrganization(orgA);
  assert.equal(stored!.ownerId, userId);
  assert.equal(stored!.createdBy, `user:${userId}`);
});

test("viewers cannot create, pause, resume, cancel or run one", async () => {
  const { shared, id } = await seeded();
  const viewer = server(shared, "viewer");

  assert.equal((await viewer.post("/continuous-missions", { name: "x", objective: "Do the thing.", schedule: weekly })).statusCode, 403);

  for (const action of ["pause", "resume", "cancel", "run"]) {
    assert.equal((await viewer.post(`/continuous-missions/${id}/${action}`)).statusCode, 403, action);
  }

  assert.equal((await shared.missions.findById(id as never))!.status, "active");
  assert.deepEqual(shared.enqueued, []);
});

test("viewers can read them; members operate them", async () => {
  const { shared, id } = await seeded();

  const viewer = server(shared, "viewer");
  assert.equal((await viewer.get("/continuous-missions")).json().missions.length, 1);
  assert.equal((await viewer.get(`/continuous-missions/${id}`)).statusCode, 200);

  const member = server(shared, "member");
  assert.equal((await member.post(`/continuous-missions/${id}/pause`)).json().mission.status, "paused");
  assert.equal((await member.post(`/continuous-missions/${id}/pause`)).statusCode, 409);
  assert.equal((await member.post(`/continuous-missions/${id}/resume`)).json().mission.status, "active");

  const run = await member.post(`/continuous-missions/${id}/run`);
  assert.equal(run.statusCode, 201);
  assert.equal(run.json().run.sequence, 1);
  assert.equal(shared.enqueued.length, 1);
  assert.equal((await member.post(`/continuous-missions/${id}/run`)).statusCode, 409, "one run at a time");

  assert.equal((await member.post(`/continuous-missions/${id}/cancel`)).json().mission.status, "cancelled");
  assert.equal((await member.post(`/continuous-missions/${id}/resume`)).statusCode, 409);
});

test("a workspace's missions follow its grants: unreachable reads as not found, a viewer grant cannot operate", async () => {
  const { shared, id } = await seeded(finance);

  const outsider = server(shared, "member", { [legal]: "member" });
  assert.equal((await outsider.get("/continuous-missions")).json().missions.length, 0);
  assert.equal((await outsider.get(`/continuous-missions/${id}`)).statusCode, 404);
  assert.equal((await outsider.post(`/continuous-missions/${id}/pause`)).statusCode, 404);

  const watcher = server(shared, "member", { [finance]: "viewer" });
  assert.equal((await watcher.get(`/continuous-missions/${id}`)).statusCode, 200);
  assert.equal((await watcher.post(`/continuous-missions/${id}/pause`)).statusCode, 403);
  assert.equal(
    (await watcher.post("/continuous-missions", { name: "More", objective: "Watch finance.", schedule: weekly, workspaceId: finance })).statusCode,
    403,
  );

  const worker = server(shared, "member", { [finance]: "member" });
  assert.equal((await worker.post(`/continuous-missions/${id}/pause`)).statusCode, 200);
});

test("another organization's mission is not found, and a foreign workspace cannot be named", async () => {
  const { shared, id } = await seeded();
  const stranger = server(shared, "owner", {}, { organizationId: orgB });

  assert.equal((await stranger.get(`/continuous-missions/${id}`)).statusCode, 404);
  assert.equal((await stranger.post(`/continuous-missions/${id}/cancel`)).statusCode, 404);
  assert.equal((await stranger.get("/continuous-missions")).json().missions.length, 0);

  const member = server(shared, "member");
  const foreign = await member.post("/continuous-missions", {
    name: "Elsewhere",
    objective: "Watch another company.",
    schedule: weekly,
    workspaceId: "c0000000-0000-4000-8000-00000000000c",
  });
  assert.notEqual(foreign.statusCode, 201);
});

test("a schedule that is the wrong shape or cannot mean anything is a 400, and nothing is stored", async () => {
  const shared = world();
  const owner = server(shared, "owner");

  for (const schedule of [
    undefined,
    "every monday",
    { cadence: "fortnightly", minute: 0, timezone: "UTC" },
    { cadence: "daily", hour: "nine", minute: 0, timezone: "UTC" },
    { cadence: "daily", hour: 9, timezone: "UTC" },
    { cadence: "weekly", hour: 9, minute: 0, timezone: "UTC" },
    { cadence: "daily", hour: 9, minute: 0, timezone: "Nowhere/Special" },
  ]) {
    const response = await owner.post("/continuous-missions", { name: "Watch", objective: "Watch the market.", schedule });
    assert.equal(response.statusCode, 400, JSON.stringify(schedule));
  }

  assert.equal((await shared.missions.findByOrganization(orgA)).length, 0);
});

test("the reply holds no internal owner id, and a live name cannot be taken twice", async () => {
  const { shared } = await seeded();
  const owner = server(shared, "owner");

  const listed = (await owner.get("/continuous-missions")).json().missions[0];
  assert.equal(listed.ownerId, undefined);
  assert.equal(listed.ownedByYou, true);
  assert.equal(listed.cadence, "Every Monday at 09:00 (Asia/Kolkata)");

  const duplicate = await owner.post("/continuous-missions", {
    name: "competitor pricing watch",
    objective: "Same again.",
    schedule: weekly,
  });
  assert.equal(duplicate.statusCode, 409);
});

test("a malformed id is a clean 400", async () => {
  const { shared } = await seeded();

  assert.equal((await server(shared, "owner").get("/continuous-missions/not-a-uuid")).statusCode, 400);
});
