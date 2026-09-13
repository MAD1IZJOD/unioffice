import {
  createEntityId,
  KNOWLEDGE_TYPES,
  type Agent,
  type AgentId,
  type ArtifactId,
  type KnowledgeConflict,
  type KnowledgeConflictId,
  type KnowledgeRecall,
  type KnowledgeSourceType,
  type KnowledgeStatus,
  type Memory,
  type MemoryId,
  type MemoryType,
  type OrganizationId,
  type WorkId,
  type WorkspaceId,
} from "@unioffice/core";

import type {
  AgentRepository,
  ArtifactRepository,
  KnowledgeLinkRepository,
  KnowledgeSearchRepository,
  MemoryRepository,
  TaskRepository,
  WorkRepository,
  WorkspaceRepository,
} from "@unioffice/database";

import {
  detectInstructionSignals,
  freshnessOf,
  knowledgeContentHash,
  sanitizeKnowledgeText,
} from "@unioffice/memory";

import type { EventRecorder } from "./event-recorder.js";
import type { CaptureReport, KnowledgeCaptureService } from "./knowledge-capture-service.js";
import type { KnowledgeRecallService, RecallResult } from "./knowledge-recall-service.js";

/**
 * The Company Brain: what the company knows, where it came from, and what it
 * is being used for.
 *
 * This is the service behind the Brain surface and the knowledge API. It does
 * not retrieve or write knowledge by a route of its own - recall and capture
 * each have exactly one path, shared with execution - so what a person sees
 * here is what the agents actually get.
 *
 * Every lookup by id is checked against the caller's organization and a
 * mismatch reads as "not found", the same shape every other scoped read in
 * the API uses.
 */

export class KnowledgeNotFoundError extends Error {
  constructor(message = "Knowledge not found.") {
    super(message);
    this.name = "KnowledgeNotFoundError";
  }
}

export class KnowledgeValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KnowledgeValidationError";
  }
}

export class KnowledgeStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KnowledgeStateError";
  }
}

export interface KnowledgeSearchInput {
  query?: string;
  types?: MemoryType[];
  statuses?: KnowledgeStatus[];
  /** A workspace id narrows to that workspace; null to company-wide only. */
  workspaceId?: WorkspaceId | null;
  sourceType?: KnowledgeSourceType;
  minImportance?: number;
  createdAfter?: Date;
  createdBefore?: Date;
  limit?: number;
  offset?: number;
}

export interface KnowledgeSearchResult {
  knowledge: Memory;
  /** 0-1, only when the search had a query to be relevant to. */
  relevance?: number;
  reasons: string[];
  stale: boolean;
  ageDays: number;
  flagged: boolean;
}

export interface CreateKnowledgeInput {
  organizationId: OrganizationId;
  title: string;
  content: string;
  type: MemoryType;
  importance?: number;
  confidence?: number;
  workspaceId?: WorkspaceId;
  createdBy: string;
}

export interface UpdateKnowledgeInput {
  organizationId: OrganizationId;
  knowledgeId: MemoryId;
  title?: string;
  content?: string;
  type?: MemoryType;
  importance?: number;
  /** null clears the confidence. */
  confidence?: number | null;
  /** null makes it company-wide. */
  workspaceId?: WorkspaceId | null;
  updatedBy: string;
}

export type ConflictResolution =
  | { kind: "keep"; keepId: MemoryId }
  | { kind: "both_hold" }
  | { kind: "dismiss" };

const MAX_TITLE_CHARS = 160;
const MAX_CONTENT_CHARS = 4_000;
const MAX_PAGE = 50;
const MAX_OFFSET = 1_000;

export class CompanyBrainService {
  constructor(
    private readonly memories: MemoryRepository & KnowledgeSearchRepository,
    private readonly links: KnowledgeLinkRepository,
    private readonly recall: KnowledgeRecallService,
    private readonly capture: KnowledgeCaptureService,
    private readonly eventRecorder: EventRecorder,
    private readonly workRepository: WorkRepository,
    private readonly taskRepository: TaskRepository,
    private readonly artifactRepository: ArtifactRepository,
    private readonly workspaceRepository: WorkspaceRepository,
    private readonly agentRepository: AgentRepository,
    private readonly embeddingModel?: string,
  ) {}

  /* ----------------------------------------------------------------------
     Reading
     ---------------------------------------------------------------------- */

  async search(
    organizationId: OrganizationId,
    input: KnowledgeSearchInput,
  ): Promise<{ mode: "relevance" | "recent"; items: KnowledgeSearchResult[] }> {
    if (input.workspaceId) {
      await this.requireWorkspace(organizationId, input.workspaceId);
    }

    const limit = Math.min(Math.max(input.limit ?? 20, 1), MAX_PAGE);
    const offset = Math.min(Math.max(input.offset ?? 0, 0), MAX_OFFSET);
    const statuses = input.statuses?.length ? input.statuses : (["active", "proposed"] as KnowledgeStatus[]);
    const query = input.query?.trim();

    if (!query) {
      const rows = await this.memories.query({
        organizationId,
        types: input.types,
        statuses,
        workspaceId: input.workspaceId,
        sourceType: input.sourceType,
        minImportance: input.minImportance,
        createdAfter: input.createdAfter,
        createdBefore: input.createdBefore,
        limit,
        offset,
      });

      const now = new Date();

      return {
        mode: "recent",
        items: rows.map((knowledge) => {
          const freshness = freshnessOf(knowledge, now);
          return {
            knowledge,
            reasons: [],
            stale: freshness.stale,
            ageDays: freshness.ageDays,
            flagged: detectInstructionSignals(`${knowledge.title}\n${knowledge.content}`).length > 0,
          };
        }),
      };
    }

    // Relevance search ranks a bounded pool, then applies the remaining
    // filters. A person browsing sees the whole organization; the workspace
    // filter narrows what is shown, it is not the recall boundary agents get.
    const ranked = await this.recall.search({
      organizationId,
      text: query,
      workspace: { mode: "all" },
      statuses,
      workspaceId: input.workspaceId ?? undefined,
      limit: MAX_PAGE,
    });

    const filtered = ranked.filter(({ memory }) =>
      (!input.types?.length || input.types.includes(memory.type)) &&
      (input.workspaceId === undefined ||
        (input.workspaceId === null ? !memory.workspaceId : memory.workspaceId === input.workspaceId)) &&
      (!input.sourceType || memory.sourceType === input.sourceType) &&
      (input.minImportance === undefined || memory.importance >= input.minImportance) &&
      (!input.createdAfter || memory.createdAt >= input.createdAfter) &&
      (!input.createdBefore || memory.createdAt <= input.createdBefore));

    return {
      mode: "relevance",
      items: filtered.slice(offset, offset + limit).map((entry) => ({
        knowledge: entry.memory,
        relevance: Math.round(entry.score * 1_000) / 1_000,
        reasons: entry.reasons,
        stale: entry.stale,
        ageDays: entry.ageDays,
        flagged: detectInstructionSignals(`${entry.memory.title}\n${entry.memory.content}`).length > 0,
      })),
    };
  }

  /** The Brain's opening: what the company knows, learned, uses and disputes. */
  async getOverview(organizationId: OrganizationId) {
    const [counts, recentlyLearned, awaitingReview, important, recentRecalls, openConflicts, archived, sample] =
      await Promise.all([
        this.memories.countByStatus(organizationId),
        this.memories.query({ organizationId, statuses: ["active", "proposed"], limit: 8 }),
        this.memories.query({ organizationId, statuses: ["proposed"], limit: 8 }),
        this.memories.query({ organizationId, statuses: ["active"], minImportance: 0.7, limit: 8 }),
        this.links.findRecentRecalls(organizationId, 300),
        this.links.findConflicts(organizationId, { status: "open", limit: 10 }),
        this.memories.query({ organizationId, statuses: ["archived"], limit: 5 }),
        this.memories.query({ organizationId, statuses: ["active", "proposed"], limit: 200 }),
      ]);

    const usage = new Map<MemoryId, { count: number; works: Set<string>; lastRecalledAt: Date }>();

    for (const recall of recentRecalls) {
      const entry = usage.get(recall.memoryId) ?? { count: 0, works: new Set<string>(), lastRecalledAt: recall.recalledAt };
      entry.count += 1;
      if (recall.workId) entry.works.add(recall.workId);
      if (recall.recalledAt > entry.lastRecalledAt) entry.lastRecalledAt = recall.recalledAt;
      usage.set(recall.memoryId, entry);
    }

    const mostUsedIds = [...usage.entries()]
      .sort((left, right) => right[1].count - left[1].count || right[1].lastRecalledAt.getTime() - left[1].lastRecalledAt.getTime())
      .slice(0, 8)
      .map(([id]) => id);

    const conflictSideIds = openConflicts.flatMap((conflict) => [conflict.memoryId, conflict.conflictingMemoryId]);

    const [usedRows, conflictRows] = await Promise.all([
      this.memories.findByIds(organizationId, mostUsedIds),
      this.memories.findByIds(organizationId, conflictSideIds),
    ]);

    const usedById = new Map(usedRows.map((row) => [row.id, row]));
    const conflictById = new Map(conflictRows.map((row) => [row.id, row]));

    const byType: Partial<Record<MemoryType, number>> = {};
    for (const row of sample) byType[row.type] = (byType[row.type] ?? 0) + 1;

    const now = new Date();

    return {
      organizationId,
      generatedAt: now,
      counts: {
        ...counts,
        openConflicts: openConflicts.length,
        missionsInformed: new Set(recentRecalls.flatMap((recall) => (recall.workId ? [recall.workId] : []))).size,
        recallsRecorded: recentRecalls.length,
        stale: sample.filter((row) => freshnessOf(row, now).stale).length,
      },
      byType,
      /** byType is counted over at most this many of the newest recallable rows. */
      byTypeSampleSize: sample.length,
      recentlyLearned,
      awaitingReview,
      important,
      inUse: mostUsedIds.flatMap((id) => {
        const knowledge = usedById.get(id);
        const entry = usage.get(id)!;
        return knowledge
          ? [{ knowledge, recallCount: entry.count, missionCount: entry.works.size, lastRecalledAt: entry.lastRecalledAt }]
          : [];
      }),
      conflicts: openConflicts.flatMap((conflict) => {
        const left = conflictById.get(conflict.memoryId);
        const right = conflictById.get(conflict.conflictingMemoryId);
        return left && right ? [{ conflict, left, right }] : [];
      }),
      archived,
      retrieval: {
        semantic: Boolean(this.embeddingModel),
        embeddingModel: this.embeddingModel,
      },
    };
  }

  async getDetail(organizationId: OrganizationId, knowledgeId: MemoryId) {
    const knowledge = await this.requireKnowledge(organizationId, knowledgeId);
    const now = new Date();

    const [work, task, artifact, agent, workspace, recalls, conflicts, sameMission, sameArtifact, similar, supersedes] =
      await Promise.all([
        knowledge.workId ? this.workRepository.findById(knowledge.workId) : null,
        knowledge.taskId ? this.taskRepository.findById(knowledge.taskId) : null,
        knowledge.artifactId ? this.artifactRepository.findById(knowledge.artifactId) : null,
        knowledge.agentId ? this.agentRepository.findById(knowledge.agentId) : null,
        knowledge.workspaceId ? this.workspaceRepository.findById(knowledge.workspaceId) : null,
        this.links.findRecallsByMemory(organizationId, knowledge.id, 100),
        this.links.findConflicts(organizationId, { memoryId: knowledge.id, limit: 20 }),
        knowledge.workId
          ? this.memories.query({ organizationId, workId: knowledge.workId, limit: 11 })
          : Promise.resolve([]),
        knowledge.artifactId
          ? this.memories.query({ organizationId, artifactId: knowledge.artifactId, limit: 11 })
          : Promise.resolve([]),
        this.recall.search({
          organizationId,
          text: `${knowledge.title}\n${knowledge.content}`,
          workspace: { mode: "all" },
          statuses: ["active", "proposed"],
          limit: 7,
        }),
        knowledge.supersedesId ? this.memories.findByIds(organizationId, [knowledge.supersedesId]) : Promise.resolve([]),
      ]);

    // Every referenced row is confirmed to belong to this organization before
    // it is named. A reference that fails the check is simply not shown.
    const ownWork = work && work.organizationId === organizationId ? work : undefined;
    const ownTask = task && ownWork && task.workId === ownWork.id ? task : undefined;
    const ownArtifact = artifact && artifact.organizationId === organizationId ? artifact : undefined;
    const ownAgent = agent && agent.organizationId === organizationId ? agent : undefined;
    const ownWorkspace = workspace && workspace.organizationId === organizationId ? workspace : undefined;

    const usage = await this.describeUsage(organizationId, recalls);

    const counterpartIds = conflicts.map((conflict) =>
      conflict.memoryId === knowledge.id ? conflict.conflictingMemoryId : conflict.memoryId);
    const counterparts = new Map(
      (await this.memories.findByIds(organizationId, counterpartIds)).map((row) => [row.id, row]),
    );

    const freshness = freshnessOf(knowledge, now);
    const supersededById = typeof knowledge.metadata.supersededById === "string"
      ? (knowledge.metadata.supersededById as MemoryId)
      : undefined;
    const supersededBy = supersededById
      ? (await this.memories.findByIds(organizationId, [supersededById]))[0]
      : undefined;
    const mergedIntoId = typeof knowledge.metadata.mergedIntoId === "string"
      ? (knowledge.metadata.mergedIntoId as MemoryId)
      : undefined;
    const mergedInto = mergedIntoId
      ? (await this.memories.findByIds(organizationId, [mergedIntoId]))[0]
      : undefined;

    // Other missions that arrived at this knowledge, as merges recorded them.
    // A mission is named only when it is confirmed to be this organization's.
    const confirmations = await Promise.all(
      reinforcementsOf(knowledge).map(async (entry) => {
        const confirmingWork = typeof entry.workId === "string"
          ? await this.workRepository.findById(entry.workId as WorkId)
          : null;

        return {
          mission: confirmingWork && confirmingWork.organizationId === organizationId
            ? { id: confirmingWork.id, objective: confirmingWork.objective }
            : undefined,
          wording: typeof entry.title === "string" ? entry.title : undefined,
          mergedAt: typeof entry.mergedAt === "string" ? entry.mergedAt : undefined,
        };
      }),
    );

    return {
      knowledge,
      freshness: {
        ageDays: Math.round(freshness.ageDays),
        stale: freshness.stale,
        horizonDays: freshness.horizonDays,
      },
      flags: detectInstructionSignals(`${knowledge.title}\n${knowledge.content}`),
      provenance: {
        sourceType: knowledge.sourceType,
        createdBy: knowledge.createdBy,
        reviewedBy: knowledge.reviewedBy,
        reviewedAt: knowledge.reviewedAt,
        mission: ownWork ? { id: ownWork.id, objective: ownWork.objective, status: ownWork.status, createdAt: ownWork.createdAt } : undefined,
        task: ownTask ? { id: ownTask.id, title: ownTask.title, status: ownTask.status } : undefined,
        artifact: ownArtifact ? { id: ownArtifact.id, name: ownArtifact.name, type: ownArtifact.type } : undefined,
        agent: ownAgent ? { id: ownAgent.id, name: ownAgent.name, capabilities: ownAgent.capabilities } : undefined,
        workspace: ownWorkspace ? { id: ownWorkspace.id, name: ownWorkspace.name } : undefined,
        extraction: knowledge.metadata.extraction,
      },
      related: {
        sameMission: sameMission.filter((row) => row.id !== knowledge.id).slice(0, 10),
        sameArtifact: sameArtifact.filter((row) => row.id !== knowledge.id).slice(0, 10),
        similar: similar
          .filter((entry) => entry.memory.id !== knowledge.id)
          .slice(0, 6)
          .map((entry) => ({ knowledge: entry.memory, relevance: Math.round(entry.score * 1_000) / 1_000, reasons: entry.reasons })),
        supersedes: supersedes[0],
        supersededBy,
        mergedInto,
      },
      confirmations,
      usage,
      conflicts: conflicts.map((conflict) => ({
        conflict,
        counterpart: counterparts.get(
          conflict.memoryId === knowledge.id ? conflict.conflictingMemoryId : conflict.memoryId,
        ),
      })),
    };
  }

  /** What one mission learned, and what it was given. */
  async getMissionKnowledge(organizationId: OrganizationId, workId: WorkId) {
    const [learned, recalls] = await Promise.all([
      this.memories.query({ organizationId, workId, limit: 50 }),
      this.links.findRecallsByWork(organizationId, workId),
    ]);

    const rows = new Map(
      (await this.memories.findByIds(organizationId, [...new Set(recalls.map((recall) => recall.memoryId))]))
        .map((row) => [row.id, row]),
    );

    const used = new Map<MemoryId, {
      knowledge: Memory;
      stages: Set<string>;
      taskIds: Set<string>;
      agentIds: Set<string>;
      bestRank: number;
      reasons: string[];
    }>();

    for (const recall of recalls) {
      const knowledge = rows.get(recall.memoryId);
      if (!knowledge) continue;

      const entry = used.get(recall.memoryId) ?? {
        knowledge,
        stages: new Set<string>(),
        taskIds: new Set<string>(),
        agentIds: new Set<string>(),
        bestRank: recall.rank,
        reasons: recall.reasons,
      };

      entry.stages.add(recall.stage);
      if (recall.taskId) entry.taskIds.add(recall.taskId);
      if (recall.agentId) entry.agentIds.add(recall.agentId);
      if (recall.rank < entry.bestRank) {
        entry.bestRank = recall.rank;
        entry.reasons = recall.reasons;
      }

      used.set(recall.memoryId, entry);
    }

    return {
      learned,
      used: [...used.values()]
        .sort((left, right) => left.bestRank - right.bestRank)
        .map((entry) => ({
          knowledge: entry.knowledge,
          stages: [...entry.stages],
          taskIds: [...entry.taskIds],
          agentIds: [...entry.agentIds],
          reasons: entry.reasons,
          // Knowledge from this same mission is "used" only if a later step
          // recalled what an earlier step learned - worth telling apart.
          fromThisMission: entry.knowledge.workId === workId,
        })),
      review: await this.debrief(organizationId, workId, learned),
    };
  }

  /**
   * The mission debrief: each thing the mission taught the company, the
   * evidence it rests on, what became of it, and - while nobody has decided -
   * how it stands against what the company already knows.
   *
   * Every relation shown is computed, never asserted: "restates" is a measured
   * embedding similarity (or an identical title when nothing is embedded),
   * "contradicts" is a detected open conflict. A person makes the decision;
   * the debrief only puts it in front of them where the evidence is.
   */
  private async debrief(
    organizationId: OrganizationId,
    workId: WorkId,
    learned: Memory[],
  ): Promise<MissionDebriefItem[]> {
    // The raw per-task trace from before knowledge existed is not something
    // anyone is asked to review.
    const items = learned
      .filter((memory) => memory.type !== "experience")
      .slice(0, MAX_DEBRIEF_ITEMS);

    if (items.length === 0) {
      return [];
    }

    const linkedIds = items.flatMap((memory) =>
      [memory.metadata.mergedIntoId, memory.metadata.supersededById, memory.supersedesId]
        .filter((id): id is MemoryId => typeof id === "string"));
    const linked = new Map(
      (await this.memories.findByIds(organizationId, linkedIds)).map((row) => [row.id, row]),
    );
    const titled = (id: unknown) => {
      const row = typeof id === "string" ? linked.get(id as MemoryId) : undefined;
      return row ? { id: row.id, title: row.title, status: row.status } : undefined;
    };

    const review: MissionDebriefItem[] = [];

    for (const memory of items) {
      const outcome = outcomeOf(memory);

      review.push({
        knowledge: memory,
        outcome,
        mergedInto: titled(memory.metadata.mergedIntoId),
        replacedBy: titled(memory.metadata.supersededById),
        replaces: titled(memory.supersedesId),
        evidence: await this.evidenceOf(organizationId, workId, memory),
        related: outcome === "pending" ? await this.relationsOf(organizationId, memory) : [],
      });
    }

    return review;
  }

  private async evidenceOf(
    organizationId: OrganizationId,
    workId: WorkId,
    memory: Memory,
  ): Promise<MissionDebriefItem["evidence"]> {
    const [task, agent, artifact] = await Promise.all([
      memory.taskId ? this.taskRepository.findById(memory.taskId) : null,
      memory.agentId ? this.agentRepository.findById(memory.agentId) : null,
      memory.artifactId ? this.artifactRepository.findById(memory.artifactId) : null,
    ]);

    const extraction = memory.metadata.extraction as { rationale?: unknown } | undefined;

    // Named only when the referenced row is confirmed to be this mission's or
    // this organization's; a reference that fails the check is left out.
    return {
      task: task && task.workId === workId ? { id: task.id, title: task.title } : undefined,
      agent: agent && agent.organizationId === organizationId ? { id: agent.id, name: agent.name } : undefined,
      artifact: artifact && artifact.organizationId === organizationId ? { id: artifact.id, name: artifact.name } : undefined,
      rationale:
        typeof extraction?.rationale === "string" && extraction.rationale.trim()
          ? extraction.rationale
          : undefined,
    };
  }

  private async relationsOf(organizationId: OrganizationId, memory: Memory): Promise<MissionDebriefRelation[]> {
    const [conflicts, ranked] = await Promise.all([
      this.links.findConflicts(organizationId, { status: "open", memoryId: memory.id, limit: 5 }),
      this.recall.search({
        organizationId,
        text: `${memory.title}\n${memory.content}`,
        workspace: { mode: "all" },
        statuses: ["active", "proposed"],
        workspaceId: memory.workspaceId,
        limit: 8,
      }),
    ]);

    const contradictingIds = new Set(conflicts.map((conflict) =>
      conflict.memoryId === memory.id ? conflict.conflictingMemoryId : conflict.memoryId));

    const contradicting = (await this.memories.findByIds(organizationId, [...contradictingIds]))
      .filter((other) => other.status !== "archived" && visibleTogether(memory, other))
      .map((other): MissionDebriefRelation => ({
        knowledge: other,
        relation: "contradicts",
        canMerge: false,
      }));

    const title = normalizedTitle(memory.title);
    const restating: MissionDebriefRelation[] = [];
    const related: MissionDebriefRelation[] = [];

    for (const entry of ranked) {
      const other = entry.memory;

      if (other.id === memory.id || contradictingIds.has(other.id) || !visibleTogether(memory, other)) {
        continue;
      }

      // Recall lets a shared keyword qualify on its own; a person reviewing a
      // lesson is not shown a note as "related" when the measured similarity
      // says it is about something else.
      if (entry.similarity !== undefined && entry.similarity < RELATED_SIMILARITY) {
        continue;
      }

      const restates = entry.similarity !== undefined
        ? entry.similarity >= RESTATEMENT_SIMILARITY
        : normalizedTitle(other.title) === title;

      const relation: MissionDebriefRelation = {
        knowledge: other,
        relation: restates ? "restates" : "related",
        similarity: entry.similarity === undefined ? undefined : Math.round(entry.similarity * 100) / 100,
        // The same rule mergeKnowledge enforces, so the page never offers a
        // merge the service would refuse.
        canMerge: !other.workspaceId || other.workspaceId === memory.workspaceId,
      };

      (restates ? restating : related).push(relation);
    }

    return [...contradicting, ...restating, ...related.slice(0, MAX_RELATED)].slice(0, MAX_RELATIONS);
  }

  /** Exactly what an agent would be handed for this text, not recorded. */
  async previewRecall(
    organizationId: OrganizationId,
    input: { query: string; workspaceId?: WorkspaceId; agentId?: AgentId },
  ): Promise<RecallResult> {
    if (input.workspaceId) await this.requireWorkspace(organizationId, input.workspaceId);

    let agent: Agent | undefined;

    if (input.agentId) {
      const found = await this.agentRepository.findById(input.agentId);
      if (!found || found.organizationId !== organizationId) {
        throw new KnowledgeNotFoundError("Agent not found.");
      }
      agent = found;
    }

    return this.recall.previewRecall({
      organizationId,
      text: input.query,
      workspaceId: input.workspaceId,
      agent,
    });
  }

  /* ----------------------------------------------------------------------
     Writing
     ---------------------------------------------------------------------- */

  async createKnowledge(input: CreateKnowledgeInput): Promise<Memory> {
    if (input.workspaceId) await this.requireWorkspace(input.organizationId, input.workspaceId);

    const title = this.validTitle(input.title);
    const content = this.validContent(input.content);
    const type = this.validType(input.type);
    const contentHash = knowledgeContentHash(content);

    const duplicate = await this.memories.query({
      organizationId: input.organizationId,
      contentHash,
      statuses: ["proposed", "active"],
      limit: 1,
    });

    if (duplicate.length > 0) {
      throw new KnowledgeStateError("The company already records this knowledge.");
    }

    const flags = detectInstructionSignals(`${title}\n${content}`);
    const now = new Date();

    return this.capture.persist(
      {
        id: createEntityId<"MemoryId">() as MemoryId,
        organizationId: input.organizationId,
        workspaceId: input.workspaceId,
        scope: "company",
        type,
        // A person writing knowledge is vouching for it, so it is active from
        // the start - except when it reads like an instruction to an AI, which
        // waits for a second look however it arrived.
        status: flags.length > 0 ? "proposed" : "active",
        title,
        content,
        sourceType: "user",
        importance: bounded(input.importance, 0.5),
        confidence: input.confidence === undefined ? undefined : bounded(input.confidence, 0.5),
        createdBy: input.createdBy,
        contentHash,
        createdAt: now,
        updatedAt: now,
        metadata: flags.length > 0 ? { safety: { instructionSignals: flags } } : {},
      },
      {
        actorType: "user",
        actorId: input.createdBy,
        reason: flags.length > 0
          ? "Held as a proposal: the text is phrased as instructions to an AI."
          : "Written by a person.",
      },
    );
  }

  async updateKnowledge(input: UpdateKnowledgeInput): Promise<Memory> {
    const current = await this.requireKnowledge(input.organizationId, input.knowledgeId);

    if (current.status === "archived") {
      throw new KnowledgeStateError("Archived knowledge cannot be changed. Restore it first.");
    }

    if (input.workspaceId) await this.requireWorkspace(input.organizationId, input.workspaceId);

    const title = input.title === undefined ? current.title : this.validTitle(input.title);
    const content = input.content === undefined ? current.content : this.validContent(input.content);
    const type = input.type === undefined ? current.type : this.validType(input.type);

    const changed: string[] = [];
    if (title !== current.title) changed.push("title");
    if (content !== current.content) changed.push("content");
    if (type !== current.type) changed.push("type");
    if (input.importance !== undefined && input.importance !== current.importance) changed.push("importance");
    if (input.confidence !== undefined && input.confidence !== current.confidence) changed.push("confidence");
    if (input.workspaceId !== undefined && (input.workspaceId ?? undefined) !== current.workspaceId) changed.push("workspace");

    if (changed.length === 0) {
      return current;
    }

    const updated = await this.memories.update({
      ...current,
      title,
      content,
      type,
      importance: input.importance === undefined ? current.importance : bounded(input.importance, current.importance),
      confidence:
        input.confidence === undefined
          ? current.confidence
          : input.confidence === null ? undefined : bounded(input.confidence, 0.5),
      workspaceId: input.workspaceId === undefined ? current.workspaceId : (input.workspaceId ?? undefined),
      contentHash: knowledgeContentHash(content),
      updatedAt: new Date(),
    });

    await this.eventRecorder.record({
      organizationId: updated.organizationId,
      workId: updated.workId,
      actorType: "user",
      actorId: input.updatedBy,
      type: "knowledge.updated",
      payload: { knowledgeId: updated.id, title: updated.title, changed },
    });

    if (changed.includes("title") || changed.includes("content")) {
      await this.capture.index(updated);
    }

    return updated;
  }

  /**
   * A person vouches for knowledge. A proposal becomes active; knowledge that
   * was already active is re-confirmed, which is what keeps it from reading as
   * stale.
   */
  async approveKnowledge(organizationId: OrganizationId, knowledgeId: MemoryId, reviewer: string): Promise<Memory> {
    const current = await this.requireKnowledge(organizationId, knowledgeId);

    if (current.status === "archived") {
      throw new KnowledgeStateError("Archived knowledge cannot be approved. Restore it first.");
    }

    const now = new Date();
    const approved = await this.memories.update({
      ...current,
      status: "active",
      reviewedBy: reviewer,
      reviewedAt: now,
      updatedAt: now,
    });

    await this.eventRecorder.record({
      organizationId,
      workId: approved.workId,
      actorType: "user",
      actorId: reviewer,
      type: "knowledge.approved",
      payload: {
        knowledgeId: approved.id,
        title: approved.title,
        previousStatus: current.status,
      },
    });

    return approved;
  }

  async archiveKnowledge(
    organizationId: OrganizationId,
    knowledgeId: MemoryId,
    input: { by: string; reason?: string; supersededById?: MemoryId; mergedIntoId?: MemoryId },
  ): Promise<Memory> {
    const current = await this.requireKnowledge(organizationId, knowledgeId);

    if (current.status === "archived") {
      return current;
    }

    const now = new Date();
    const archived = await this.memories.update({
      ...current,
      status: "archived",
      archivedAt: now,
      updatedAt: now,
      metadata: {
        ...current.metadata,
        archivedReason: input.reason,
        archivedBy: input.by,
        ...(input.supersededById ? { supersededById: input.supersededById } : {}),
        ...(input.mergedIntoId ? { mergedIntoId: input.mergedIntoId } : {}),
      },
    });

    await this.eventRecorder.record({
      organizationId,
      workId: archived.workId,
      actorType: "user",
      actorId: input.by,
      type: "knowledge.archived",
      payload: {
        knowledgeId: archived.id,
        title: archived.title,
        reason: input.reason,
        supersededById: input.supersededById,
      },
    });

    // A disagreement with knowledge that is no longer current is settled.
    const open = await this.links.findConflicts(organizationId, { status: "open", memoryId: archived.id });

    for (const conflict of open) {
      await this.closeConflict(conflict, "resolved", "One side was archived.", input.by);
    }

    return archived;
  }

  /** Archived knowledge comes back as a proposal, so it is looked at again. */
  async restoreKnowledge(organizationId: OrganizationId, knowledgeId: MemoryId, by: string): Promise<Memory> {
    const current = await this.requireKnowledge(organizationId, knowledgeId);

    if (current.status !== "archived") {
      throw new KnowledgeStateError("Only archived knowledge can be restored.");
    }

    const restored = await this.memories.update({
      ...current,
      status: "proposed",
      archivedAt: undefined,
      reviewedAt: undefined,
      reviewedBy: undefined,
      updatedAt: new Date(),
    });

    await this.eventRecorder.record({
      organizationId,
      workId: restored.workId,
      actorType: "user",
      actorId: by,
      type: "knowledge.restored",
      payload: { knowledgeId: restored.id, title: restored.title },
    });

    await this.capture.index(restored);

    return restored;
  }

  /**
   * Settles a conflict the way a person chose. Nothing here picks a winner on
   * its own: "keep" names the side to keep, and the other is archived as
   * superseded rather than deleted, so the history of what the company used
   * to believe survives.
   */
  async resolveConflict(
    organizationId: OrganizationId,
    conflictId: KnowledgeConflictId,
    resolution: ConflictResolution,
    by: string,
    note?: string,
  ): Promise<KnowledgeConflict> {
    const conflict = await this.links.findConflictById(organizationId, conflictId);

    if (!conflict) {
      throw new KnowledgeNotFoundError("Conflict not found.");
    }

    if (conflict.status !== "open") {
      throw new KnowledgeStateError("This conflict has already been settled.");
    }

    if (resolution.kind === "dismiss") {
      return this.closeConflict(conflict, "dismissed", note ?? "Not a real disagreement.", by);
    }

    if (resolution.kind === "both_hold") {
      return this.closeConflict(conflict, "resolved", note ?? "Both hold, in different circumstances.", by);
    }

    const sides = [conflict.memoryId, conflict.conflictingMemoryId];

    if (!sides.includes(resolution.keepId)) {
      throw new KnowledgeValidationError("keepId must be one side of the conflict.");
    }

    const dropId = sides.find((id) => id !== resolution.keepId)!;
    const kept = await this.requireKnowledge(organizationId, resolution.keepId);
    const dropped = await this.requireKnowledge(organizationId, dropId);

    const closed = await this.closeConflict(conflict, "resolved", note ?? "Kept one side; the other was superseded.", by);

    await this.replace(kept, dropped, by, `Superseded by “${kept.title}” when a conflict was resolved.`);

    return closed;
  }

  /**
   * A person says two entries are the same knowledge.
   *
   * The duplicate is archived and the entry it restates is re-confirmed, with
   * the duplicate's mission recorded against it - so knowledge that several
   * missions arrived at independently says so, instead of being recalled four
   * times in four wordings. Nothing is deleted.
   */
  async mergeKnowledge(
    organizationId: OrganizationId,
    duplicateId: MemoryId,
    intoId: MemoryId,
    by: string,
  ): Promise<{ kept: Memory; merged: Memory }> {
    if (duplicateId === intoId) {
      throw new KnowledgeValidationError("Knowledge cannot be merged into itself.");
    }

    const duplicate = await this.requireKnowledge(organizationId, duplicateId);
    const target = await this.requireKnowledge(organizationId, intoId);

    if (duplicate.status === "archived" || target.status === "archived") {
      throw new KnowledgeStateError("Archived knowledge cannot be merged. Restore it first.");
    }

    // Merging must never narrow where knowledge applies: company-wide knowledge
    // folded into an entry that only one workspace can see would quietly
    // disappear from every other workspace's work.
    if (target.workspaceId && target.workspaceId !== duplicate.workspaceId) {
      throw new KnowledgeValidationError(
        "This knowledge applies more widely than the entry it would be merged into. Replace it instead, or widen that entry first.",
      );
    }

    const now = new Date();
    const reinforcements = [
      ...reinforcementsOf(target),
      {
        knowledgeId: duplicate.id,
        workId: duplicate.workId,
        taskId: duplicate.taskId,
        title: duplicate.title,
        mergedAt: now.toISOString(),
        mergedBy: by,
      },
    ].slice(-MAX_REINFORCEMENTS);

    const kept = await this.memories.update({
      ...target,
      status: "active",
      reviewedBy: by,
      reviewedAt: now,
      updatedAt: now,
      metadata: { ...target.metadata, reinforcements },
    });

    const merged = await this.archiveKnowledge(organizationId, duplicate.id, {
      by,
      reason: `Merged into “${kept.title}”: it says the same thing.`,
      mergedIntoId: kept.id,
    });

    await this.eventRecorder.record({
      organizationId,
      workId: duplicate.workId,
      actorType: "user",
      actorId: by,
      type: "knowledge.merged",
      payload: {
        knowledgeId: kept.id,
        title: kept.title,
        mergedKnowledgeId: merged.id,
        mergedTitle: merged.title,
        confirmations: reinforcements.length,
      },
    });

    return { kept, merged };
  }

  /**
   * A person says newer knowledge replaces older knowledge - a decision that
   * was revisited, a process that changed. The newer entry becomes current and
   * names what it replaced; the older one is archived as history, never lost.
   */
  async supersedeKnowledge(
    organizationId: OrganizationId,
    newerId: MemoryId,
    olderId: MemoryId,
    by: string,
    note?: string,
  ): Promise<{ current: Memory; replaced: Memory }> {
    if (newerId === olderId) {
      throw new KnowledgeValidationError("Knowledge cannot replace itself.");
    }

    const newer = await this.requireKnowledge(organizationId, newerId);
    const older = await this.requireKnowledge(organizationId, olderId);

    if (newer.status === "archived" || older.status === "archived") {
      throw new KnowledgeStateError("Archived knowledge cannot replace or be replaced. Restore it first.");
    }

    // Only knowledge that can be recalled into the same work can stand in for
    // each other; one workspace's entry never retires another workspace's.
    if (newer.workspaceId && older.workspaceId && newer.workspaceId !== older.workspaceId) {
      throw new KnowledgeValidationError("Knowledge from different workspaces cannot replace one another.");
    }

    return this.replace(newer, older, by, note ?? `Replaced by “${newer.title}”.`);
  }

  async deriveFromArtifact(
    organizationId: OrganizationId,
    artifactId: ArtifactId,
    requestedBy: string,
  ): Promise<CaptureReport> {
    const artifact = await this.artifactRepository.findById(artifactId);

    if (!artifact || artifact.organizationId !== organizationId) {
      throw new KnowledgeNotFoundError("Artifact not found.");
    }

    if (artifact.metadata.content === undefined) {
      throw new KnowledgeStateError("This artifact has no stored content to learn from.");
    }

    const work = artifact.workId ? await this.workRepository.findById(artifact.workId) : null;

    return this.capture.captureFromArtifact({
      artifact,
      work: work && work.organizationId === organizationId ? work : undefined,
      requestedBy,
    });
  }

  /* ----------------------------------------------------------------------
     Internals
     ---------------------------------------------------------------------- */

  private async closeConflict(
    conflict: KnowledgeConflict,
    status: "resolved" | "dismissed",
    resolution: string,
    by: string,
  ): Promise<KnowledgeConflict> {
    const closed = await this.links.updateConflict({
      ...conflict,
      status,
      resolution,
      resolvedBy: by,
      resolvedAt: new Date(),
    });

    await this.eventRecorder.record({
      organizationId: conflict.organizationId,
      actorType: "user",
      actorId: by,
      type: "knowledge.conflict_resolved",
      payload: {
        conflictId: conflict.id,
        knowledgeId: conflict.memoryId,
        conflictingKnowledgeId: conflict.conflictingMemoryId,
        status,
        resolution,
      },
    });

    return closed;
  }

  private async describeUsage(organizationId: OrganizationId, recalls: KnowledgeRecall[]) {
    const workIds = [...new Set(recalls.flatMap((recall) => (recall.workId ? [recall.workId] : [])))].slice(0, 25);
    const works = await Promise.all(workIds.map((id) => this.workRepository.findById(id as WorkId)));
    const byId = new Map(
      works.flatMap((work) => (work && work.organizationId === organizationId ? [[work.id as string, work]] : [])),
    );

    return {
      recallCount: recalls.length,
      missions: workIds.flatMap((workId) => {
        const work = byId.get(workId);
        if (!work) return [];

        const mine = recalls.filter((recall) => recall.workId === workId);

        return [{
          mission: { id: work.id, objective: work.objective, status: work.status },
          stages: [...new Set(mine.map((recall) => recall.stage))],
          lastRecalledAt: mine[0]!.recalledAt,
          bestRank: Math.min(...mine.map((recall) => recall.rank)),
          reasons: mine[0]!.reasons,
        }];
      }),
    };
  }

  private async requireKnowledge(organizationId: OrganizationId, knowledgeId: MemoryId): Promise<Memory> {
    const knowledge = await this.memories.findById(knowledgeId);

    if (!knowledge || knowledge.organizationId !== organizationId) {
      throw new KnowledgeNotFoundError();
    }

    return knowledge;
  }

  private async requireWorkspace(organizationId: OrganizationId, workspaceId: WorkspaceId): Promise<void> {
    const workspace = await this.workspaceRepository.findById(workspaceId);

    if (!workspace || workspace.organizationId !== organizationId) {
      throw new KnowledgeNotFoundError("Workspace not found.");
    }
  }

  private validTitle(value: string): string {
    const title = sanitizeKnowledgeText(value, MAX_TITLE_CHARS).replace(/\n+/g, " ");

    if (title.length < 3) {
      throw new KnowledgeValidationError("title must be at least 3 characters.");
    }

    return title;
  }

  private validContent(value: string): string {
    if (value.length > MAX_CONTENT_CHARS * 2) {
      throw new KnowledgeValidationError(`content must be ${MAX_CONTENT_CHARS} characters or fewer.`);
    }

    const content = sanitizeKnowledgeText(value, MAX_CONTENT_CHARS);

    if (content.length < 3) {
      throw new KnowledgeValidationError("content must be at least 3 characters.");
    }

    return content;
  }

  private validType(value: MemoryType): MemoryType {
    // A person may state any kind of knowledge except the raw execution
    // record, which only ever came from the old per-task log.
    if (!KNOWLEDGE_TYPES.includes(value) || value === "experience") {
      throw new KnowledgeValidationError("type is not a kind of knowledge a person can record.");
    }

    return value;
  }

  /** Newer knowledge becomes current and names what it replaced; the older is kept as history. */
  private async replace(
    newer: Memory,
    older: Memory,
    by: string,
    reason: string,
  ): Promise<{ current: Memory; replaced: Memory }> {
    const replaced = await this.archiveKnowledge(older.organizationId, older.id, {
      by,
      reason,
      supersededById: newer.id,
    });

    const now = new Date();
    const current = await this.memories.update({
      ...newer,
      status: "active",
      supersedesId: older.id,
      reviewedBy: by,
      reviewedAt: now,
      updatedAt: now,
    });

    await this.eventRecorder.record({
      organizationId: current.organizationId,
      workId: current.workId,
      actorType: "user",
      actorId: by,
      type: "knowledge.superseded",
      payload: {
        knowledgeId: current.id,
        title: current.title,
        replacedKnowledgeId: replaced.id,
        replacedTitle: replaced.title,
      },
    });

    return { current, replaced };
  }
}

/** How many independent confirmations one entry keeps a record of. */
const MAX_REINFORCEMENTS = 20;

function bounded(value: number | undefined, fallback: number): number {
  const number = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return Math.min(1, Math.max(0, number));
}

/* --------------------------------------------------------------------------
   The mission debrief
   -------------------------------------------------------------------------- */

/** What became of one thing a mission taught the company. */
export type MissionDebriefOutcome =
  /** Nobody has decided: a proposal, or current knowledge no person reviewed. */
  | "pending"
  /** A person made it (or kept it as) current company knowledge. */
  | "kept"
  /** It said what the company already knew, and was folded into that entry. */
  | "merged"
  /** Newer knowledge replaced it. */
  | "replaced"
  /** Archived without a replacement. */
  | "discarded";

export interface MissionDebriefRelation {
  knowledge: Memory;
  relation: "restates" | "contradicts" | "related";
  /** Measured embedding similarity, when both sides were embedded. */
  similarity?: number;
  /** Whether mergeKnowledge would accept this entry as the one to keep. */
  canMerge: boolean;
}

export interface MissionDebriefItem {
  knowledge: Memory;
  outcome: MissionDebriefOutcome;
  mergedInto?: { id: MemoryId; title: string; status: KnowledgeStatus };
  replacedBy?: { id: MemoryId; title: string; status: KnowledgeStatus };
  replaces?: { id: MemoryId; title: string; status: KnowledgeStatus };
  evidence: {
    task?: { id: string; title: string };
    agent?: { id: string; name: string };
    artifact?: { id: string; name: string };
    rationale?: string;
  };
  /** Only while pending: what it stands against in the company's knowledge. */
  related: MissionDebriefRelation[];
}

/**
 * Where "about the same thing" becomes "saying the same thing", for the local
 * embedding model. Measured on the live store with nomic-embed-text: four
 * wordings of one pricing finding scored 0.91-0.99 against each other, while
 * different findings about the same pricing tiers scored 0.73-0.84.
 */
const RESTATEMENT_SIMILARITY = 0.9;

/**
 * Below this, two entries only share vocabulary. On the same store an
 * onboarding checklist scored 0.56-0.68 against the pricing findings - the same
 * product words, a different subject.
 */
const RELATED_SIMILARITY = 0.7;

/** One review per mission is bounded; each item's comparison is a search. */
const MAX_DEBRIEF_ITEMS = 12;
const MAX_RELATED = 2;
const MAX_RELATIONS = 4;

function outcomeOf(memory: Memory): MissionDebriefOutcome {
  if (memory.status === "archived") {
    if (typeof memory.metadata.mergedIntoId === "string") return "merged";
    if (typeof memory.metadata.supersededById === "string") return "replaced";
    return "discarded";
  }

  return memory.status === "active" && memory.reviewedAt ? "kept" : "pending";
}

/** Knowledge that can ever be recalled into the same work. */
function visibleTogether(left: Memory, right: Memory): boolean {
  return !left.workspaceId || !right.workspaceId || left.workspaceId === right.workspaceId;
}

function normalizedTitle(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** The missions that arrived at this knowledge again, as merges recorded them. */
function reinforcementsOf(memory: Memory): Array<Record<string, unknown>> {
  const value = memory.metadata.reinforcements;

  return Array.isArray(value)
    ? value.filter((entry): entry is Record<string, unknown> => typeof entry === "object" && entry !== null)
    : [];
}
