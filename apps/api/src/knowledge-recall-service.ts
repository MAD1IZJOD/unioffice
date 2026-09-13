import {
  createEntityId,
  type Agent,
  type KnowledgeRecall,
  type KnowledgeRecallId,
  type KnowledgeStatus,
  type Memory,
  type MemoryId,
  type OrganizationId,
  type Task,
  type Work,
  type WorkspaceId,
} from "@unioffice/core";

import type {
  ArtifactRepository,
  KnowledgeLinkRepository,
  KnowledgeSearchRepository,
  KnowledgeWorkspaceScope,
  MemoryRepository,
  TaskRepository,
  WorkRepository,
} from "@unioffice/database";

import type { RecalledKnowledgeItem } from "@unioffice/agents";

import {
  detectInstructionSignals,
  queryTerms,
  rankKnowledge,
  toTsQueryTerms,
  type EmbeddingProvider,
  type RankedKnowledge,
} from "@unioffice/memory";

import type { EventRecorder } from "./event-recorder.js";
import type { KnowledgeGovernance } from "./knowledge-governance.js";

/**
 * How company knowledge reaches the work.
 *
 * One path, used by the planner before a plan is written and by every step
 * before its agent runs, and by the Brain to show a person exactly what an
 * agent would be handed. Keeping it one path is what makes the Brain's "this
 * is what would be recalled" true rather than approximately true.
 *
 * In order, every recall:
 *
 * 1. scopes by organization, lifecycle and workspace inside the database, so a
 *    row outside the boundary is never a candidate at all;
 * 2. ranks the candidates deterministically, with reasons;
 * 3. asks governance which of them this agent may be handed;
 * 4. surfaces open conflicts, bringing in the other side rather than letting
 *    one silently stand for both;
 * 5. bounds what is handed over and describes where each item came from;
 * 6. records what was recalled, for whom and why.
 */

export interface KnowledgeSearchRequest {
  organizationId: OrganizationId;
  text: string;
  workspace: KnowledgeWorkspaceScope;
  statuses: KnowledgeStatus[];
  /** Used for workspace fit in ranking when work runs in a workspace. */
  workspaceId?: WorkspaceId;
  agentCapabilities?: string[];
  limit: number;
}

export interface RecallResult {
  items: RecalledKnowledgeItem[];
  /** The ranked rows behind the items, same order. */
  ranked: RankedKnowledge[];
  withheldCount: number;
}

type SearchableMemoryRepository = MemoryRepository & KnowledgeSearchRepository;

/** Hard ceilings, whatever a caller asks for. */
const MAX_QUERY_CHARS = 2_000;
const MAX_CANDIDATES = 60;
const RANK_POOL = 12;
const PLANNING_ITEMS = 6;
const EXECUTION_ITEMS = 6;
const MAX_ITEMS_WITH_CONFLICTS = 8;

const RECALLABLE: KnowledgeStatus[] = ["active", "proposed"];

export class KnowledgeRecallService {
  constructor(
    private readonly memories: SearchableMemoryRepository,
    private readonly links: KnowledgeLinkRepository,
    private readonly governance: KnowledgeGovernance,
    private readonly eventRecorder: EventRecorder,
    private readonly workRepository: WorkRepository,
    private readonly taskRepository: TaskRepository,
    private readonly artifactRepository: ArtifactRepository,
    private readonly embeddings?: EmbeddingProvider,
  ) {}

  /**
   * Hybrid search with no governance and no recording. The Brain uses this for
   * a person browsing their own organization's knowledge; recall for an agent
   * always goes through recallForPlanning or recallForStep instead.
   */
  async search(request: KnowledgeSearchRequest): Promise<RankedKnowledge[]> {
    const text = request.text.slice(0, MAX_QUERY_CHARS);
    const terms = queryTerms(text);
    const embedding = await this.embedQuery(text);

    const candidates = await this.memories.searchCandidates({
      organizationId: request.organizationId,
      statuses: request.statuses,
      workspace: request.workspace,
      embedding,
      terms: toTsQueryTerms(terms),
      candidateLimit: MAX_CANDIDATES,
    });

    if (candidates.length === 0) {
      return [];
    }

    const rows = await this.memories.findByIds(
      request.organizationId,
      candidates.map((candidate) => candidate.memoryId),
    );
    const byId = new Map(rows.map((row) => [row.id, row]));

    return rankKnowledge(
      candidates.flatMap((candidate) => {
        const memory = byId.get(candidate.memoryId);
        return memory ? [{ memory, semanticSimilarity: candidate.semanticSimilarity, keywordRank: candidate.keywordRank }] : [];
      }),
      {
        terms,
        workspaceId: request.workspaceId,
        agentCapabilities: request.agentCapabilities,
        now: new Date(),
      },
      Math.min(request.limit, 50),
    );
  }

  /** What Tyrion is handed before writing a plan. */
  async recallForPlanning(work: Work, orchestrator?: Agent): Promise<RecallResult> {
    const briefing = typeof work.metadata.briefing === "string" ? work.metadata.briefing : "";

    return this.recall({
      stage: "planning",
      work,
      agent: orchestrator,
      text: `${work.objective}\n${briefing}`,
      maxItems: PLANNING_ITEMS,
    });
  }

  /** What one agent is handed before running one step. */
  async recallForStep(work: Work, task: Task, agent: Agent): Promise<RecallResult> {
    return this.recall({
      stage: "execution",
      work,
      task,
      agent,
      text: `${task.title}\n${task.description}\n${work.objective}`,
      maxItems: EXECUTION_ITEMS,
    });
  }

  /**
   * The same recall an agent would get, without recording it. The Brain shows
   * this so a person can see what the company would put in front of the work.
   */
  async previewRecall(input: {
    organizationId: OrganizationId;
    text: string;
    workspaceId?: WorkspaceId;
    agent?: Agent;
  }): Promise<RecallResult> {
    return this.recall({
      stage: "execution",
      preview: true,
      organizationId: input.organizationId,
      workspaceId: input.workspaceId,
      agent: input.agent,
      text: input.text,
      maxItems: EXECUTION_ITEMS,
    });
  }

  private async recall(input: {
    stage: "planning" | "execution";
    preview?: boolean;
    work?: Work;
    task?: Task;
    agent?: Agent;
    organizationId?: OrganizationId;
    workspaceId?: WorkspaceId;
    text: string;
    maxItems: number;
  }): Promise<RecallResult> {
    const organizationId = input.work?.organizationId ?? input.organizationId!;
    const workspaceId = input.work ? input.work.workspaceId : input.workspaceId;

    // An agent from another organization is never a valid actor here.
    if (input.agent && input.agent.organizationId !== organizationId) {
      throw new Error("Recall refused: the agent does not belong to this organization.");
    }

    const workspace: KnowledgeWorkspaceScope = workspaceId
      ? { mode: "company_and_workspace", workspaceId }
      : { mode: "company" };

    const ranked = await this.search({
      organizationId,
      text: input.text,
      workspace,
      statuses: RECALLABLE,
      workspaceId,
      agentCapabilities: input.agent?.capabilities,
      limit: RANK_POOL,
    });

    const actor = {
      organizationId,
      agent: input.agent,
      workspaceId,
      workId: input.work?.id,
      taskId: input.task?.id,
    };

    const governed = await this.governance.filterRecall(
      actor,
      ranked.map((entry) => entry.memory),
    );
    const allowedIds = new Set(governed.allowed.map((memory) => memory.id));
    const chosen = ranked
      .filter((entry) => allowedIds.has(entry.memory.id))
      .slice(0, input.maxItems);

    const withConflicts = await this.withConflictingSides(chosen, organizationId, workspace, actor);

    const items = await this.present(withConflicts.entries, withConflicts.conflicts, organizationId);

    if (!input.preview && input.work && items.length > 0) {
      await this.record(input.stage, input.work, input.task, input.agent, withConflicts.entries);
    }

    return {
      items,
      ranked: withConflicts.entries,
      withheldCount: governed.withheld.length,
    };
  }

  /**
   * Brings in the other side of any open conflict one recalled item is part
   * of, provided that side is itself recallable here - same boundary, same
   * governance - so surfacing a disagreement never becomes a way to reach
   * knowledge the work could not otherwise see.
   */
  private async withConflictingSides(
    chosen: RankedKnowledge[],
    organizationId: OrganizationId,
    workspace: KnowledgeWorkspaceScope,
    actor: Parameters<KnowledgeGovernance["filterRecall"]>[0],
  ): Promise<{ entries: RankedKnowledge[]; conflicts: Map<MemoryId, MemoryId[]> }> {
    // Sets, not arrays: when both sides of a conflict were recalled, the pair
    // is found once from each side, and an agent told "conflicts with K2, K2"
    // is being told something that is not true.
    const pairs = new Map<MemoryId, Set<MemoryId>>();
    const present = new Set(chosen.map((entry) => entry.memory.id));
    const missing = new Set<MemoryId>();

    const link = (from: MemoryId, to: MemoryId): void => {
      pairs.set(from, (pairs.get(from) ?? new Set<MemoryId>()).add(to));
    };

    for (const entry of chosen) {
      const open = await this.links.findConflicts(organizationId, {
        status: "open",
        memoryId: entry.memory.id,
        limit: 5,
      });

      for (const conflict of open) {
        const other =
          conflict.memoryId === entry.memory.id
            ? conflict.conflictingMemoryId
            : conflict.memoryId;

        link(entry.memory.id, other);
        link(other, entry.memory.id);

        if (!present.has(other)) missing.add(other);
      }
    }

    const conflicts = new Map<MemoryId, MemoryId[]>(
      [...pairs.entries()].map(([id, others]): [MemoryId, MemoryId[]] => [id, [...others]]),
    );

    const room = MAX_ITEMS_WITH_CONFLICTS - chosen.length;

    if (missing.size === 0 || room <= 0) {
      return { entries: chosen, conflicts };
    }

    const candidates = (await this.memories.findByIds(organizationId, [...missing]))
      .filter((memory) => RECALLABLE.includes(memory.status) && inScope(memory, workspace));

    const governed = await this.governance.filterRecall(actor, candidates);

    const added: RankedKnowledge[] = governed.allowed.slice(0, room).map((memory) => ({
      memory,
      score: 0,
      signals: {
        semantic: null,
        keyword: 0,
        importance: memory.importance,
        recency: 0,
        scopeFit: 0,
        sourceQuality: 0,
        capabilityAffinity: 0,
      },
      reasons: ["Disagrees with another recalled entry, so both are shown"],
      stale: false,
      ageDays: 0,
    }));

    return { entries: [...chosen, ...added], conflicts };
  }

  private async present(
    entries: RankedKnowledge[],
    conflicts: Map<MemoryId, MemoryId[]>,
    organizationId: OrganizationId,
  ): Promise<RecalledKnowledgeItem[]> {
    const refs = new Map(entries.map((entry, index) => [entry.memory.id, `K${index + 1}`]));
    const sources = new Map<string, string>();

    const items: RecalledKnowledgeItem[] = [];

    for (const entry of entries) {
      const { memory } = entry;
      const flags = detectInstructionSignals(`${memory.title}\n${memory.content}`);

      items.push({
        ref: refs.get(memory.id)!,
        id: memory.id,
        type: memory.type,
        status: memory.status === "active" ? "active" : "proposed",
        title: memory.title,
        content: memory.content,
        source: await this.describeSource(memory, organizationId, sources),
        recordedAt: lastConfirmed(memory).toISOString(),
        reviewed: Boolean(memory.reviewedAt),
        stale: entry.stale,
        confidence: memory.confidence,
        reasons: entry.reasons,
        conflictsWith: (conflicts.get(memory.id) ?? [])
          .map((id) => refs.get(id))
          .filter((ref): ref is string => Boolean(ref)),
        flags: flags.length > 0 ? flags : undefined,
      });
    }

    return items;
  }

  /**
   * Where a piece of knowledge came from, in words, read from the rows it
   * references. Only rows inside the organization are ever named; a reference
   * that cannot be confirmed is described generically rather than trusted.
   */
  private async describeSource(
    memory: Memory,
    organizationId: OrganizationId,
    cache: Map<string, string>,
  ): Promise<string> {
    const key = `${memory.sourceType}:${memory.taskId ?? ""}:${memory.artifactId ?? ""}:${memory.workId ?? ""}`;
    const cached = cache.get(key);
    if (cached) return cached;

    let description: string;

    const work = memory.workId ? await this.workRepository.findById(memory.workId) : null;
    const mission = work && work.organizationId === organizationId
      ? ` in mission “${truncate(work.objective, 80)}”`
      : "";

    if (memory.sourceType === "artifact" && memory.artifactId) {
      const artifact = await this.artifactRepository.findById(memory.artifactId);
      description = artifact && artifact.organizationId === organizationId
        ? `Derived from artifact “${truncate(artifact.name, 80)}”${mission}`
        : "Derived from an artifact";
    } else if ((memory.sourceType === "task" || memory.sourceType === "agent") && memory.taskId) {
      const task = mission ? await this.taskRepository.findById(memory.taskId) : null;
      description = task && task.workId === work?.id
        ? `Extracted from task “${truncate(task.title, 80)}”${mission}`
        : "Extracted from a completed task";
    } else if (memory.sourceType === "user") {
      description = memory.reviewedAt ? "Written and reviewed by a person" : "Written by a person";
    } else if (memory.sourceType === "approval") {
      description = `Recorded when a person decided an approval${mission}`;
    } else if (memory.sourceType === "mission") {
      description = mission ? `Learned from the mission${mission.replace(/^ in mission/, "")}` : "Learned from a mission";
    } else {
      description = "Proposed by an agent";
    }

    cache.set(key, description);
    return description;
  }

  private async record(
    stage: "planning" | "execution",
    work: Work,
    task: Task | undefined,
    agent: Agent | undefined,
    entries: RankedKnowledge[],
  ): Promise<void> {
    const recalledAt = new Date();

    const recalls: KnowledgeRecall[] = entries.map((entry, index) => ({
      id: createEntityId<"KnowledgeRecallId">() as KnowledgeRecallId,
      organizationId: work.organizationId,
      memoryId: entry.memory.id,
      workId: work.id,
      taskId: task?.id,
      agentId: agent?.id,
      stage,
      rank: index + 1,
      score: Math.round(entry.score * 1_000) / 1_000,
      reasons: entry.reasons.slice(0, 6),
      recalledAt,
    }));

    await this.links.recordRecalls(recalls);

    await this.eventRecorder.record({
      organizationId: work.organizationId,
      workId: work.id,
      taskId: task?.id,
      agentId: agent?.id,
      type: "knowledge.recalled",
      payload: {
        stage,
        count: entries.length,
        // Titles and reasons only. The content stays on the knowledge row,
        // so the event log never becomes a second copy of what the company knows.
        knowledge: entries.map((entry, index) => ({
          ref: `K${index + 1}`,
          knowledgeId: entry.memory.id,
          title: entry.memory.title,
          type: entry.memory.type,
          status: entry.memory.status,
          score: Math.round(entry.score * 1_000) / 1_000,
          reasons: entry.reasons.slice(0, 3),
        })),
      },
    });
  }

  private async embedQuery(text: string): Promise<number[] | undefined> {
    if (!this.embeddings || !text.trim()) {
      return undefined;
    }

    try {
      const [vector] = await this.embeddings.embed([text], "query");
      return vector;
    } catch {
      // Semantic search is one signal among several. Without it, keyword,
      // importance and recency still rank - recall degrades, it does not stop.
      return undefined;
    }
  }
}

function inScope(memory: Memory, workspace: KnowledgeWorkspaceScope): boolean {
  if (workspace.mode === "all" || !memory.workspaceId) return true;
  return workspace.mode === "company_and_workspace" && memory.workspaceId === workspace.workspaceId;
}

function lastConfirmed(memory: Memory): Date {
  return new Date(Math.max(
    memory.createdAt.getTime(),
    memory.updatedAt.getTime(),
    memory.reviewedAt?.getTime() ?? 0,
  ));
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}
