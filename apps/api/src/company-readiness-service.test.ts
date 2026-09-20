import assert from "node:assert/strict";
import test from "node:test";

import type {
  Agent,
  AgentId,
  MemberId,
  OrganizationId,
  OrganizationRole,
  Skill,
  SkillId,
  UserId,
  Workspace,
  WorkspaceAccessLevel,
  WorkspaceId,
} from "@unioffice/core";

import { createDefaultToolRegistry } from "@unioffice/tools";

import { CompanyReadinessService } from "./company-readiness-service.js";
import type { Access } from "./access/permissions.js";

/**
 * Readiness has to agree with execution or it is worse than nothing: a
 * company told it can do something, whose mission is then refused for a
 * reason that was knowable all along, trusts the product less than one that
 * was told the truth up front.
 *
 * So these tests are about the boundaries execution itself enforces - the
 * tool grant, the capability, the skill assignment, the agent's status, the
 * workspace - and about never offering a remediation to somebody the server
 * would refuse.
 */

const orgA = "aaaaaaaa-0000-4000-8000-000000000001" as OrganizationId;
const finance = "f0000000-0000-4000-8000-00000000000f" as WorkspaceId;
const legal = "10000000-0000-4000-8000-000000000001" as WorkspaceId;
const epoch = new Date("2026-09-20T12:00:00.000Z");

function agent(name: string, overrides: Partial<Agent> = {}): Agent {
  return {
    id: `agent-${name.toLowerCase()}` as AgentId,
    organizationId: orgA,
    name,
    description: `${name} does the work.`,
    type: "specialist",
    status: "active",
    capabilities: ["calculation", "financial_analysis"],
    toolIds: ["calculator"],
    skills: ["financial-analysis"],
    createdAt: epoch,
    updatedAt: epoch,
    metadata: {},
    ...overrides,
  };
}

function skill(slug: string, overrides: Partial<Skill> = {}): Skill {
  return {
    id: `system:${slug}` as SkillId,
    scope: "system",
    slug,
    name: slug === "financial-analysis" ? "Financial analysis" : slug,
    description: "How this kind of work is done.",
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
    ...overrides,
  };
}

function workspace(id: WorkspaceId, name: string): Workspace {
  return {
    id,
    organizationId: orgA,
    name,
    slug: name.toLowerCase(),
    description: "",
    status: "active",
    createdAt: epoch,
    updatedAt: epoch,
    metadata: {},
  } as Workspace;
}

function access(
  role: OrganizationRole = "owner",
  workspaces: Array<[WorkspaceId, WorkspaceAccessLevel]> = [],
): Access {
  return {
    userId: "11111111-0000-4000-8000-000000000001" as UserId,
    email: "someone@example.test",
    organizationId: orgA,
    memberId: "00000000-0000-4000-8000-000000000001" as MemberId,
    role,
    workspaces: new Map(workspaces),
  };
}

/**
 * The service over doubles that answer exactly what the real repositories do.
 * Skills resolve per workspace the way SkillService.effective resolves them:
 * a workspace skill is only in that workspace's map.
 */
function company(options: {
  agents?: Agent[];
  skills?: Skill[];
  workspaces?: Workspace[];
  missions?: number;
} = {}) {
  const all = options.skills ?? [skill("financial-analysis")];

  return new CompanyReadinessService({
    agents: { async findByOrganization() { return options.agents ?? []; } },
    workspaces: { async findByOrganization() { return options.workspaces ?? []; } },
    skills: {
      async effective(_organizationId: OrganizationId, workspaceId?: WorkspaceId) {
        const applies = all.filter((entry) =>
          entry.scope !== "workspace" || entry.workspaceId === workspaceId);
        return new Map(applies.map((entry) => [entry.slug, entry]));
      },
    },
    tools: createDefaultToolRegistry(),
    reads: {
      async findWorkSummaries() {
        return Array.from({ length: options.missions ?? 0 }, () => ({}) as never);
      },
    },
    now: () => epoch,
  });
}

function find(readiness: { areas: Array<{ ready: Array<{ slug: string }>; blocked: Array<{ slug: string }> }> }, slug: string) {
  for (const area of readiness.areas) {
    const match = [...area.ready, ...area.blocked].find((ability) => ability.slug === slug);
    if (match) return match as never;
  }

  return undefined;
}

test("an agent that holds the skill with every tool and capability is ready", async () => {
  const readiness = await company({ agents: [agent("Harvey")] }).getReadiness(access());

  assert.equal(readiness.state, "ready");
  assert.equal(readiness.summary.ready, 1);
  assert.equal(readiness.summary.blocked, 0);

  const ability = find(readiness, "financial-analysis") as unknown as {
    ready: boolean; reason: string; agents: Array<{ name: string }>;
  };

  assert.equal(ability.ready, true);
  assert.deepEqual(ability.agents.map((entry) => entry.name), ["Harvey"]);
  assert.equal(ability.reason, "Harvey can do this.");
});

test("a missing tool blocks the ability and names the tool a person would recognise", async () => {
  const readiness = await company({
    agents: [agent("Harvey", { toolIds: [] })],
  }).getReadiness(access());

  assert.equal(readiness.state, "not_ready");

  const ability = find(readiness, "financial-analysis") as unknown as {
    ready: boolean; reason: string; shortfall: { kind: string; tools: Array<{ id: string; name: string }> };
  };

  assert.equal(ability.ready, false);
  assert.equal(ability.shortfall.kind, "missing_tool");
  assert.deepEqual(ability.shortfall.tools.map((tool) => tool.id), ["calculator"]);
  assert.match(ability.reason, /^Harvey needs Calculator/);
});

test("a missing capability blocks the ability and says which one", async () => {
  const readiness = await company({
    agents: [agent("Harvey", { capabilities: ["calculation"] })],
  }).getReadiness(access());

  const ability = find(readiness, "financial-analysis") as unknown as {
    ready: boolean; reason: string; shortfall: { kind: string; capabilities: string[] };
  };

  assert.equal(ability.ready, false);
  assert.equal(ability.shortfall.kind, "missing_capability");
  assert.deepEqual(ability.shortfall.capabilities, ["financial_analysis"]);
  assert.equal(ability.reason, "Harvey needs financial analysis.");
});

test("a skill nobody was assigned is not claimed as an ability", async () => {
  const readiness = await company({
    agents: [agent("Harvey", { skills: [] })],
  }).getReadiness(access());

  const ability = find(readiness, "financial-analysis") as unknown as {
    ready: boolean; shortfall: { kind: string };
  };

  assert.equal(ability.ready, false);
  assert.equal(ability.shortfall.kind, "unassigned");
});

test("an agent who is paused cannot be given work, exactly as the delegator has it", async () => {
  const readiness = await company({
    agents: [agent("Harvey", { status: "paused" })],
  }).getReadiness(access());

  assert.equal(readiness.state, "no_workforce");

  const ability = find(readiness, "financial-analysis") as unknown as {
    ready: boolean; shortfall: { kind: string; agent: { name: string } };
  };

  assert.equal(ability.ready, false);
  assert.equal(ability.shortfall.kind, "agent_unavailable");
  assert.equal(ability.shortfall.agent.name, "Harvey");
});

test("a workspace skill is only an ability where an agent of that workspace can be given it", async () => {
  const workspaceSkill = skill("close-the-books", {
    id: "skill-close" as SkillId,
    scope: "workspace",
    organizationId: orgA,
    workspaceId: finance,
    name: "Close the books",
  });

  const readiness = await company({
    agents: [agent("Harvey", { workspaceId: finance, skills: ["close-the-books"] })],
    skills: [skill("financial-analysis"), workspaceSkill],
    workspaces: [workspace(finance, "Finance"), workspace(legal, "Legal")],
  }).getReadiness(access());

  const abilities = readiness.areas.flatMap((area) => [...area.ready, ...area.blocked]);

  // Two workspaces resolve, but the skill belongs to one of them, so it is
  // named once rather than appearing empty in the other.
  assert.equal(abilities.filter((ability) => ability.slug === "close-the-books").length, 1);

  const ability = abilities.find((entry) => entry.slug === "close-the-books")!;
  assert.equal(ability.ready, true);
  assert.deepEqual(ability.workspace, { id: finance, name: "Finance" });
});

test("someone who reaches one workspace does not see the abilities of another", async () => {
  const legalSkill = skill("file-the-filing", {
    id: "skill-file" as SkillId,
    scope: "workspace",
    organizationId: orgA,
    workspaceId: legal,
    name: "File the filing",
  });

  const readiness = await company({
    agents: [
      agent("Harvey", { workspaceId: finance }),
      agent("Louis", { id: "agent-louis" as AgentId, workspaceId: legal, skills: ["file-the-filing"] }),
    ],
    skills: [skill("financial-analysis"), legalSkill],
    workspaces: [workspace(finance, "Finance"), workspace(legal, "Legal")],
  }).getReadiness(access("member", [[finance, "member"]]));

  const abilities = readiness.areas.flatMap((area) => [...area.ready, ...area.blocked]);

  assert.equal(abilities.some((ability) => ability.slug === "file-the-filing"), false);
  assert.equal(readiness.summary.agents, 1);
});

test("an owner is shown where to fix a shortfall; a member and a viewer are not", async () => {
  const short = company({ agents: [agent("Harvey", { toolIds: [] })] });

  const owner = find(await short.getReadiness(access("owner")), "financial-analysis") as unknown as {
    fix?: { label: string; path: string };
  };
  assert.deepEqual(owner.fix, { label: "Prepare Harvey", path: "/workforce/agent-harvey" });

  const member = find(await short.getReadiness(access("member")), "financial-analysis") as unknown as {
    fix?: { label: string };
  };
  assert.equal(member.fix, undefined);

  const viewer = find(await short.getReadiness(access("viewer")), "financial-analysis") as unknown as {
    fix?: { label: string };
  };
  assert.equal(viewer.fix, undefined);
});

test("what a role may do is reported from the same permissions the routes authorize with", async () => {
  const short = company({ agents: [agent("Harvey")] });

  const owner = await short.getReadiness(access("owner"));
  assert.deepEqual(
    { prepare: owner.firstRun.canPrepareWorkforce, start: owner.firstRun.canStartMission },
    { prepare: true, start: true },
  );

  const member = await short.getReadiness(access("member"));
  assert.deepEqual(
    { prepare: member.firstRun.canPrepareWorkforce, start: member.firstRun.canStartMission },
    { prepare: false, start: true },
  );

  const viewer = await short.getReadiness(access("viewer"));
  assert.deepEqual(
    { prepare: viewer.firstRun.canPrepareWorkforce, start: viewer.firstRun.canStartMission },
    { prepare: false, start: false },
  );
});

test("a company that has never opened a mission is in its first run; one that has is not", async () => {
  const fresh = await company({ agents: [agent("Harvey")] }).getReadiness(access());
  assert.equal(fresh.firstRun.pending, true);

  const used = await company({ agents: [agent("Harvey")], missions: 1 }).getReadiness(access());
  assert.equal(used.firstRun.pending, false);
});

test("a company with no agents at all reads as having no workforce rather than as an error", async () => {
  const readiness = await company({ agents: [] }).getReadiness(access());

  assert.equal(readiness.state, "no_workforce");
  assert.equal(readiness.summary.agents, 0);
  assert.equal(readiness.headline, "Nobody works here yet.");

  const ability = find(readiness, "financial-analysis") as unknown as { shortfall: { kind: string } };
  assert.equal(ability.shortfall.kind, "no_workforce");
});

test("a company that knows nothing yet reports no areas rather than inventing them", async () => {
  const readiness = await company({ agents: [agent("Harvey")], skills: [] }).getReadiness(access());

  assert.deepEqual(readiness.areas, []);
  assert.equal(readiness.summary.abilities, 0);
  assert.equal(readiness.state, "not_ready");
});

test("an ability that always waits for a person says so while still being ready", async () => {
  const readiness = await company({
    agents: [agent("Harvey")],
    skills: [skill("financial-analysis", { approval: "required" })],
  }).getReadiness(access());

  const ability = find(readiness, "financial-analysis") as unknown as {
    ready: boolean; needsApproval: boolean; reason: string;
  };

  assert.equal(ability.ready, true);
  assert.equal(ability.needsApproval, true);
  assert.match(ability.reason, /waits for your approval/);
});

test("some ready and some blocked reads as partly ready", async () => {
  const readiness = await company({
    agents: [agent("Harvey")],
    skills: [
      skill("financial-analysis"),
      skill("market-research", { name: "Market research", category: "research", requiredCapabilities: ["research"] }),
    ],
  }).getReadiness(access());

  assert.equal(readiness.state, "partly_ready");
  assert.equal(readiness.summary.ready, 1);
  assert.equal(readiness.summary.blocked, 1);
  assert.deepEqual(readiness.areas.map((area) => area.name), ["Research", "Finance"]);
});
