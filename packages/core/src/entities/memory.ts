import type {
  AgentId,
  ArtifactId,
  KnowledgeConflictId,
  KnowledgeRecallId,
  MemoryId,
  OrganizationId,
  TaskId,
  WorkId,
  WorkspaceId,
} from "../types/ids.js";

/**
 * Company knowledge.
 *
 * A Memory is one piece of what the company knows: a decision it took, a fact
 * it established, a lesson a mission taught it. It is the same row the Company
 * Brain has always stored, grown into something that can be trusted - it says
 * where it came from, whether a person has vouched for it, where it applies,
 * and how sure anyone is.
 *
 * The line this model draws is between raw data and knowledge. A task's output
 * is raw data and lives on the task and its artifact. Knowledge is the durable
 * sentence worth carrying into the next mission, and it is written
 * deliberately - by a person, or proposed by extraction and then reviewed.
 */

export type MemoryScope =
  | "company"
  | "agent";

/**
 * What kind of knowledge this is. Each changes how it is read, not just how it
 * is labelled: a policy does not go stale with age the way an assumption does,
 * and a decision carries more weight in planning than an insight.
 */
export type MemoryType =
  /** Something established as true about the company or its world. */
  | "fact"
  /** A choice the company made, and ideally why. */
  | "decision"
  /** An interpretation drawn from analysis. Useful, arguable. */
  | "insight"
  /** A rule the company operates by. Only a person can make one active. */
  | "policy"
  /** How something is done here. */
  | "process"
  /** A stated preference of the company or its people. */
  | "preference"
  /** What went well or badly, stated so it is not repeated. */
  | "lesson"
  /** Something taken as true without being established. Ages fastest. */
  | "assumption"
  /** A pointer to a source worth consulting. */
  | "reference"
  /** A record of what happened when work ran. The raw tier. */
  | "experience";

export type KnowledgeType = MemoryType;

export const KNOWLEDGE_TYPES: readonly MemoryType[] = [
  "fact",
  "decision",
  "insight",
  "policy",
  "process",
  "preference",
  "lesson",
  "assumption",
  "reference",
  "experience",
];

/**
 * Where a piece of knowledge is in its life.
 *
 * proposed: suggested, not vouched for. Recalled only with that said plainly.
 * active:   current company knowledge.
 * archived: kept for history. Never recalled.
 */
export type KnowledgeStatus =
  | "proposed"
  | "active"
  | "archived";

export const KNOWLEDGE_STATUSES: readonly KnowledgeStatus[] = [
  "proposed",
  "active",
  "archived",
];

/** What produced it. The specific row is named by the reference fields. */
export type KnowledgeSourceType =
  | "mission"
  | "task"
  | "artifact"
  | "user"
  | "agent"
  | "approval";

export const KNOWLEDGE_SOURCE_TYPES: readonly KnowledgeSourceType[] = [
  "mission",
  "task",
  "artifact",
  "user",
  "agent",
  "approval",
];

export interface Memory {
  id: MemoryId;

  organizationId: OrganizationId;

  /**
   * A workspace boundary. Absent means company-wide. When present the
   * knowledge is only ever recalled into work running in that workspace.
   */
  workspaceId?: WorkspaceId;

  /** The agent whose work produced it, when an agent's work did. */
  agentId?: AgentId;

  workId?: WorkId;

  taskId?: TaskId;

  artifactId?: ArtifactId;

  scope: MemoryScope;

  type: MemoryType;

  status: KnowledgeStatus;

  /** One line, stating the knowledge itself rather than its topic. */
  title: string;

  content: string;

  /** A free-text reference kept from the original memory model. */
  source?: string;

  sourceType: KnowledgeSourceType;

  /** 0-1. How much it should weigh against other relevant knowledge. */
  importance: number;

  /** 0-1, when anyone has a basis for saying. Absent means unassessed. */
  confidence?: number;

  /** "user:<id>", "agent:<id>" or "system", for the Brain to name. */
  createdBy?: string;

  reviewedBy?: string;

  reviewedAt?: Date;

  /** The older knowledge this replaces, which is archived rather than lost. */
  supersedesId?: MemoryId;

  archivedAt?: Date;

  contentHash?: string;

  /** Which embedding model indexed it, when one has. */
  embeddingModel?: string;

  createdAt: Date;

  updatedAt: Date;

  metadata: Record<string, unknown>;
}

export type Knowledge = Memory;

/**
 * Which knowledge was put in front of which work, and why.
 *
 * Written at recall time, so a mission can show exactly what it was given and
 * the Brain can show what is actually in use - both read from this, rather
 * than from a guess reconstructed afterwards.
 */
export interface KnowledgeRecall {
  id: KnowledgeRecallId;

  organizationId: OrganizationId;

  memoryId: MemoryId;

  workId?: WorkId;

  taskId?: TaskId;

  agentId?: AgentId;

  /** planning: before the plan was written. execution: before a step ran. */
  stage: "planning" | "execution";

  /** 1 is the most relevant item recalled in that request. */
  rank: number;

  score: number;

  reasons: string[];

  recalledAt: Date;
}

export type KnowledgeConflictStatus =
  | "open"
  | "resolved"
  | "dismissed";

/**
 * Two pieces of knowledge that disagree.
 *
 * The system detects these and never settles them itself: choosing the newer
 * or the more important one silently is exactly the failure that makes a
 * company memory untrustworthy.
 */
export interface KnowledgeConflict {
  id: KnowledgeConflictId;

  organizationId: OrganizationId;

  memoryId: MemoryId;

  conflictingMemoryId: MemoryId;

  reason: string;

  signals: Record<string, unknown>;

  status: KnowledgeConflictStatus;

  resolution?: string;

  resolvedBy?: string;

  resolvedAt?: Date;

  detectedAt: Date;
}

/** Whether knowledge can be recalled into an agent's context at all. */
export function isRecallable(memory: Memory): boolean {
  return memory.status === "active" || memory.status === "proposed";
}
