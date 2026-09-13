import assert from "node:assert/strict";
import test from "node:test";

import type { Event, OrganizationId } from "@unioffice/core";
import type { EventRepository } from "@unioffice/database";

import { EventRecorder, normalizeActor } from "./event-recorder.js";

const organizationId = "2f6b579a-f0f8-45a5-868a-21c08bde1314" as OrganizationId;
const uuid = "1db667b1-3bd4-4d64-a7e4-dd5a5f2f4b09";

/**
 * A repository that enforces what the real events table enforces: actor_id is
 * a uuid or null. The in-memory fakes elsewhere accept any string, which is
 * exactly how a typed "user:<uuid>" actor reached production and failed there.
 */
function strictRepository(events: Event[]): EventRepository {
  return {
    async create(event) {
      if (event.actorId !== undefined && !/^[0-9a-f-]{36}$/i.test(event.actorId)) {
        throw new Error(`invalid input syntax for type uuid: "${event.actorId}"`);
      }
      events.push(event);
      return event;
    },
    async findByWork() { return events; },
    async findByOrganization() { return events; },
  };
}

test("a bare uuid actor is stored as-is", () => {
  assert.deepEqual(normalizeActor(uuid), { id: uuid });
});

test("a typed actor stores its uuid in the column and keeps the label", () => {
  assert.deepEqual(normalizeActor(`user:${uuid}`), { id: uuid, label: `user:${uuid}` });
  assert.deepEqual(normalizeActor(`agent:${uuid}`), { id: uuid, label: `agent:${uuid}` });
});

test("an actor with no uuid in it is kept only as a bounded label", () => {
  assert.deepEqual(normalizeActor("system:verification"), { label: "system:verification" });
  assert.equal(normalizeActor("x".repeat(500)).label?.length, 200);
  assert.deepEqual(normalizeActor(undefined), {});
});

test("recording with typed actors succeeds against a uuid-typed actor column", async () => {
  const events: Event[] = [];
  const recorder = new EventRecorder(strictRepository(events));

  await recorder.record({ organizationId, type: "knowledge.created", actorType: "agent", actorId: `agent:${uuid}` });
  await recorder.record({ organizationId, type: "knowledge.approved", actorType: "user", actorId: `user:${uuid}` });
  await recorder.record({ organizationId, type: "knowledge.archived", actorType: "user", actorId: "e2e-reviewer" });

  assert.equal(events.length, 3);
  assert.equal(events[0]!.actorId, uuid);
  assert.equal(events[0]!.metadata.actor, `agent:${uuid}`);
  assert.equal(events[2]!.actorId, undefined);
  assert.equal(events[2]!.metadata.actor, "e2e-reviewer");
});
