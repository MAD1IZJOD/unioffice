import assert from "node:assert/strict";
import test from "node:test";

import type { Event, OrganizationId, OrganizationRole, Work, WorkId, WorkspaceId } from "@unioffice/core";

import { buildApiServer, type ApiServices } from "../server.js";
import type { ListWorkOptions } from "../work-query-service.js";

import { StreamTickets } from "./stream-tickets.js";
import { signedIn, TEST_TOKEN } from "./testing.js";

const orgA = "aaaaaaaa-0000-4000-8000-000000000001" as OrganizationId;
const finance = "f0000000-0000-4000-8000-00000000000f" as WorkspaceId;
const companyWork = "c0000000-0000-4000-8000-000000000001" as WorkId;
const financeWork = "c0000000-0000-4000-8000-000000000002" as WorkId;

const works = [
  { id: companyWork, organizationId: orgA, objective: "Company-wide mission" },
  { id: financeWork, organizationId: orgA, workspaceId: finance, objective: "Finance mission" },
] as Work[];

function event(id: string, workId?: WorkId): Event {
  return { id, type: "work.started", organizationId: orgA, workId, actorType: "system", timestamp: new Date(), payload: {}, metadata: {} } as Event;
}

function server(role: OrganizationRole, overrides: Partial<ApiServices> = {}) {
  let indexReads = 0;

  const services = {
    ...signedIn({ organizationId: orgA, role }),
    streamTickets: new StreamTickets(),
    workQueryService: {
      async listWork(_org: OrganizationId, options: ListWorkOptions) {
        return works.filter((work) => !options.reach || options.reach(work.workspaceId));
      },
      async getOrganizationArtifacts() {
        return [{ id: "company-artifact", workId: companyWork }, { id: "finance-artifact", workId: financeWork }];
      },
      async getOrganizationActivity() {
        return [event("company-event", companyWork), event("finance-event", financeWork), event("organization-event")];
      },
      async workspaceIndex() {
        indexReads += 1;
        return new Map(works.map((work) => [work.id, work.workspaceId]));
      },
    },
    healthCheck: async () => ({}),
    corsOrigins: [],
    ...overrides,
  } as unknown as ApiServices;

  return { app: buildApiServer(services), indexReads: () => indexReads };
}

const bearer = { authorization: `Bearer ${TEST_TOKEN}` };

test("a member without a workspace grant sees company-wide missions, artifacts and activity only", async () => {
  const { app } = server("member");

  const list = (await app.inject({ method: "GET", url: "/work", headers: bearer })).json().work.map((work: Work) => work.id);
  const artifacts = (await app.inject({ method: "GET", url: "/artifacts", headers: bearer })).json().artifacts.map((artifact: { id: string }) => artifact.id);
  const activity = (await app.inject({ method: "GET", url: "/activity", headers: bearer })).json().events.map((entry: { id: string }) => entry.id);

  assert.deepEqual(list, [companyWork]);
  assert.deepEqual(artifacts, ["company-artifact"]);
  assert.deepEqual(activity, ["company-event", "organization-event"]);
});

test("an owner sees everything, without the extra read narrowing needs", async () => {
  const { app, indexReads } = server("owner");

  const list = (await app.inject({ method: "GET", url: "/work", headers: bearer })).json().work;
  const activity = (await app.inject({ method: "GET", url: "/activity", headers: bearer })).json().events;

  assert.equal(list.length, 2);
  assert.equal(activity.length, 3);
  assert.equal(indexReads(), 0);
});

test("the live channel sends a member only the activity of missions they reach", async () => {
  let deliver: ((events: Event[]) => void) | undefined;
  const { app } = server("member", {
    executionStream: {
      subscribe(_organizationId: OrganizationId, listener: (events: Event[]) => void) {
        deliver = listener;
        return { close() {} };
      },
    } as unknown as ApiServices["executionStream"],
  });
  const address = await app.listen({ port: 0, host: "127.0.0.1" });
  const controller = new AbortController();

  try {
    const response = await fetch(`${address}/stream`, { headers: bearer, signal: controller.signal });
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let text = "";

    while (!text.includes("event: open")) text += decoder.decode((await reader.read()).value);

    deliver!([event("company-event", companyWork), event("finance-event", financeWork)]);

    while (!text.includes("event: activity")) text += decoder.decode((await reader.read()).value);

    assert.match(text, /company-event/);
    assert.doesNotMatch(text, /finance-event/);
  } finally {
    controller.abort();
    await app.close();
  }
});
