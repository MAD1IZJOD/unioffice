import assert from "node:assert/strict";
import test from "node:test";

import type { ApiServices } from "./server.js";
import { buildTestServer, type TestServices } from "./access/testing.js";
import { missionControlFixture, orgA, orgB } from "./mission-control.fixture.js";

/**
 * Mission Control at the edge, over the real service and in-memory stores:
 * the organization binding, id validation, who is recorded as acting, the
 * error mapping, and that nothing the body says beyond the organization is
 * trusted.
 */

const developmentRequester = "1db667b1-3bd4-4d64-a7e4-dd5a5f2f4b09";

function serve(fixture: ReturnType<typeof missionControlFixture>) {
  return buildTestServer({
    missionControlService: fixture.service,
    developmentOrganizationId: orgA,
    corsOrigins: [],
    healthCheck: async () => ({}),
  } as unknown as ApiServices);
}

test("the control read answers for the bound organization and refuses any other", async () => {
  const f = missionControlFixture();
  f.work("Stalled test", { updatedAt: f.ago(120) });
  const app = serve(f);

  const ours = await app.inject({ method: "GET", url: `/mission-control?organizationId=${orgA}` });
  const theirs = await app.inject({ method: "GET", url: `/mission-control?organizationId=${orgB}` });

  assert.equal(ours.statusCode, 200);
  assert.equal(ours.json().summary.blocked, 1);
  assert.equal(ours.json().blocked[0].objective, "Stalled test");

  assert.equal(theirs.statusCode, 404);
  assert.equal(theirs.json().error.message, "Organization not found.");
});

test("the attention route is served from the same state", async () => {
  const f = missionControlFixture();
  f.work("Stalled test", { updatedAt: f.ago(120) });
  const app = serve(f);

  const response = await app.inject({ method: "GET", url: `/attention?organizationId=${orgA}&limit=5` });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json().items.map((item: { kind: string }) => item.kind), ["stalled"]);
  assert.equal(response.json().actionCount, 1);
});

test("marking as seen records the server's requester, whatever the body claims, and changes nothing else", async () => {
  const f = missionControlFixture();
  const stale = f.work("Stalled test", { updatedAt: f.ago(120) });
  const app = serve(f);

  const response = await app.inject({
    method: "POST",
    url: `/work/${stale.id}/acknowledge`,
    payload: {
      organizationId: orgA,
      by: "user:someone-else",
      status: "completed",
      metadata: { interrupted: true },
    },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().workId, stale.id);

  const row = f.works.find((entry) => entry.id === stale.id)!;
  assert.equal(row.status, "queued");
  assert.deepEqual(Object.keys(row.metadata), ["acknowledged"]);
  assert.equal((row.metadata.acknowledged as { by: string }).by, `user:${developmentRequester}`);
  assert.equal(f.events.at(-1)?.actorId, developmentRequester);
});

test("another organization's mission, a malformed id, and a mission that is still moving are each refused plainly", async () => {
  const f = missionControlFixture();
  const theirs = f.work("Theirs", { organizationId: orgB, status: "failed", completedAt: f.ago(10) });
  const deciding = f.work("Deciding", { status: "waiting_approval", updatedAt: f.ago(100) });
  const app = serve(f);

  const foreign = await app.inject({ method: "POST", url: `/work/${theirs.id}/acknowledge`, payload: { organizationId: orgA } });
  assert.equal(foreign.statusCode, 404);
  assert.equal(foreign.json().error.message, "Mission not found.");

  const asThem = await app.inject({ method: "POST", url: `/work/${theirs.id}/acknowledge`, payload: { organizationId: orgB } });
  assert.equal(asThem.statusCode, 404);

  const malformed = await app.inject({ method: "POST", url: "/work/not-a-mission/acknowledge", payload: { organizationId: orgA } });
  assert.equal(malformed.statusCode, 400);

  const waiting = await app.inject({ method: "POST", url: `/work/${deciding.id}/acknowledge`, payload: { organizationId: orgA } });
  assert.equal(waiting.statusCode, 409);
  assert.match(waiting.json().error.message, /Approve or reject the step instead/);

  assert.ok(f.works.every((entry) => entry.metadata.acknowledged === undefined));
});

test("a store failure is reported generically, never with its details", async () => {
  const app = buildTestServer({
    missionControlService: {
      getMissionControl: async () => {
        throw new Error("Failed to read mission summaries: connection to db.internal refused (password=hunter2)");
      },
    },
    developmentOrganizationId: orgA,
    corsOrigins: [],
    healthCheck: async () => ({}),
  } as unknown as ApiServices);

  const response = await app.inject({ method: "GET", url: `/mission-control?organizationId=${orgA}` });

  assert.equal(response.statusCode, 500);
  assert.equal(response.json().error.message, "An internal error occurred.");
  assert.doesNotMatch(response.body, /hunter2|db\.internal/);
});
