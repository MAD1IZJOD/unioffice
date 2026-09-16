import assert from "node:assert/strict";
import test from "node:test";

import type { Agent, AgentId, Event, EventId, OrganizationId } from "@unioffice/core";

import { describeEvent } from "./mission-reading.js";

const tony = { id: "agent-1" as AgentId, name: "Tony" } as Agent;

function event(type: Event["type"], payload: Record<string, unknown>): Event {
  return {
    id: "event-1" as EventId,
    organizationId: "org-1" as OrganizationId,
    agentId: tony.id,
    actorType: "agent",
    type,
    timestamp: new Date(),
    payload,
    metadata: {},
  };
}

test("an external call reads as the tool's own sentence, never its content", () => {
  const agents = new Map([[tony.id, tony]]);

  assert.equal(
    describeEvent(event("external.write", { summary: "GitHub pull request created", resource: { repository: "acme/app", pullRequest: 4 } }), agents),
    "Tony: GitHub pull request created",
  );
  assert.equal(
    describeEvent(event("external.read", { summary: "Drive document accessed", content: "Q3 salaries" }), agents),
    "Tony: Drive document accessed",
  );
  assert.equal(describeEvent(event("external.read", {}), agents), "Tony: used an external system");
});
