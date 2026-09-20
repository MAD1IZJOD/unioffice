import assert from "node:assert/strict";
import test from "node:test";

import type {
  Agent,
  AgentId,
  OrganizationId,
  OrganizationRole,
  Skill,
  SkillId,
  WorkspaceId,
} from "@unioffice/core";

import { createDefaultToolRegistry } from "@unioffice/tools";

import { buildApiServer, type ApiServices } from "../server.js";
import { CompanyReadinessService } from "../company-readiness-service.js";

import { StreamTickets } from "./stream-tickets.js";
import { signedIn, TEST_TOKEN } from "./testing.js";

/**
 * Readiness over HTTP, with the real service behind it.
 *
 * The point of the route is that the answer is the caller's own: their role
 * decides what they are offered, their workspace grants decide what they are
 * told about, and neither is anything the request says about itself.
 */

const orgA = "aaaaaaaa-0000-4000-8000-000000000001" as OrganizationId;
const finance = "f0000000-0000-4000-8000-00000000000f" as WorkspaceId;
const epoch = new Date("2026-09-20T12:00:00.000Z");
const bearer = { authorization: `Bearer ${TEST_TOKEN}` };

const harvey: Agent = {
  id: "agent-harvey" as AgentId,
  organizationId: orgA,
  name: "Harvey",
  description: "Runs the numbers.",
  type: "specialist",
  status: "active",
  capabilities: ["financial_analysis"],
  // Granted no tools, so the one thing the company knows is out of reach and
  // the response has something to explain.
  toolIds: [],
  skills: ["financial-analysis"],
  createdAt: epoch,
  updatedAt: epoch,
  metadata: { systemInstructions: "This must never leave the server." },
};

const financialAnalysis: Skill = {
  id: "system:financial-analysis" as SkillId,
  scope: "system",
  slug: "financial-analysis",
  name: "Financial analysis",
  description: "How the numbers are read.",
  category: "finance",
  version: 1,
  status: "active",
  instructions: "Do the work well.",
  inputs: [],
  outputs: [],
  requiredTools: ["calculator"],
  requiredCapabilities: ["financial_analysis"],
  approval: "none",
  memory: "recall",
  createdAt: epoch,
  updatedAt: epoch,
};

function server(role: OrganizationRole, overrides: Partial<ApiServices> = {}) {
  const services = {
    ...signedIn({ organizationId: orgA, role }),
    streamTickets: new StreamTickets(),
    companyReadinessService: new CompanyReadinessService({
      agents: { async findByOrganization() { return [harvey]; } },
      workspaces: { async findByOrganization() { return []; } },
      skills: { async effective() { return new Map([[financialAnalysis.slug, financialAnalysis]]); } },
      tools: createDefaultToolRegistry(),
      reads: { async findWorkSummaries() { return []; } },
      now: () => epoch,
    }),
    healthCheck: async () => ({}),
    corsOrigins: [],
    ...overrides,
  } as unknown as ApiServices;

  return buildApiServer(services);
}

async function readiness(role: OrganizationRole) {
  const response = await server(role).inject({ method: "GET", url: "/company-readiness", headers: bearer });
  assert.equal(response.statusCode, 200);
  return response.json();
}

test("readiness answers what the company can do and why it cannot do the rest", async () => {
  const body = await readiness("owner");

  assert.equal(body.organizationId, orgA);
  assert.equal(body.state, "not_ready");
  assert.equal(body.summary.ready, 0);
  assert.equal(body.summary.blocked, 1);

  const ability = body.areas[0].blocked[0];
  assert.equal(ability.name, "Financial analysis");
  assert.equal(ability.reason, "Harvey needs Calculator.");
  assert.equal(ability.shortfall.kind, "missing_tool");
});

test("an owner is sent to the agent to fix it; a member and a viewer are not offered the action", async () => {
  const owner = await readiness("owner");
  assert.deepEqual(owner.areas[0].blocked[0].fix, { label: "Prepare Harvey", path: "/workforce/agent-harvey" });

  const member = await readiness("member");
  assert.equal(member.areas[0].blocked[0].fix, undefined);
  assert.equal(member.firstRun.canPrepareWorkforce, false);

  const viewer = await readiness("viewer");
  assert.equal(viewer.areas[0].blocked[0].fix, undefined);
  assert.equal(viewer.firstRun.canStartMission, false);
});

test("readiness never carries an agent's model instructions or a skill's procedure", async () => {
  const body = await readiness("owner");
  const serialized = JSON.stringify(body);

  assert.equal(serialized.includes("never leave the server"), false);
  assert.equal(serialized.includes("Do the work well"), false);
});

test("signing out of it is refused rather than answered", async () => {
  const response = await server("owner").inject({ method: "GET", url: "/company-readiness" });

  assert.equal(response.statusCode, 401);
});

test("a server built without readiness says so instead of failing oddly", async () => {
  const response = await server("owner", { companyReadinessService: undefined })
    .inject({ method: "GET", url: "/company-readiness", headers: bearer });

  assert.equal(response.statusCode, 503);
});

test("someone with no grant in a workspace is not told what that workspace can do", async () => {
  const financeOnly: Skill = {
    ...financialAnalysis,
    id: "skill-close" as SkillId,
    scope: "workspace",
    organizationId: orgA,
    workspaceId: finance,
    slug: "close-the-books",
    name: "Close the books",
  };

  const app = server("member", {
    companyReadinessService: new CompanyReadinessService({
      agents: { async findByOrganization() { return [{ ...harvey, workspaceId: finance }]; } },
      workspaces: {
        async findByOrganization() {
          return [{ id: finance, organizationId: orgA, name: "Finance", slug: "finance", status: "active", createdAt: epoch, updatedAt: epoch, metadata: {} }];
        },
      },
      skills: {
        async effective(_organizationId, workspaceId) {
          return workspaceId === finance
            ? new Map([[financeOnly.slug, financeOnly]])
            : new Map<string, Skill>();
        },
      },
      tools: createDefaultToolRegistry(),
      reads: { async findWorkSummaries() { return []; } },
      now: () => epoch,
    }) as never,
  });

  const body = (await app.inject({ method: "GET", url: "/company-readiness", headers: bearer })).json();

  assert.deepEqual(body.areas, []);
  assert.equal(body.summary.agents, 0);
});
