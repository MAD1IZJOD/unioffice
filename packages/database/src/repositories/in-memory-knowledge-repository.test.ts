import assert from "node:assert/strict";
import test from "node:test";

import type {
  KnowledgeConflict,
  KnowledgeConflictId,
  Memory,
  MemoryId,
  OrganizationId,
  WorkspaceId,
} from "@unioffice/core";

import { InMemoryKnowledgeRepository } from "./in-memory-knowledge-repository.js";

const orgA = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" as OrganizationId;
const orgB = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb" as OrganizationId;
const finance = "11111111-0000-0000-0000-000000000001" as WorkspaceId;
const legal = "11111111-0000-0000-0000-000000000002" as WorkspaceId;

let counter = 0;

function knowledge(overrides: Partial<Memory> = {}): Memory {
  counter += 1;
  const now = new Date(Date.UTC(2026, 8, 1, 0, counter));

  return {
    id: `00000000-0000-0000-0000-${String(counter).padStart(12, "0")}` as MemoryId,
    organizationId: orgA,
    scope: "company",
    type: "decision",
    status: "active",
    title: "Pricing decision",
    content: "Starter is priced at $99.",
    sourceType: "user",
    importance: 0.5,
    createdAt: now,
    updatedAt: now,
    metadata: {},
    ...overrides,
  };
}

async function seeded() {
  const repository = new InMemoryKnowledgeRepository();
  const rows = {
    companyWide: knowledge(),
    financeOnly: knowledge({ workspaceId: finance }),
    legalOnly: knowledge({ workspaceId: legal }),
    proposed: knowledge({ status: "proposed" }),
    archived: knowledge({ status: "archived" }),
    otherOrg: knowledge({ organizationId: orgB }),
  };

  for (const row of Object.values(rows)) {
    await repository.create(row);
    await repository.setEmbedding(row.organizationId, row.id, [1, 0, 0], "test");
  }

  return { repository, rows };
}

test("candidate search never crosses the organization boundary", async () => {
  const { repository, rows } = await seeded();

  const found = await repository.searchCandidates({
    organizationId: orgA,
    statuses: ["active", "proposed", "archived"],
    workspace: { mode: "all" },
    embedding: [1, 0, 0],
    terms: "pric",
    candidateLimit: 50,
  });

  assert.ok(!found.some((row) => row.memoryId === rows.otherOrg.id));
  assert.equal(found.length, 5);
});

test("work outside any workspace sees company-wide knowledge only", async () => {
  const { repository, rows } = await seeded();

  const found = await repository.searchCandidates({
    organizationId: orgA,
    statuses: ["active"],
    workspace: { mode: "company" },
    embedding: [1, 0, 0],
    terms: "pric",
    candidateLimit: 50,
  });

  assert.deepEqual(found.map((row) => row.memoryId), [rows.companyWide.id]);
});

test("work inside a workspace sees its own workspace and company-wide, never another workspace", async () => {
  const { repository, rows } = await seeded();

  const found = await repository.searchCandidates({
    organizationId: orgA,
    statuses: ["active"],
    workspace: { mode: "company_and_workspace", workspaceId: finance },
    embedding: [1, 0, 0],
    terms: "pric",
    candidateLimit: 50,
  });

  assert.deepEqual(
    found.map((row) => row.memoryId).sort(),
    [rows.companyWide.id, rows.financeOnly.id].sort(),
  );
});

test("the status set is a hard filter, so archived knowledge is never a candidate unless asked for", async () => {
  const { repository, rows } = await seeded();

  const found = await repository.searchCandidates({
    organizationId: orgA,
    statuses: ["active", "proposed"],
    workspace: { mode: "all" },
    embedding: [1, 0, 0],
    terms: "pric",
    candidateLimit: 50,
  });

  assert.ok(!found.some((row) => row.memoryId === rows.archived.id));
  assert.ok(found.some((row) => row.memoryId === rows.proposed.id));
});

test("reads and writes by id are refused across organizations", async () => {
  const { repository, rows } = await seeded();

  assert.deepEqual(await repository.findByIds(orgB, [rows.companyWide.id]), []);
  await assert.rejects(repository.update({ ...rows.companyWide, organizationId: orgB }));

  await repository.setEmbedding(orgB, rows.companyWide.id, [0, 1, 0], "attacker");
  assert.equal(repository.embeddings.get(rows.companyWide.id)?.model, "test");
});

test("query filters narrow by workspace, lifecycle and importance", async () => {
  const { repository, rows } = await seeded();
  await repository.create(knowledge({ importance: 0.95, title: "Critical" }));

  assert.deepEqual(
    (await repository.query({ organizationId: orgA, workspaceId: null, statuses: ["active"] })).map((row) => row.title).sort(),
    ["Critical", rows.companyWide.title].sort(),
  );
  assert.equal((await repository.query({ organizationId: orgA, workspaceId: finance })).length, 1);
  assert.equal((await repository.query({ organizationId: orgA, minImportance: 0.9 })).length, 1);
  assert.equal((await repository.query({ organizationId: orgA, limit: 2, offset: 4 })).length, 2);
});

test("only one open conflict is kept per pair, in either order", async () => {
  const { repository, rows } = await seeded();
  const conflict: KnowledgeConflict = {
    id: "c0000000-0000-0000-0000-000000000001" as KnowledgeConflictId,
    organizationId: orgA,
    memoryId: rows.companyWide.id,
    conflictingMemoryId: rows.proposed.id,
    reason: "different amounts",
    signals: {},
    status: "open",
    detectedAt: new Date(),
  };

  assert.ok(await repository.createConflict(conflict));
  assert.equal(
    await repository.createConflict({
      ...conflict,
      id: "c0000000-0000-0000-0000-000000000002" as KnowledgeConflictId,
      memoryId: rows.proposed.id,
      conflictingMemoryId: rows.companyWide.id,
    }),
    null,
  );

  await repository.updateConflict({ ...conflict, status: "resolved" });

  assert.ok(
    await repository.createConflict({
      ...conflict,
      id: "c0000000-0000-0000-0000-000000000003" as KnowledgeConflictId,
    }),
    "a resolved conflict does not block a new one being raised",
  );

  assert.equal(await repository.findConflictById(orgB, conflict.id), null);
  assert.equal((await repository.findConflicts(orgA, { memoryId: rows.proposed.id })).length, 2);
});
