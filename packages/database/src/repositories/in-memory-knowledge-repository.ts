import type {
  KnowledgeConflict,
  KnowledgeConflictId,
  KnowledgeRecall,
  KnowledgeStatus,
  Memory,
  MemoryId,
  OrganizationId,
  WorkId,
} from "@unioffice/core";

import type {
  KnowledgeCandidateQuery,
  KnowledgeCandidateRow,
  KnowledgeConflictQuery,
  KnowledgeLinkRepository,
  KnowledgeSearchRepository,
  KnowledgeWorkspaceScope,
} from "./knowledge-repository.js";

import type {
  MemoryQuery,
  MemoryRepository,
} from "./memory-repository.js";

/**
 * The knowledge store without a database.
 *
 * Used by tests across the packages that depend on retrieval. It is written to
 * behave like the real store where behaviour matters for correctness - the
 * tenant boundary, the status set, the workspace scope, one open conflict per
 * pair - so a test that passes against this is testing the rules, not a
 * friendlier version of them. Relevance is approximated: cosine similarity is
 * exact, full-text rank is a term-overlap ratio.
 */
export class InMemoryKnowledgeRepository
  implements MemoryRepository, KnowledgeSearchRepository, KnowledgeLinkRepository
{
  readonly memories = new Map<MemoryId, Memory>();

  readonly embeddings = new Map<MemoryId, { vector: number[]; model: string }>();

  readonly recalls: KnowledgeRecall[] = [];

  readonly conflicts = new Map<KnowledgeConflictId, KnowledgeConflict>();

  async create(memory: Memory): Promise<Memory> {
    if (this.memories.has(memory.id)) {
      throw new Error(`Failed to create memory: duplicate id ${memory.id}`);
    }

    this.memories.set(memory.id, structuredClone(memory));
    return structuredClone(memory);
  }

  async findById(id: MemoryId): Promise<Memory | null> {
    const memory = this.memories.get(id);
    return memory ? structuredClone(memory) : null;
  }

  async query(query: MemoryQuery): Promise<Memory[]> {
    const offset = query.offset ?? 0;
    const limit = query.limit ?? 50;

    return [...this.memories.values()]
      .filter((memory) => matchesQuery(memory, query))
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
      .slice(offset, offset + limit)
      .map((memory) => structuredClone(memory));
  }

  async update(memory: Memory): Promise<Memory> {
    const current = this.memories.get(memory.id);

    // The real repository re-asserts the organization on every write.
    if (!current || current.organizationId !== memory.organizationId) {
      throw new Error("Failed to update memory: not found");
    }

    this.memories.set(memory.id, structuredClone(memory));
    return structuredClone(memory);
  }

  async delete(id: MemoryId): Promise<void> {
    this.memories.delete(id);
    this.embeddings.delete(id);
  }

  async searchCandidates(
    query: KnowledgeCandidateQuery,
  ): Promise<KnowledgeCandidateRow[]> {
    const limit = Math.min(Math.max(query.candidateLimit, 1), 200);
    const terms = query.terms.split("|").map((term) => term.trim()).filter(Boolean);

    const scoped = [...this.memories.values()].filter((memory) =>
      memory.organizationId === query.organizationId &&
      query.statuses.includes(memory.status) &&
      inWorkspaceScope(memory, query.workspace));

    const semantic = query.embedding
      ? scoped
          .filter((memory) => this.embeddings.has(memory.id))
          .map((memory) => ({
            memory,
            similarity: cosine(query.embedding!, this.embeddings.get(memory.id)!.vector),
          }))
          .sort((left, right) => right.similarity - left.similarity)
          .slice(0, limit)
          .map((entry) => entry.memory.id)
      : [];

    const lexical = terms.length > 0
      ? scoped
          .map((memory) => ({ memory, rank: keywordRank(memory, terms) }))
          .filter((entry) => entry.rank > 0)
          .sort((left, right) => right.rank - left.rank)
          .slice(0, limit)
          .map((entry) => entry.memory.id)
      : [];

    const important = scoped
      .filter((memory) => memory.importance >= 0.85)
      .sort((left, right) => right.importance - left.importance)
      .slice(0, 10)
      .map((memory) => memory.id);

    const pool = new Set([...semantic, ...lexical, ...important]);

    return [...pool].map((memoryId) => {
      const memory = this.memories.get(memoryId)!;
      const embedding = this.embeddings.get(memoryId);

      return {
        memoryId,
        semanticSimilarity:
          query.embedding && embedding
            ? cosine(query.embedding, embedding.vector)
            : undefined,
        keywordRank: terms.length > 0 ? keywordRank(memory, terms) : 0,
      };
    });
  }

  async findByIds(
    organizationId: OrganizationId,
    ids: MemoryId[],
  ): Promise<Memory[]> {
    const wanted = new Set(ids);

    return [...this.memories.values()]
      .filter((memory) => wanted.has(memory.id) && memory.organizationId === organizationId)
      .map((memory) => structuredClone(memory));
  }

  async setEmbedding(
    organizationId: OrganizationId,
    id: MemoryId,
    embedding: number[],
    model: string,
  ): Promise<void> {
    const memory = this.memories.get(id);

    if (!memory || memory.organizationId !== organizationId) {
      return;
    }

    this.embeddings.set(id, { vector: [...embedding], model });
    this.memories.set(id, { ...memory, embeddingModel: model });
  }

  async findMissingEmbeddings(
    organizationId: OrganizationId,
    limit: number,
  ): Promise<Memory[]> {
    return [...this.memories.values()]
      .filter((memory) =>
        memory.organizationId === organizationId &&
        memory.status !== "archived" &&
        !this.embeddings.has(memory.id))
      .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime())
      .slice(0, limit)
      .map((memory) => structuredClone(memory));
  }

  async countByStatus(
    organizationId: OrganizationId,
  ): Promise<Record<KnowledgeStatus, number>> {
    const counts: Record<KnowledgeStatus, number> = { proposed: 0, active: 0, archived: 0 };

    for (const memory of this.memories.values()) {
      if (memory.organizationId === organizationId) counts[memory.status] += 1;
    }

    return counts;
  }

  async recordRecalls(recalls: KnowledgeRecall[]): Promise<void> {
    this.recalls.push(...recalls.map((recall) => structuredClone(recall)));
  }

  async findRecallsByMemory(
    organizationId: OrganizationId,
    memoryId: MemoryId,
    limit: number,
  ): Promise<KnowledgeRecall[]> {
    return this.recalls
      .filter((recall) => recall.organizationId === organizationId && recall.memoryId === memoryId)
      .sort((left, right) => right.recalledAt.getTime() - left.recalledAt.getTime())
      .slice(0, limit);
  }

  async findRecallsByWork(
    organizationId: OrganizationId,
    workId: WorkId,
  ): Promise<KnowledgeRecall[]> {
    return this.recalls
      .filter((recall) => recall.organizationId === organizationId && recall.workId === workId)
      .sort((left, right) => left.rank - right.rank);
  }

  async findRecentRecalls(
    organizationId: OrganizationId,
    limit: number,
  ): Promise<KnowledgeRecall[]> {
    return this.recalls
      .filter((recall) => recall.organizationId === organizationId)
      .sort((left, right) => right.recalledAt.getTime() - left.recalledAt.getTime())
      .slice(0, limit);
  }

  async createConflict(
    conflict: KnowledgeConflict,
  ): Promise<KnowledgeConflict | null> {
    const duplicate = [...this.conflicts.values()].some((existing) =>
      existing.organizationId === conflict.organizationId &&
      existing.status === "open" &&
      samePair(existing, conflict));

    if (duplicate) {
      return null;
    }

    this.conflicts.set(conflict.id, structuredClone(conflict));
    return structuredClone(conflict);
  }

  async findConflictById(
    organizationId: OrganizationId,
    id: KnowledgeConflictId,
  ): Promise<KnowledgeConflict | null> {
    const conflict = this.conflicts.get(id);
    return conflict && conflict.organizationId === organizationId
      ? structuredClone(conflict)
      : null;
  }

  async findConflicts(
    organizationId: OrganizationId,
    query: KnowledgeConflictQuery = {},
  ): Promise<KnowledgeConflict[]> {
    return [...this.conflicts.values()]
      .filter((conflict) =>
        conflict.organizationId === organizationId &&
        (!query.status || conflict.status === query.status) &&
        (!query.memoryId ||
          conflict.memoryId === query.memoryId ||
          conflict.conflictingMemoryId === query.memoryId))
      .sort((left, right) => right.detectedAt.getTime() - left.detectedAt.getTime())
      .slice(0, query.limit ?? 50)
      .map((conflict) => structuredClone(conflict));
  }

  async updateConflict(
    conflict: KnowledgeConflict,
  ): Promise<KnowledgeConflict> {
    const current = this.conflicts.get(conflict.id);

    if (!current || current.organizationId !== conflict.organizationId) {
      throw new Error("Failed to update knowledge conflict: not found");
    }

    this.conflicts.set(conflict.id, structuredClone(conflict));
    return structuredClone(conflict);
  }
}

function matchesQuery(memory: Memory, query: MemoryQuery): boolean {
  if (memory.organizationId !== query.organizationId) return false;
  if (query.agentId && memory.agentId !== query.agentId) return false;
  if (query.workId && memory.workId !== query.workId) return false;
  if (query.taskId && memory.taskId !== query.taskId) return false;
  if (query.artifactId && memory.artifactId !== query.artifactId) return false;
  if (query.scope && memory.scope !== query.scope) return false;
  if (query.type && memory.type !== query.type) return false;
  if (query.types && !query.types.includes(memory.type)) return false;
  if (query.statuses && !query.statuses.includes(memory.status)) return false;
  if (query.workspaceId === null && memory.workspaceId) return false;
  if (query.workspaceId && memory.workspaceId !== query.workspaceId) return false;
  if (query.sourceType && memory.sourceType !== query.sourceType) return false;
  if (query.minImportance !== undefined && memory.importance < query.minImportance) return false;
  if (query.createdAfter && memory.createdAt < query.createdAfter) return false;
  if (query.createdBefore && memory.createdAt > query.createdBefore) return false;
  if (query.contentHash && memory.contentHash !== query.contentHash) return false;
  return true;
}

function inWorkspaceScope(memory: Memory, scope: KnowledgeWorkspaceScope): boolean {
  if (scope.mode === "all") return true;
  if (!memory.workspaceId) return true;
  return scope.mode === "company_and_workspace" && memory.workspaceId === scope.workspaceId;
}

function keywordRank(memory: Memory, terms: string[]): number {
  const text = `${memory.title} ${memory.content}`.toLowerCase();
  const matched = terms.filter((term) => text.includes(term)).length;
  return matched / terms.length;
}

function samePair(left: KnowledgeConflict, right: KnowledgeConflict): boolean {
  return (
    (left.memoryId === right.memoryId && left.conflictingMemoryId === right.conflictingMemoryId) ||
    (left.memoryId === right.conflictingMemoryId && left.conflictingMemoryId === right.memoryId)
  );
}

function cosine(left: number[], right: number[]): number {
  if (left.length === 0 || left.length !== right.length) return 0;

  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;

  for (let index = 0; index < left.length; index += 1) {
    dot += left[index]! * right[index]!;
    leftNorm += left[index]! * left[index]!;
    rightNorm += right[index]! * right[index]!;
  }

  return leftNorm === 0 || rightNorm === 0
    ? 0
    : dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}
