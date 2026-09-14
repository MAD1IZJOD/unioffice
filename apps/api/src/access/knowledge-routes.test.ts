import assert from "node:assert/strict";
import test from "node:test";

import type { OrganizationId, OrganizationRole, UserId, WorkspaceAccessLevel, WorkspaceId } from "@unioffice/core";

import { KnowledgeNotFoundError } from "../company-brain-service.js";
import { buildApiServer, type ApiServices } from "../server.js";

import { StreamTickets } from "./stream-tickets.js";
import { signedIn, TEST_TOKEN } from "./testing.js";

const orgA = "aaaaaaaa-0000-4000-8000-000000000001" as OrganizationId;
const finance = "f0000000-0000-4000-8000-00000000000f" as WorkspaceId;
const userId = "22222222-0000-4000-8000-000000000002" as UserId;

const companyEntry = "d0000000-0000-4000-8000-000000000001";
const financeEntry = "d0000000-0000-4000-8000-000000000002";
const theirEntry = "d0000000-0000-4000-8000-000000000003";
const conflictId = "d1000000-0000-4000-8000-000000000001";
const artifactId = "d2000000-0000-4000-8000-000000000001";

const locations = new Map<string, WorkspaceId | undefined>([
  [companyEntry, undefined],
  [financeEntry, finance],
]);

function server(role: OrganizationRole, workspaces: Record<string, WorkspaceAccessLevel> = {}) {
  const calls: Array<{ call: string; args: unknown[] }> = [];
  const record = (call: string) => async (...args: unknown[]) => {
    calls.push({ call, args });
    return { id: "x", kept: {}, merged: {}, current: {}, replaced: {} };
  };

  const services = {
    ...signedIn({ organizationId: orgA, role, userId, workspaces }),
    streamTickets: new StreamTickets(),
    companyBrainService: {
      async locateKnowledge(_org: OrganizationId, id: string) {
        if (!locations.has(id)) throw new KnowledgeNotFoundError();
        return locations.get(id);
      },
      async locateConflict() { return [undefined, finance]; },
      search: record("search"),
      getOverview: record("getOverview"),
      getDetail: record("getDetail"),
      previewRecall: record("previewRecall"),
      createKnowledge: record("createKnowledge"),
      updateKnowledge: record("updateKnowledge"),
      approveKnowledge: record("approveKnowledge"),
      archiveKnowledge: record("archiveKnowledge"),
      restoreKnowledge: record("restoreKnowledge"),
      mergeKnowledge: record("mergeKnowledge"),
      supersedeKnowledge: record("supersedeKnowledge"),
      resolveConflict: record("resolveConflict"),
      deriveFromArtifact: record("deriveFromArtifact"),
    },
    healthCheck: async () => ({}),
    corsOrigins: [],
  } as unknown as ApiServices;

  const app = buildApiServer(services);
  const headers = { authorization: `Bearer ${TEST_TOKEN}` };
  const post = (url: string, payload: Record<string, unknown> = {}) => app.inject({ method: "POST", url, headers, payload });
  const get = (url: string) => app.inject({ method: "GET", url, headers });

  return { post, get, calls };
}

const entry = { title: "Refunds need a receipt", content: "Every refund needs the original receipt.", type: "policy" };

const curation = (post: ReturnType<typeof server>["post"]) => [
  () => post(`/knowledge/${companyEntry}`, { title: "Refunds always need a receipt" }),
  () => post(`/knowledge/${companyEntry}/approve`),
  () => post(`/knowledge/${companyEntry}/archive`, { reason: "Outdated." }),
  () => post(`/knowledge/${companyEntry}/restore`),
  () => post(`/knowledge/${companyEntry}/merge`, { intoId: financeEntry }),
  () => post(`/knowledge/${companyEntry}/supersede`, { replacesId: financeEntry }),
  () => post(`/knowledge/conflicts/${conflictId}/resolve`, { resolution: "both_hold" }),
];

test("a member's new knowledge waits for review; an admin's counts straight away; a viewer writes none", async () => {
  const member = server("member");
  const admin = server("admin");
  const viewer = server("viewer");

  assert.equal((await member.post("/knowledge", entry)).statusCode, 201);
  assert.equal((await admin.post("/knowledge", entry)).statusCode, 201);
  assert.equal((await viewer.post("/knowledge", entry)).statusCode, 403);

  assert.equal((member.calls[0]!.args[0] as { proposeOnly: boolean }).proposeOnly, true);
  assert.equal((admin.calls[0]!.args[0] as { proposeOnly: boolean }).proposeOnly, false);
  assert.deepEqual(viewer.calls, []);
});

test("members and viewers cannot approve, edit, archive, restore, merge, replace or settle knowledge", async () => {
  for (const role of ["member", "viewer"] as const) {
    const { post, calls } = server(role, { [finance]: "member" });

    for (const [index, change] of curation(post).entries()) {
      assert.equal((await change()).statusCode, 403, `${role}: change ${index}`);
    }

    assert.deepEqual(calls, [], role);
  }
});

test("an admin curates, across workspaces", async () => {
  const { post, calls } = server("admin");

  for (const [index, change] of curation(post).entries()) {
    const response = await change();
    assert.equal(response.statusCode, 200, `change ${index} gave ${response.statusCode}`);
  }

  assert.equal(calls.length, 7);
});

test("knowledge in a workspace the caller was not given does not exist for them", async () => {
  const { get, post, calls } = server("member");

  assert.equal((await get(`/knowledge/${financeEntry}`)).statusCode, 404);
  assert.equal((await get(`/knowledge?workspaceId=${finance}`)).statusCode, 404);
  assert.equal((await get(`/knowledge/recall-preview?query=refunds&workspaceId=${finance}`)).statusCode, 404);
  assert.equal((await post(`/knowledge/${companyEntry}/merge`, { intoId: financeEntry })).statusCode, 404);
  assert.equal((await post(`/knowledge/conflicts/${conflictId}/resolve`, { resolution: "dismiss" })).statusCode, 404);
  assert.equal((await get(`/knowledge/${companyEntry}`)).statusCode, 200);

  assert.deepEqual(calls.map((entry) => entry.call), ["getDetail"]);
});

test("another organization's knowledge is not found, even for an owner", async () => {
  const { get, post } = server("owner");

  assert.equal((await get(`/knowledge/${theirEntry}`)).statusCode, 404);
  assert.equal((await post(`/knowledge/${theirEntry}/approve`)).statusCode, 404);
});

test("reads are narrowed by the caller's reach, and owners get everything unnarrowed", async () => {
  const member = server("member");
  const owner = server("owner");

  await member.get("/knowledge");
  await member.get("/knowledge/overview");
  await owner.get("/knowledge");

  const [memberSearch, memberOverview] = member.calls;
  const reach = memberSearch!.args[2] as (workspaceId?: WorkspaceId) => boolean;

  assert.equal(typeof reach, "function");
  assert.equal(reach(undefined), true);
  assert.equal(reach(finance), false);
  assert.equal(typeof memberOverview!.args[1], "function");
  assert.equal(owner.calls[0]!.args[2], undefined);
});

test("learning from an artifact needs permission to propose, and is narrowed to the caller's reach", async () => {
  const viewer = server("viewer");
  const member = server("member");

  assert.equal((await viewer.post(`/artifacts/${artifactId}/knowledge`)).statusCode, 403);
  assert.equal((await member.post(`/artifacts/${artifactId}/knowledge`)).statusCode, 200);
  assert.equal(typeof member.calls[0]!.args[3], "function");
});
