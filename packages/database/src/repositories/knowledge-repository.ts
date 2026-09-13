import type {
  KnowledgeConflict,
  KnowledgeConflictId,
  KnowledgeConflictStatus,
  KnowledgeRecall,
  KnowledgeStatus,
  Memory,
  MemoryId,
  OrganizationId,
  WorkId,
  WorkspaceId,
} from "@unioffice/core";

/**
 * Which knowledge a retrieval is allowed to see, by workspace.
 *
 * all:                   everything in the organization - a person browsing
 *                        the Brain.
 * company:               company-wide knowledge only - work that runs outside
 *                        any workspace.
 * company_and_workspace: company-wide plus one workspace's own - work running
 *                        inside that workspace.
 *
 * There is deliberately no mode that sees a workspace other than the one
 * named. An agent can never be handed another workspace's knowledge by
 * choosing a filter.
 */
export type KnowledgeWorkspaceScope =
  | { mode: "all" }
  | { mode: "company" }
  | { mode: "company_and_workspace"; workspaceId: WorkspaceId };

export interface KnowledgeCandidateQuery {
  organizationId: OrganizationId;

  statuses: KnowledgeStatus[];

  workspace: KnowledgeWorkspaceScope;

  /** The query's embedding, when one could be produced. */
  embedding?: number[];

  /** Pre-sanitized any-word full-text query: "term | term". */
  terms: string;

  /** Upper bound on the pool per retrieval branch. */
  candidateLimit: number;
}

export interface KnowledgeCandidateRow {
  memoryId: MemoryId;

  semanticSimilarity?: number;

  keywordRank: number;
}

/**
 * Retrieval over the knowledge store.
 *
 * Kept apart from MemoryRepository so the plain CRUD contract every existing
 * caller and test double implements stays small, while retrieval can use
 * capabilities - vector search, full-text rank - that only a real store has.
 */
export interface KnowledgeSearchRepository {
  /** A bounded candidate pool, already scoped by tenant, status and workspace. */
  searchCandidates(
    query: KnowledgeCandidateQuery,
  ): Promise<KnowledgeCandidateRow[]>;

  /** Rows by id, never outside the organization named. */
  findByIds(
    organizationId: OrganizationId,
    ids: MemoryId[],
  ): Promise<Memory[]>;

  setEmbedding(
    organizationId: OrganizationId,
    id: MemoryId,
    embedding: number[],
    model: string,
  ): Promise<void>;

  /** Recallable rows that have not been embedded yet, oldest first. */
  findMissingEmbeddings(
    organizationId: OrganizationId,
    limit: number,
  ): Promise<Memory[]>;

  countByStatus(
    organizationId: OrganizationId,
  ): Promise<Record<KnowledgeStatus, number>>;
}

export interface KnowledgeConflictQuery {
  status?: KnowledgeConflictStatus;

  /** Conflicts in which this knowledge takes part, on either side. */
  memoryId?: MemoryId;

  limit?: number;
}

/** How knowledge connects to work and to other knowledge. */
export interface KnowledgeLinkRepository {
  recordRecalls(recalls: KnowledgeRecall[]): Promise<void>;

  findRecallsByMemory(
    organizationId: OrganizationId,
    memoryId: MemoryId,
    limit: number,
  ): Promise<KnowledgeRecall[]>;

  findRecallsByWork(
    organizationId: OrganizationId,
    workId: WorkId,
  ): Promise<KnowledgeRecall[]>;

  findRecentRecalls(
    organizationId: OrganizationId,
    limit: number,
  ): Promise<KnowledgeRecall[]>;

  /**
   * Records a conflict. Returns null when this pair already has an open one,
   * so detection can run repeatedly without piling up duplicates.
   */
  createConflict(
    conflict: KnowledgeConflict,
  ): Promise<KnowledgeConflict | null>;

  findConflictById(
    organizationId: OrganizationId,
    id: KnowledgeConflictId,
  ): Promise<KnowledgeConflict | null>;

  findConflicts(
    organizationId: OrganizationId,
    query?: KnowledgeConflictQuery,
  ): Promise<KnowledgeConflict[]>;

  updateConflict(
    conflict: KnowledgeConflict,
  ): Promise<KnowledgeConflict>;
}
