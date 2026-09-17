import assert from "node:assert/strict";
import test from "node:test";

import type { Agent, AgentId, OrganizationId } from "@unioffice/core";

import { InMemorySkillRepository } from "@unioffice/database";
import { createDefaultToolRegistry } from "@unioffice/tools";

import { AgentDirectoryService, AgentValidationError } from "./agent-directory-service.js";
import { SkillService, SkillValidationError } from "./skills/skill-service.js";

const orgA = "aaaaaaaa-0000-4000-8000-000000000001" as OrganizationId;
const now = new Date("2026-09-17T12:00:00.000Z");

function setup(withSkills = true) {
  const agents: Agent[] = [{
    id: "agent-harvey" as AgentId,
    organizationId: orgA,
    name: "Harvey",
    description: "Quantitative.",
    type: "specialist",
    status: "active",
    capabilities: ["calculation", "financial_analysis"],
    toolIds: ["calculator", "datetime"],
    skills: [],
    createdAt: now,
    updatedAt: now,
    metadata: {},
  }];

  const repository = {
    async findById(id: AgentId) { return agents.find((agent) => agent.id === id) ?? null; },
    async findByOrganization() { return agents; },
    async update(next: Agent) { agents[0] = next; return next; },
  };

  const events: Array<{ type: string; payload?: Record<string, unknown> }> = [];
  const recorder = { async record(event: { type: string; payload?: Record<string, unknown> }) { events.push(event); return event; } };

  const skills = new SkillService({
    skills: new InMemorySkillRepository(),
    agents: repository,
    workspaces: { async findById() { return null; }, async findByOrganization() { return []; } },
    tools: createDefaultToolRegistry(),
    eventRecorder: recorder as never,
  });

  const directory = new AgentDirectoryService(
    repository as never,
    {} as never,
    createDefaultToolRegistry(),
    recorder as never,
    withSkills ? skills : undefined,
  );

  return { directory, agents, events };
}

test("an agent that meets a skill's requirements can be assigned it, and the change is recorded", async () => {
  const { directory, events } = setup();

  const updated = await directory.updateAgent({
    organizationId: orgA,
    agentId: "agent-harvey" as AgentId,
    skills: ["financial-analysis", "forecasting", "forecasting"],
  });

  assert.deepEqual(updated.skills, ["financial-analysis", "forecasting"]);
  assert.deepEqual(events.at(-1)?.payload?.skills, ["financial-analysis", "forecasting"]);
});

test("a skill cannot be assigned together with removing the tool it needs", async () => {
  const { directory, agents } = setup();

  await assert.rejects(
    directory.updateAgent({ organizationId: orgA, agentId: "agent-harvey" as AgentId, toolIds: ["datetime"], skills: ["financial-analysis"] }),
    SkillValidationError,
  );

  assert.deepEqual(agents[0]!.toolIds, ["calculator", "datetime"], "nothing was saved");
});

test("a skill outside the agent's reach, or one that does not exist, is refused", async () => {
  const { directory } = setup();

  await assert.rejects(
    directory.updateAgent({ organizationId: orgA, agentId: "agent-harvey" as AgentId, skills: ["code-review"] }),
    /needs the coding capability/,
  );
  await assert.rejects(
    directory.updateAgent({ organizationId: orgA, agentId: "agent-harvey" as AgentId, skills: ["root-access"] }),
    /not an active skill/,
  );
});

test("leaving skills out of an update keeps the agent's assignments", async () => {
  const { directory } = setup();
  await directory.updateAgent({ organizationId: orgA, agentId: "agent-harvey" as AgentId, skills: ["forecasting"] });

  const updated = await directory.updateAgent({ organizationId: orgA, agentId: "agent-harvey" as AgentId, description: "Numbers." });
  assert.deepEqual(updated.skills, ["forecasting"]);
});

test("without a skill service, skills cannot be assigned at all", async () => {
  const { directory } = setup(false);

  await assert.rejects(
    directory.updateAgent({ organizationId: orgA, agentId: "agent-harvey" as AgentId, skills: ["forecasting"] }),
    AgentValidationError,
  );
});
