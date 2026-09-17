import assert from "node:assert/strict";
import test from "node:test";

import type { MemberId, OrganizationId, OrganizationRole, UserId } from "@unioffice/core";

import { InMemoryMembershipRepository, InMemorySkillRepository } from "@unioffice/database";
import { createDefaultToolRegistry } from "@unioffice/tools";

import { buildApiServer, type ApiServices } from "../server.js";
import { SkillService } from "../skills/skill-service.js";

import { AccessResolver } from "./access-resolver.js";
import type { Identity } from "./authenticator.js";
import { StreamTickets } from "./stream-tickets.js";

const orgA = "aaaaaaaa-0000-4000-8000-000000000001" as OrganizationId;
const orgB = "bbbbbbbb-0000-4000-8000-000000000002" as OrganizationId;
const now = new Date("2026-09-17T12:00:00.000Z");

/** Skills over HTTP with the real membership resolver and the real skill service. */
async function company() {
  const members = new InMemoryMembershipRepository();
  const identities = new Map<string, Identity>();
  let counter = 0;

  async function person(name: string, role: OrganizationRole, organizationId = orgA) {
    counter += 1;
    const suffix = String(counter).padStart(12, "0");
    const identity: Identity = { userId: `11111111-0000-4000-8000-${suffix}` as UserId, email: `${name}@example.test`, emailConfirmed: true };
    await members.createMember({
      id: `00000000-0000-4000-8000-${suffix}` as MemberId,
      organizationId,
      userId: identity.userId,
      email: identity.email,
      role,
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    identities.set(`token-${name}`, identity);
  }

  await person("owner", "owner");
  await person("member", "member");
  await person("viewer", "viewer");
  await person("outsider", "owner", orgB);

  const skillService = new SkillService({
    skills: new InMemorySkillRepository(),
    agents: { async findByOrganization() { return []; } },
    workspaces: { async findById() { return null; }, async findByOrganization() { return []; } },
    tools: createDefaultToolRegistry(),
    eventRecorder: { async record(event) { return event as never; } },
  });

  const app = buildApiServer({
    authenticator: { verify: async (token: string) => identities.get(token) ?? null },
    accessResolver: new AccessResolver(members),
    streamTickets: new StreamTickets(),
    skillService,
    healthCheck: async () => ({}),
    corsOrigins: [],
  } as unknown as ApiServices);

  const request = (method: "GET" | "POST", name: string | null, url: string, payload?: Record<string, unknown>) =>
    app.inject({ method, url, headers: name ? { authorization: `Bearer token-${name}` } : {}, ...(payload ? { payload } : {}) });

  return { request };
}

const draft = {
  slug: "expense-review",
  name: "Expense review",
  description: "Find unusual spending.",
  category: "finance",
  instructions: "Compare each line with the calculator.",
  inputs: [],
  outputs: [],
  requiredTools: ["calculator"],
  requiredCapabilities: ["financial_analysis"],
  approval: "none",
  memory: "recall",
};

test("the catalogue needs a session and a membership", async () => {
  const { request } = await company();

  assert.equal((await request("GET", null, "/skills")).statusCode, 401);
  const listed = await request("GET", "viewer", "/skills");
  assert.equal(listed.statusCode, 200);
  assert.ok(listed.json().skills.some((skill: { slug: string }) => skill.slug === "code-review"));
  assert.equal((await request("GET", "viewer", "/skills/system:code-review")).statusCode, 200);
  assert.equal((await request("GET", "outsider", `/skills?organizationId=${orgA}`)).statusCode, 404);
});

test("only owners and admins write skills, and system skills cannot be changed", async () => {
  const { request } = await company();

  assert.equal((await request("POST", "member", "/skills", draft)).statusCode, 403);
  assert.equal((await request("POST", "viewer", "/skills", draft)).statusCode, 403);

  const created = await request("POST", "owner", "/skills", draft);
  assert.equal(created.statusCode, 201);
  const skill = created.json().skill;
  assert.equal(skill.status, "draft");

  assert.equal((await request("POST", "owner", "/skills/system:code-review", { name: "Mine", expectedVersion: 1 })).statusCode, 409);
  assert.equal((await request("POST", "owner", "/skills", draft)).statusCode, 409, "the slug is taken");
  assert.equal((await request("POST", "owner", "/skills", { ...draft, slug: "x", scope: "system" })).statusCode, 400);

  const activated = await request("POST", "owner", `/skills/${skill.id}/status`, { status: "active", expectedVersion: 1 });
  assert.equal(activated.statusCode, 200);
  assert.equal(activated.json().skill.version, 2);

  assert.equal((await request("POST", "owner", `/skills/${skill.id}/status`, { status: "active", expectedVersion: 2, approval: "none" })).statusCode, 400);
});

test("another organization cannot read or change a skill, and malformed references are refused", async () => {
  const { request } = await company();
  const skill = (await request("POST", "owner", "/skills", draft)).json().skill;

  assert.equal((await request("GET", "outsider", `/skills/${skill.id}`)).statusCode, 404);
  assert.equal((await request("POST", "outsider", `/skills/${skill.id}`, { name: "Taken", expectedVersion: 1 })).statusCode, 404);
  assert.equal((await request("GET", "owner", "/skills/..%2F..%2Fmembers")).statusCode, 400);
  assert.equal((await request("GET", "owner", "/skills/not-a-reference")).statusCode, 400);
});
