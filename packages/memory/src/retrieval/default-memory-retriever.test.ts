import assert from "node:assert/strict";
import test from "node:test";

import type { AgentId, Memory, MemoryId, OrganizationId } from "@unioffice/core";
import type { MemoryQuery, MemoryRepository } from "@unioffice/database";

import { DefaultMemoryRetriever } from "./default-memory-retriever.js";

const organizationId = "org-1" as OrganizationId;

class FakeMemoryRepository implements MemoryRepository {
  constructor(private readonly memories: Memory[]) {}

  async create(memory: Memory): Promise<Memory> {
    this.memories.push(memory);
    return memory;
  }

  async findById(id: MemoryId): Promise<Memory | null> {
    return this.memories.find((memory) => memory.id === id) ?? null;
  }

  async query(query: MemoryQuery): Promise<Memory[]> {
    return this.memories
      .filter((memory) => memory.organizationId === query.organizationId)
      .slice(0, query.limit);
  }

  async update(memory: Memory): Promise<Memory> {
    return memory;
  }

  async delete(): Promise<void> {}
}

function makeMemory(overrides: Partial<Memory>): Memory {
  const now = new Date();

  return {
    id: `memory-${Math.random()}` as MemoryId,
    organizationId,
    scope: "company",
    type: "fact",
    content: "",
    importance: 0.5,
    createdAt: now,
    updatedAt: now,
    metadata: {},
    ...overrides,
  };
}

test("ranks memories with keyword overlap above unrelated ones", async () => {
  const relevant = makeMemory({ content: "The onboarding flow requires SSO for enterprise customers." });
  const unrelated = makeMemory({ content: "The office lease renews every March." });
  const repository = new FakeMemoryRepository([unrelated, relevant]);
  const retriever = new DefaultMemoryRetriever(repository);

  const results = await retriever.retrieve({
    organizationId,
    query: "Does onboarding need SSO?",
  });

  assert.equal(results.length, 1);
  assert.equal(results[0]?.id, relevant.id);
});

test("excludes another agent's private memory but includes company-scoped ones", async () => {
  const agentId = "agent-1" as AgentId;
  const otherAgentMemory = makeMemory({
    scope: "agent",
    agentId: "agent-2" as AgentId,
    content: "budget budget budget budget",
  });
  const companyMemory = makeMemory({ content: "budget planning budget review budget" });
  const repository = new FakeMemoryRepository([otherAgentMemory, companyMemory]);
  const retriever = new DefaultMemoryRetriever(repository);

  const results = await retriever.retrieve({
    organizationId,
    agentId,
    query: "budget",
  });

  assert.deepEqual(results.map((memory) => memory.id), [companyMemory.id]);
});

test("surfaces a critically important memory even without a keyword match", async () => {
  const critical = makeMemory({ content: "Never ship to the EU without legal sign-off.", importance: 0.95 });
  const irrelevant = makeMemory({ content: "Lunch is catered on Fridays.", importance: 0.2 });
  const repository = new FakeMemoryRepository([irrelevant, critical]);
  const retriever = new DefaultMemoryRetriever(repository);

  const results = await retriever.retrieve({
    organizationId,
    query: "quarterly revenue projections",
  });

  assert.deepEqual(results.map((memory) => memory.id), [critical.id]);
});

test("respects the requested limit", async () => {
  const memories = Array.from({ length: 10 }, (_, index) =>
    makeMemory({ content: `roadmap item roadmap detail number ${index}` }));
  const repository = new FakeMemoryRepository(memories);
  const retriever = new DefaultMemoryRetriever(repository);

  const results = await retriever.retrieve({
    organizationId,
    query: "roadmap",
    limit: 3,
  });

  assert.equal(results.length, 3);
});

test("returns nothing when there is no relevant or important memory", async () => {
  const repository = new FakeMemoryRepository([
    makeMemory({ content: "Coffee machine on floor 2 is broken.", importance: 0.3 }),
  ]);
  const retriever = new DefaultMemoryRetriever(repository);

  const results = await retriever.retrieve({
    organizationId,
    query: "quarterly financial forecast",
  });

  assert.deepEqual(results, []);
});
