import assert from "node:assert/strict";
import test from "node:test";

import type {
  Event,
  EventId,
  OrganizationId,
} from "@unioffice/core";

import type { EventTailRepository } from "@unioffice/database";

import { ExecutionStream } from "./execution-stream.js";

const organizationId = "org-1" as OrganizationId;
const otherOrganizationId = "org-2" as OrganizationId;

function makeEvent(
  id: string,
  timestamp: Date,
  overrides: Partial<Event> = {},
): Event {
  return {
    id: id as EventId,
    organizationId,
    actorType: "system",
    type: "task.started",
    timestamp,
    payload: {},
    metadata: {},
    ...overrides,
  };
}

/**
 * A log that can be appended to between reads, which is the only behaviour the
 * tail actually depends on.
 */
class FakeLog implements EventTailRepository {
  readonly calls: Array<{ organizationId: OrganizationId; since: Date }> = [];
  private events: Event[] = [];
  private failure?: Error;

  append(...events: Event[]): void {
    this.events.push(...events);
  }

  failNext(error: Error): void {
    this.failure = error;
  }

  async findSince(
    org: OrganizationId,
    since: Date,
    limit = 200,
  ): Promise<Event[]> {
    this.calls.push({ organizationId: org, since });

    if (this.failure) {
      const error = this.failure;
      this.failure = undefined;
      throw error;
    }

    return this.events
      .filter(
        (event) =>
          event.organizationId === org &&
          event.timestamp.getTime() >= since.getTime(),
      )
      .sort((left, right) => left.timestamp.getTime() - right.timestamp.getTime())
      .slice(0, limit);
  }
}

test("delivers events written after a subscriber connected", async () => {
  const log = new FakeLog();
  const stream = new ExecutionStream(log, { tailIntervalMs: 60_000 });

  const received: Event[] = [];
  stream.subscribe(organizationId, (events) => received.push(...events));

  log.append(makeEvent("e1", new Date()));
  await stream.tick();

  assert.deepEqual(
    received.map((event) => event.id),
    ["e1"],
  );

  stream.stop();
});

test("never delivers the same event twice, even though reads overlap", async () => {
  const log = new FakeLog();
  const stream = new ExecutionStream(log, {
    tailIntervalMs: 60_000,
    lookbackMs: 30_000,
  });

  const received: Event[] = [];
  stream.subscribe(organizationId, (events) => received.push(...events));

  log.append(makeEvent("e1", new Date()));

  await stream.tick();
  await stream.tick();
  await stream.tick();

  assert.deepEqual(
    received.map((event) => event.id),
    ["e1"],
  );

  stream.stop();
});

test("still delivers an event a worker stamped slightly in the past", async () => {
  const log = new FakeLog();
  const stream = new ExecutionStream(log, {
    tailIntervalMs: 60_000,
    lookbackMs: 5_000,
  });

  const received: Event[] = [];
  stream.subscribe(organizationId, (events) => received.push(...events));

  // The API's clock is ahead, so this arrives already "old". Without the
  // lookback the cursor would have moved past it and it would be lost.
  log.append(makeEvent("late", new Date(Date.now() - 2_000)));
  await stream.tick();

  assert.deepEqual(
    received.map((event) => event.id),
    ["late"],
  );

  stream.stop();
});

test("keeps one reader per organization however many subscribers it has", async () => {
  const log = new FakeLog();
  const stream = new ExecutionStream(log, { tailIntervalMs: 60_000 });

  const first: Event[] = [];
  const second: Event[] = [];

  const a = stream.subscribe(organizationId, (events) => first.push(...events));
  const b = stream.subscribe(organizationId, (events) => second.push(...events));

  assert.equal(stream.watchedCount, 1);

  log.append(makeEvent("e1", new Date()));
  await stream.tick();

  assert.equal(log.calls.length, 1, "one read served both subscribers");
  assert.equal(first.length, 1);
  assert.equal(second.length, 1);

  a.close();
  b.close();
  stream.stop();
});

test("stops reading entirely once the last subscriber leaves", async () => {
  const log = new FakeLog();
  const stream = new ExecutionStream(log, { tailIntervalMs: 60_000 });

  const subscription = stream.subscribe(organizationId, () => {});
  assert.equal(stream.watchedCount, 1);

  subscription.close();
  assert.equal(stream.watchedCount, 0);

  const before = log.calls.length;
  await stream.tick();

  assert.equal(log.calls.length, before, "an unwatched company is not read");

  stream.stop();
});

test("closing one subscriber twice does not silence the other", async () => {
  const log = new FakeLog();
  const stream = new ExecutionStream(log, { tailIntervalMs: 60_000 });

  const received: Event[] = [];
  const first = stream.subscribe(organizationId, () => {});
  stream.subscribe(organizationId, (events) => received.push(...events));

  first.close();
  first.close();

  assert.equal(stream.watchedCount, 1);

  log.append(makeEvent("e1", new Date()));
  await stream.tick();

  assert.equal(received.length, 1);

  stream.stop();
});

test("never hands one company's events to another", async () => {
  const log = new FakeLog();
  const stream = new ExecutionStream(log, { tailIntervalMs: 60_000 });

  const received: Event[] = [];
  stream.subscribe(organizationId, (events) => received.push(...events));

  log.append(
    makeEvent("theirs", new Date(), { organizationId: otherOrganizationId }),
    makeEvent("ours", new Date()),
  );

  await stream.tick();

  assert.deepEqual(
    received.map((event) => event.id),
    ["ours"],
  );

  stream.stop();
});

test("a failed read loses nothing: the next one covers the same ground", async () => {
  const log = new FakeLog();
  const messages: string[] = [];
  const stream = new ExecutionStream(log, {
    tailIntervalMs: 60_000,
    log: (message) => messages.push(message),
  });

  const received: Event[] = [];
  stream.subscribe(organizationId, (events) => received.push(...events));

  log.append(makeEvent("e1", new Date()));
  log.failNext(new Error("the database said no"));

  await stream.tick();
  assert.equal(received.length, 0);
  assert.equal(messages.length, 1);

  await stream.tick();
  assert.deepEqual(
    received.map((event) => event.id),
    ["e1"],
  );

  stream.stop();
});

test("a subscriber that throws does not stop the others being told", async () => {
  const log = new FakeLog();
  const messages: string[] = [];
  const stream = new ExecutionStream(log, {
    tailIntervalMs: 60_000,
    log: (message) => messages.push(message),
  });

  const received: Event[] = [];
  stream.subscribe(organizationId, () => {
    throw new Error("this tab went away mid-write");
  });
  stream.subscribe(organizationId, (events) => received.push(...events));

  log.append(makeEvent("e1", new Date()));
  await stream.tick();

  assert.equal(received.length, 1);
  assert.equal(messages.length, 1);

  stream.stop();
});
