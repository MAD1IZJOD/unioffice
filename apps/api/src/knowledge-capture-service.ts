import {
  createEntityId,
  type Agent,
  type Artifact,
  type KnowledgeConflict,
  type KnowledgeConflictId,
  type Memory,
  type MemoryId,
  type OrganizationId,
  type Task,
  type Work,
} from "@unioffice/core";

import type {
  KnowledgeLinkRepository,
  KnowledgeSearchRepository,
  MemoryRepository,
} from "@unioffice/database";

import {
  detectConflict,
  knowledgeEmbeddingText,
  queryTerms,
  toTsQueryTerms,
  type EmbeddingProvider,
  type ExtractedKnowledge,
  type KnowledgeExtractor,
} from "@unioffice/memory";

import type { EventRecorder } from "./event-recorder.js";
import type { KnowledgeActor, KnowledgeGovernance } from "./knowledge-governance.js";

/**
 * How knowledge enters the company's memory.
 *
 * Every write goes through here - a person adding knowledge, extraction after a
 * step completes, knowledge derived from an artifact - so every write gets the
 * same treatment: it is recorded in the audit trail, indexed for retrieval,
 * and checked against what the company already knows for contradictions.
 */

export interface CaptureReport {
  created: Memory[];
  duplicates: string[];
  discarded: Array<{ title: string; reason: string }>;
  rejected: Array<{ title?: string; reason: string }>;
  skipped?: string;
}

type SearchableMemoryRepository = MemoryRepository & KnowledgeSearchRepository;

const CONFLICT_CANDIDATES = 20;

export class KnowledgeCaptureService {
  constructor(
    private readonly memories: SearchableMemoryRepository,
    private readonly links: KnowledgeLinkRepository,
    private readonly governance: KnowledgeGovernance,
    private readonly eventRecorder: EventRecorder,
    private readonly extractor?: KnowledgeExtractor,
    private readonly embeddings?: EmbeddingProvider,
  ) {}

  /**
   * After a step completes: is there anything in its output worth keeping?
   *
   * Best-effort by contract. The step's own result is already durable; nothing
   * here may fail it.
   */
  async captureFromTask(input: {
    work: Work;
    task: Task;
    agent: Agent;
    output: unknown;
    artifactId?: Artifact["id"];
  }): Promise<CaptureReport> {
    if (!this.extractor) {
      return emptyReport("No extraction model is configured.");
    }

    const result = await this.extractor.extract({
      objective: input.work.objective,
      taskTitle: input.task.title,
      taskDescription: input.task.description,
      output: textOf(input.output),
    });

    return this.admit(result, {
      actor: {
        organizationId: input.work.organizationId,
        agent: input.agent,
        workspaceId: input.work.workspaceId,
        workId: input.work.id,
        taskId: input.task.id,
      },
      template: {
        organizationId: input.work.organizationId,
        workspaceId: input.work.workspaceId,
        agentId: input.agent.id,
        workId: input.work.id,
        taskId: input.task.id,
        artifactId: input.artifactId,
        sourceType: "task",
        createdBy: `agent:${input.agent.id}`,
        capabilities: input.agent.capabilities,
      },
    });
  }

  /**
   * A person asked for knowledge to be derived from an artifact. The request
   * is a person's, but the sentences are still a model's - so they are
   * proposals like any other extraction, and the artifact stays their source.
   */
  async captureFromArtifact(input: {
    artifact: Artifact;
    work?: Work;
    requestedBy: string;
  }): Promise<CaptureReport> {
    if (!this.extractor) {
      return emptyReport("No extraction model is configured.");
    }

    const result = await this.extractor.extract({
      objective: input.work?.objective ?? input.artifact.name,
      taskTitle: input.artifact.name,
      taskDescription: input.artifact.description ?? "",
      output: textOf(input.artifact.metadata.content),
    });

    return this.admit(result, {
      actor: {
        organizationId: input.artifact.organizationId,
        workspaceId: input.work?.workspaceId,
        workId: input.work?.id,
        taskId: input.artifact.taskId,
      },
      template: {
        organizationId: input.artifact.organizationId,
        workspaceId: input.work?.workspaceId,
        agentId: input.artifact.createdByAgentId,
        workId: input.artifact.workId,
        taskId: input.artifact.taskId,
        artifactId: input.artifact.id,
        sourceType: "artifact",
        createdBy: input.requestedBy,
        capabilities: [],
      },
    });
  }

  /** Stores one piece of knowledge and does everything a write entails. */
  async persist(
    memory: Memory,
    audit: { actorType: "user" | "agent" | "system"; actorId?: string; reason?: string },
  ): Promise<Memory> {
    const created = await this.memories.create(memory);

    try {
      await this.eventRecorder.record({
        organizationId: created.organizationId,
        workId: created.workId,
        taskId: created.taskId,
        agentId: created.agentId,
        actorType: audit.actorType,
        actorId: audit.actorId,
        type: "knowledge.created",
        payload: {
          knowledgeId: created.id,
          title: created.title,
          type: created.type,
          status: created.status,
          sourceType: created.sourceType,
          workspaceId: created.workspaceId,
          artifactId: created.artifactId,
          reason: audit.reason,
        },
      });
    } finally {
      // The row exists either way. If the audit write fails, the failure still
      // reaches the caller - but the knowledge is not also left unindexed and
      // unchecked for contradictions, which is what happened when this ran
      // only after a successful audit line.
      await this.index(created);
    }

    return created;
  }

  /**
   * Re-embeds and re-checks for conflicts. Called after any change to what a
   * piece of knowledge says; a failure leaves the row readable and unindexed,
   * which backfill picks up later.
   */
  async index(memory: Memory): Promise<void> {
    const embedding = await this.embed(memory);

    if (embedding && this.embeddings) {
      try {
        await this.memories.setEmbedding(memory.organizationId, memory.id, embedding, this.embeddings.model);
      } catch {
        // Retrieval still works on keywords; backfill will retry the vector.
      }
    }

    try {
      await this.detectConflicts(memory, embedding);
    } catch {
      // A missed conflict check is recoverable - it runs again on the next
      // edit - and must never undo the write it follows.
    }
  }

  /**
   * Compares new or changed knowledge against what the company already knows
   * about the same subject. Only knowledge that can be seen together is
   * compared: two workspaces that never share a recall cannot contradict each
   * other in front of anyone.
   */
  async detectConflicts(memory: Memory, embedding?: number[]): Promise<KnowledgeConflict[]> {
    if (memory.status === "archived") {
      return [];
    }

    const candidates = await this.memories.searchCandidates({
      organizationId: memory.organizationId,
      statuses: ["active", "proposed"],
      workspace: { mode: "all" },
      embedding,
      terms: toTsQueryTerms(queryTerms(memory.title)),
      candidateLimit: CONFLICT_CANDIDATES,
    });

    const others = candidates.filter((candidate) => candidate.memoryId !== memory.id);

    if (others.length === 0) {
      return [];
    }

    const rows = await this.memories.findByIds(
      memory.organizationId,
      others.map((candidate) => candidate.memoryId),
    );
    const similarity = new Map(others.map((candidate) => [candidate.memoryId, candidate.semanticSimilarity]));

    const recorded: KnowledgeConflict[] = [];

    for (const other of rows) {
      if (!visibleTogether(memory, other)) continue;

      const detected = detectConflict(memory, other, similarity.get(other.id));
      if (!detected) continue;

      const conflict = await this.links.createConflict({
        id: createEntityId<"KnowledgeConflictId">() as KnowledgeConflictId,
        organizationId: memory.organizationId,
        memoryId: memory.id,
        conflictingMemoryId: other.id,
        reason: detected.reason,
        signals: detected.signals,
        status: "open",
        detectedAt: new Date(),
      });

      if (!conflict) continue;

      recorded.push(conflict);

      await this.eventRecorder.record({
        organizationId: memory.organizationId,
        workId: memory.workId,
        taskId: memory.taskId,
        type: "knowledge.conflict_detected",
        payload: {
          conflictId: conflict.id,
          knowledgeId: memory.id,
          title: memory.title,
          conflictingKnowledgeId: other.id,
          conflictingTitle: other.title,
          reason: detected.reason,
        },
      });
    }

    return recorded;
  }

  /** Embeds recallable knowledge that has no vector yet. Bounded per call. */
  async backfillEmbeddings(organizationId: OrganizationId, limit = 50): Promise<number> {
    if (!this.embeddings) return 0;

    const missing = await this.memories.findMissingEmbeddings(organizationId, limit);
    if (missing.length === 0) return 0;

    const vectors = await this.embeddings.embed(
      missing.map((memory) => knowledgeEmbeddingText(memory)),
      "document",
    );

    let stored = 0;

    for (const [index, memory] of missing.entries()) {
      const vector = vectors[index];
      if (!vector) continue;

      await this.memories.setEmbedding(organizationId, memory.id, vector, this.embeddings.model);
      stored += 1;
    }

    return stored;
  }

  private async admit(
    result: Awaited<ReturnType<KnowledgeExtractor["extract"]>>,
    context: {
      actor: KnowledgeActor;
      template: Pick<Memory, "organizationId" | "workspaceId" | "agentId" | "workId" | "taskId" | "artifactId" | "sourceType" | "createdBy"> & {
        capabilities: string[];
      };
    },
  ): Promise<CaptureReport> {
    const report: CaptureReport = {
      created: [],
      duplicates: [],
      discarded: [],
      rejected: result.rejected,
      skipped: result.skipped,
    };

    if (result.rejected.length > 0) {
      await this.eventRecorder.record({
        organizationId: context.actor.organizationId,
        workId: context.actor.workId,
        taskId: context.actor.taskId,
        agentId: context.actor.agent?.id,
        type: "knowledge.extraction_rejected",
        payload: {
          count: result.rejected.length,
          // Why each was refused, never the refused text: a rejected item may
          // be exactly the injected instruction the check caught.
          reasons: result.rejected.slice(0, 5).map((entry) => entry.reason),
        },
      });
    }

    for (const candidate of result.accepted) {
      const existing = await this.memories.query({
        organizationId: context.actor.organizationId,
        contentHash: candidate.contentHash,
        statuses: ["proposed", "active"],
        limit: 1,
      });

      if (existing.length > 0) {
        report.duplicates.push(candidate.title);
        continue;
      }

      const outcome = await this.governance.decideCapture(context.actor, candidate);

      if (outcome.status === "discarded") {
        report.discarded.push({ title: candidate.title, reason: outcome.reason });
        continue;
      }

      const created = await this.persist(
        fromExtraction(candidate, outcome.status, context.template, result.model, outcome.reason),
        {
          actorType: context.template.sourceType === "artifact" ? "user" : "agent",
          actorId: context.template.createdBy,
          reason: outcome.reason,
        },
      );

      report.created.push(created);
    }

    return report;
  }

  private async embed(memory: Memory): Promise<number[] | undefined> {
    if (!this.embeddings) return undefined;

    try {
      const [vector] = await this.embeddings.embed([knowledgeEmbeddingText(memory)], "document");
      return vector;
    } catch {
      return undefined;
    }
  }
}

function fromExtraction(
  candidate: ExtractedKnowledge,
  status: "active" | "proposed",
  template: Pick<Memory, "organizationId" | "workspaceId" | "agentId" | "workId" | "taskId" | "artifactId" | "sourceType" | "createdBy"> & {
    capabilities: string[];
  },
  model: string | undefined,
  governanceReason: string,
): Memory {
  const now = new Date();

  return {
    id: createEntityId<"MemoryId">() as MemoryId,
    organizationId: template.organizationId,
    // Learned inside a workspace, kept inside it. A person can widen it to the
    // whole company; extraction never does.
    workspaceId: template.workspaceId,
    agentId: template.agentId,
    workId: template.workId,
    taskId: template.taskId,
    artifactId: template.artifactId,
    scope: "company",
    type: candidate.type,
    status,
    title: candidate.title,
    content: candidate.content,
    sourceType: template.sourceType,
    importance: candidate.importance,
    confidence: candidate.confidence,
    createdBy: template.createdBy,
    contentHash: candidate.contentHash,
    createdAt: now,
    updatedAt: now,
    metadata: {
      capabilities: template.capabilities,
      extraction: {
        model,
        rationale: candidate.rationale,
        governance: governanceReason,
      },
    },
  };
}

function visibleTogether(left: Memory, right: Memory): boolean {
  return !left.workspaceId || !right.workspaceId || left.workspaceId === right.workspaceId;
}

function textOf(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === undefined || value === null) return "";

  try {
    return JSON.stringify(value) ?? "";
  } catch {
    return "";
  }
}

function emptyReport(skipped: string): CaptureReport {
  return { created: [], duplicates: [], discarded: [], rejected: [], skipped };
}
