import assert from "node:assert/strict";
import test from "node:test";

import type { Agent, AgentId, OrganizationId } from "@unioffice/core";
import type { SupabaseClient } from "@supabase/supabase-js";

import { metadataOf, SupabaseAgentRepository } from "./supabase-agent-repository.js";

/**
 * The role is kept in the row's metadata. These hold that it lives in one
 * place: written from `agent.role`, read back into `agent.role`, cleared when
 * the agent has none, and never left in the metadata the rest of the code sees.
 */

function agent(overrides: Partial<Agent> = {}): Agent {
  const now = new Date("2026-09-30T00:00:00.000Z");
  return {
    id: "a1" as AgentId,
    organizationId: "org" as OrganizationId,
    name: "Jessica",
    description: "Decides what gets built next.",
    type: "specialist",
    status: "active",
    capabilities: ["product_management"],
    toolIds: ["datetime"],
    skills: [],
    createdAt: now,
    updatedAt: now,
    metadata: { userConfigured: true, systemInstructions: "Private." },
    ...overrides,
  };
}

/** A client that stores the last row written and hands it back, as Supabase would. */
function fakeClient() {
  let stored: Record<string, unknown> | undefined;
  const chain = {
    insert(row: Record<string, unknown>) { stored = row; return chain; },
    update(row: Record<string, unknown>) { stored = { ...stored, ...row }; return chain; },
    eq() { return chain; },
    select() { return chain; },
    single: async () => ({ data: stored, error: null }),
  };
  return { client: { from: () => chain } as unknown as SupabaseClient, written: () => stored! };
}

test("writes the role into the row's metadata and reads it back as the agent's role", async () => {
  const { client, written } = fakeClient();
  const saved = await new SupabaseAgentRepository(client).create(agent({ role: " Product Manager " }));

  assert.deepEqual(written().metadata, { userConfigured: true, systemInstructions: "Private.", role: "Product Manager" });
  assert.equal(saved.role, "Product Manager");
  assert.equal("role" in saved.metadata, false, "the role is not left in the metadata as well");
  assert.equal(saved.metadata.systemInstructions, "Private.");
});

test("clears a stored role when the agent no longer has one", async () => {
  const { client, written } = fakeClient();
  const repository = new SupabaseAgentRepository(client);

  await repository.create(agent({ role: "Product Manager" }));
  const saved = await repository.update(agent({ metadata: { userConfigured: true, role: "Product Manager" } }));

  assert.deepEqual(written().metadata, { userConfigured: true });
  assert.equal(saved.role, undefined);
});

test("stores no role for an agent that has none, or only spaces", () => {
  assert.deepEqual(metadataOf(agent()), { userConfigured: true, systemInstructions: "Private." });
  assert.deepEqual(metadataOf(agent({ role: "   " })), { userConfigured: true, systemInstructions: "Private." });
});
