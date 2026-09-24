import assert from "node:assert/strict";
import test from "node:test";

import type { Agent, AgentId, OrganizationId, UserId, Work, WorkId } from "@unioffice/core";
import type { PlanningToolDescriptor } from "@unioffice/orchestrator";

import { WorkService } from "./work-service.js";

/**
 * Which tools the planner is offered.
 *
 * Found on a live recurring mission: its second run failed at planning
 * because the model asked for Google Drive search - offered to it though the
 * organization had no Drive connection - and no agent could be given it. A
 * tool that cannot run here must not be offered; one that can must be.
 */

const organizationId = "bbbbbbbb-0000-4000-8000-000000000002" as OrganizationId;
const mission = "aaaaaaaa-0000-4000-8000-000000000001" as WorkId;

const registry: PlanningToolDescriptor[] = [
  { id: "calculator", name: "Calculator", description: "Arithmetic." },
  { id: "datetime", name: "Date/Time", description: "Dates." },
  { id: "drive_search", name: "Search Google Drive", description: "Finds files in Drive." },
  { id: "github_create_issue", name: "Create a GitHub issue", description: "Opens an issue." },
];

function harness(toolReach?: { usableToolIds(organizationId: OrganizationId): Promise<ReadonlySet<string>> }) {
  let offered: string[] | undefined;
  const asked: OrganizationId[] = [];
  let stored: Work = {
    id: mission,
    organizationId,
    requesterId: "cccccccc-0000-4000-8000-000000000003" as UserId,
    objective: "Review our support coverage from the facts given",
    status: "queued",
    priority: "normal",
    createdAt: new Date(),
    updatedAt: new Date(),
    metadata: {},
  };

  const agent = {
    id: "dddddddd-0000-4000-8000-000000000004" as AgentId,
    organizationId,
    name: "Mike",
    status: "active",
    type: "specialist",
    capabilities: ["research"],
    toolIds: ["datetime"],
    skills: [],
    metadata: {},
  } as unknown as Agent;

  const service = new WorkService(
    {
      async findById() { return { ...stored }; },
      async update(next: Work) { stored = { ...next }; return { ...next }; },
    } as never,
    { async create(task: unknown) { return task; } } as never,
    { async findByOrganization() { return [agent]; } } as never,
    {
      async plan(input: { availableTools: PlanningToolDescriptor[] }) {
        offered = input.availableTools.map((tool) => tool.id);
        return {
          workId: mission,
          summary: "one step",
          tasks: [{ id: "eeeeeeee-0000-4000-8000-000000000005", ref: "a", title: "Summarise", description: "Summarise it", dependsOn: [], requiredTools: [], requiredCapabilities: [], metadata: {} }],
          metadata: {},
        };
      },
    } as never,
    { async delegate(context: { task: { id: string } }) { return { taskId: context.task.id, agentId: agent.id, metadata: {} }; } } as never,
    { async record(event: unknown) { return event; } } as never,
    registry,
    undefined,
    undefined,
    toolReach
      ? {
          async usableToolIds(id: OrganizationId) {
            asked.push(id);
            return toolReach.usableToolIds(id);
          },
        }
      : undefined,
  );

  return { service, offered: () => offered, asked };
}

test("a tool that cannot run in this organization is not offered to the planner", async () => {
  const { service, offered, asked } = harness({
    async usableToolIds() { return new Set(["calculator", "datetime"]); },
  });

  await service.planWork(mission);

  assert.deepEqual(offered(), ["calculator", "datetime"]);
  assert.deepEqual(asked, [organizationId], "asked about the mission's own organization");
});

test("a built-in tool nobody holds is still offered, so a genuine need is reported as a setup problem", async () => {
  // Mike holds only datetime; calculator is usable here but unheld. It must
  // stay on offer - a mission that truly needs it should stop as "nobody is
  // set up to use the calculator", not be planned as if it did not exist.
  const { service, offered } = harness({
    async usableToolIds() { return new Set(["calculator", "datetime"]); },
  });

  await service.planWork(mission);

  assert.ok(offered()!.includes("calculator"));
});

test("an external tool is offered once the organization is connected to its system", async () => {
  const { service, offered } = harness({
    async usableToolIds() { return new Set(["calculator", "datetime", "drive_search"]); },
  });

  await service.planWork(mission);

  assert.ok(offered()!.includes("drive_search"));
  assert.equal(offered()!.includes("github_create_issue"), false);
});

test("without anything saying what can run, every registered tool is offered as before", async () => {
  const { service, offered } = harness();

  await service.planWork(mission);

  assert.deepEqual(offered(), registry.map((tool) => tool.id));
});
