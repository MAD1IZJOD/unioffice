import assert from "node:assert/strict";
import test from "node:test";

import { resolveSkills, skillFit } from "@unioffice/skills";
import { createDefaultToolRegistry } from "@unioffice/tools";

import { proposedWorkforce, SEED_WORKSPACES, workforce } from "./development-workforce.js";
import { expandedWorkforce } from "./workforce-expansion.js";

/**
 * The contract every agent beyond the first twenty has to meet before it is
 * provisioned: a real role and room, tools that exist, skills it can use,
 * and a capability of its own so the delegator can tell it apart.
 */

/** The two agents people made themselves, as they are in the company. */
const madeByPeople = [
  { id: "295bf325-f292-49bc-bb99-fc7a43394e09", name: "Dana", capabilities: ["scheduling", "calculation"] },
  { id: "7e9b865a-4743-49a5-b1af-b4f0ff7bc9b7", name: "Rhea", capabilities: ["customer_communication", "writing"] },
];
const everyoneElse = [...workforce, ...proposedWorkforce, ...madeByPeople];
const retired = ["Atlas", "Forge", "Ledger", "Nova", "Kindred", "Relay"];

test("no id or name is used twice, and none of the retired names comes back", () => {
  const ids = [...everyoneElse, ...expandedWorkforce].map((agent) => agent.id);
  const names = [...everyoneElse, ...expandedWorkforce].map((agent) => agent.name);

  assert.equal(new Set(ids).size, ids.length, "every id is its own");
  assert.equal(new Set(names).size, names.length, "every name is its own");
  for (const name of retired) assert.equal(names.includes(name), false, `${name} stays retired`);
});

test("each has a role, a room that exists, and says what it actually does", () => {
  for (const agent of expandedWorkforce) {
    assert.ok(agent.role && agent.role.length <= 60, `${agent.name} has a role`);
    assert.equal(agent.type, "specialist", `${agent.name} is a specialist`);
    if (agent.workspace) assert.ok(agent.workspace in SEED_WORKSPACES, `${agent.name}'s room ${agent.workspace} is known`);
    assert.ok(agent.description.length > 120, `${agent.name} says what it does`);
    assert.ok(agent.capabilities.length >= 2, `${agent.name} holds more than one capability`);
  }
});

test("holds only tools that exist, and only skills it can actually use", () => {
  const registry = createDefaultToolRegistry();
  const skills = resolveSkills([]);

  for (const agent of expandedWorkforce) {
    for (const toolId of agent.toolIds) assert.equal(registry.has(toolId), true, `${agent.name}: ${toolId} is a registered tool`);
    assert.ok(agent.skills.length > 0, `${agent.name} holds at least one skill`);

    for (const slug of agent.skills) {
      const skill = skills.get(slug);
      assert.ok(skill, `${agent.name}: ${slug} is a skill`);
      assert.equal(skillFit({ ...agent, capabilities: agent.capabilities, toolIds: agent.toolIds } as never, skill).fits, true, `${agent.name} can use ${slug}`);
    }
  }
});

test("each owns a capability nobody else in the company holds", () => {
  const holders = new Map<string, string[]>();
  for (const agent of [...everyoneElse, ...expandedWorkforce]) {
    for (const capability of agent.capabilities) holders.set(capability, [...(holders.get(capability) ?? []), agent.name]);
  }

  for (const agent of expandedWorkforce) {
    const owned = agent.capabilities.filter((capability) => holders.get(capability)!.length === 1);
    assert.ok(owned.length > 0, `${agent.name} owns a capability of its own`);
  }
});

test("takes nothing already owned by one of the first twenty's specialists", () => {
  // The capability each of the twelve was provisioned to own stays theirs alone.
  const ownedByTheTwelve = ["frontend_development", "backend_development", "quality_assurance", "infrastructure_operations", "product_management",
    "product_research", "sales", "marketing", "content_creation", "project_coordination", "procurement", "customer_support"];
  const sharedOnPurpose: Record<string, string[]> = {
    // A full-stack engineer does front and back end work; an integration
    // engineer builds backend services; platform, cloud, reliability and MLOps
    // engineers run infrastructure. Ties still go to the one already here.
    frontend_development: ["Alex"],
    backend_development: ["Alex", "Liam"],
    infrastructure_operations: ["Ryan", "Ethan", "Olivia", "Noah"],
  };

  for (const capability of ownedByTheTwelve) {
    const newcomers = expandedWorkforce.filter((agent) => agent.capabilities.includes(capability)).map((agent) => agent.name);
    assert.deepEqual(newcomers, sharedOnPurpose[capability] ?? [], `${capability} is shared only on purpose`);
  }
});

test("each department has the people it was planned with", () => {
  const byRoom = new Map<string, string[]>();
  for (const agent of expandedWorkforce) byRoom.set(agent.workspace ?? "hall", [...(byRoom.get(agent.workspace ?? "hall") ?? []), agent.name]);

  assert.deepEqual(byRoom.get("engineering"), ["Alex", "Maya", "Leo", "Elena", "Ryan", "Chloe", "Ethan", "Olivia", "Noah", "Arjun", "Sophie", "Liam"]);
  assert.deepEqual(byRoom.get("product"), ["Emma", "Lucas", "Mia", "Daniel", "Ava", "Henry"]);
  assert.deepEqual(byRoom.get("research"), ["Nora", "Adam", "Isabella", "Ethan R", "Clara"]);
});
