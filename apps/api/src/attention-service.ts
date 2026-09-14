import type {
  AgentId,
  ApprovalRequest,
  ExecutionJob,
  KnowledgeConflict,
  MemoryId,
  WorkId,
} from "@unioffice/core";

import type { WorkSummary } from "@unioffice/database";

import { clip, plural, type MissionReading } from "./mission-reading.js";
import { publicFailureReason } from "./public-failure.js";

/**
 * What needs a person, and what is merely worth knowing.
 *
 * Every entry is a row or a reading of rows: a pending approval, a mission the
 * backend marked failed, a mission that has stopped moving without anyone
 * being told, a step assigned to an agent that is out of service, knowledge
 * that disagrees with itself, lessons nobody has decided on, a queue job that
 * is recovering. Nothing is synthesised to keep the list from being empty,
 * because empty is the correct and common answer.
 *
 * Three severities, because they ask different things of a person:
 *
 *   action - something is stopped and will stay stopped until someone acts;
 *   review - nothing is blocked, but a person should look;
 *   watch  - the system is handling it and is only saying so.
 *
 * A person can mark a stopped or stalled mission as seen. It then leaves the
 * queue until something about the mission changes, which is what lets the
 * queue genuinely empty - an attention list that can never be cleared becomes
 * a list nobody reads.
 */

export type AttentionKind =
  | "decision"
  | "governance"
  | "failure"
  | "stalled"
  | "agent_unavailable"
  | "interrupted"
  | "conflict"
  | "lessons"
  | "recovering";

export type AttentionSeverity = "action" | "review" | "watch";

export type AttentionLevel = "critical" | "high" | "normal" | "low";

export type AttentionSource =
  | "approval"
  | "governance"
  | "execution"
  | "planning"
  | "queue"
  | "workforce"
  | "knowledge";

export interface AttentionItem {
  id: string;
  kind: AttentionKind;
  severity: AttentionSeverity;
  level: AttentionLevel;
  /** Which part of the system raised it. */
  source: AttentionSource;

  /** What it is, in a few words. */
  label: string;
  /** Why it is here. */
  detail: string;
  /** What happens next, or what a person can do about it. */
  consequence: string;
  /** The one thing to do about it, and where that is done. */
  action: { label: string; path: string };
  /** Whether a person can mark it as seen. */
  acknowledgeable: boolean;

  workId?: WorkId;
  objective?: string;
  taskId?: string;
  agentId?: string;

  at: Date;
}

export interface AttentionQueue {
  items: AttentionItem[];
  /** How many are stopped until a person acts. */
  actionCount: number;
  /** How many a person should look at, with nothing blocked. */
  reviewCount: number;
  /** How many are the system telling you what it is doing. */
  watchCount: number;
  /** Everything found, which can exceed what is returned. */
  total: number;
}

export interface AttentionInput {
  approvals: ApprovalRequest[];
  worksById: Map<WorkId, WorkSummary>;
  /** Readings of every mission that is not finished, and of failed ones. */
  missions: Array<{ work: WorkSummary; reading: MissionReading }>;
  jobs: ExecutionJob[];
  /** Failed missions a policy stopped, with the policy that did. */
  denials: Map<WorkId, { policyName?: string; summary?: string }>;
  conflicts: Array<{
    conflict: KnowledgeConflict;
    left?: { id: MemoryId; title: string };
    right?: { id: MemoryId; title: string };
  }>;
  /** Lessons each mission proposed that nobody has kept or discarded. */
  lessons: Array<{ workId: WorkId; count: number; at: Date }>;
  /** Agent ids that exist in the organization, for linking to them. */
  agentIds: Set<AgentId>;
}

export const DEFAULT_ATTENTION_LIMIT = 25;

const SEVERITY_RANK: Record<AttentionSeverity, number> = { action: 0, review: 1, watch: 2 };

const LEVEL_RANK: Record<AttentionLevel, number> = { critical: 0, high: 1, normal: 2, low: 3 };

/**
 * Within a severity and level: a decision is holding up a live operation right
 * now; a policy stop, a failure or a stall has already stopped and will wait.
 */
const KIND_RANK: Record<AttentionKind, number> = {
  decision: 0,
  agent_unavailable: 1,
  governance: 2,
  failure: 3,
  stalled: 4,
  interrupted: 5,
  conflict: 6,
  lessons: 7,
  recovering: 8,
};

export function buildAttentionQueue(
  input: AttentionInput,
  limit = DEFAULT_ATTENTION_LIMIT,
): AttentionQueue {
  const items: AttentionItem[] = [
    ...input.approvals.map((approval) => decisionItem(approval, input.worksById.get(approval.workId))),
    ...input.missions.flatMap(({ work, reading }) => missionItems(work, reading, input)),
    ...input.jobs.flatMap((job) => recoveringItem(job, input.worksById.get(job.workId))),
    ...input.conflicts.flatMap(conflictItem),
    ...input.lessons.flatMap((entry) => lessonsItem(entry, input.worksById.get(entry.workId))),
  ].sort(order);

  return {
    items: items.slice(0, Math.max(0, limit)),
    actionCount: items.filter((item) => item.severity === "action").length,
    reviewCount: items.filter((item) => item.severity === "review").length,
    watchCount: items.filter((item) => item.severity === "watch").length,
    total: items.length,
  };
}

function order(left: AttentionItem, right: AttentionItem): number {
  return (
    SEVERITY_RANK[left.severity] - SEVERITY_RANK[right.severity] ||
    LEVEL_RANK[left.level] - LEVEL_RANK[right.level] ||
    KIND_RANK[left.kind] - KIND_RANK[right.kind] ||
    right.at.getTime() - left.at.getTime() ||
    left.id.localeCompare(right.id)
  );
}

/** A problem on a critical mission is a critical problem. */
function levelFor(base: AttentionLevel, work: WorkSummary | undefined): AttentionLevel {
  return work?.priority === "critical" && LEVEL_RANK[base] > LEVEL_RANK.critical ? "critical" : base;
}

function missionPath(workId: WorkId): string {
  return `/missions/${workId}`;
}

/** Whether a person has already said they saw the mission in this state. */
function seen(work: WorkSummary, at: Date): boolean {
  return Boolean(work.acknowledgedAt && work.acknowledgedAt.getTime() >= at.getTime());
}

function decisionItem(approval: ApprovalRequest, work: WorkSummary | undefined): AttentionItem {
  return {
    id: `approval:${approval.id}`,
    kind: "decision",
    severity: "action",
    level: levelFor("high", work),
    source: "approval",
    label: clip(approval.action, 140),
    detail: clip(approval.reason, 280),
    consequence:
      "The mission is stopped here. Approving puts it back on the queue; rejecting means the step is not taken.",
    action: { label: "Review", path: missionPath(approval.workId) },
    acknowledgeable: false,
    workId: approval.workId,
    objective: work ? clip(work.objective, 200) : undefined,
    taskId: approval.taskId,
    agentId: approval.agentId,
    at: approval.createdAt,
  };
}

function missionItems(
  work: WorkSummary,
  reading: MissionReading,
  input: AttentionInput,
): AttentionItem[] {
  const shared = {
    workId: work.id,
    objective: clip(work.objective, 200),
  };

  if (reading.phase === "failed") {
    const at = work.completedAt ?? work.updatedAt;
    if (seen(work, at)) return [];

    if (work.interrupted) {
      return [{
        ...shared,
        id: `interrupted:${work.id}`,
        kind: "interrupted",
        severity: "action",
        level: levelFor("normal", work),
        source: "execution",
        label: "Interrupted mid-run",
        detail: reading.failure ?? shared.objective,
        consequence: "Finished steps were kept. Resuming picks up from the first one that did not.",
        action: { label: "Resume", path: missionPath(work.id) },
        acknowledgeable: true,
        at,
      }];
    }

    const denial = input.denials.get(work.id);

    if (denial) {
      return [{
        ...shared,
        id: `governance:${work.id}`,
        kind: "governance",
        severity: "action",
        level: levelFor("high", work),
        source: "governance",
        label: `Stopped by ${denial.policyName ? clip(denial.policyName, 80) : "a policy"}`,
        detail: denial.summary ? clip(denial.summary, 280) : reading.failure ?? shared.objective,
        consequence:
          "A policy refused a step, so nothing after it ran. Change the policy or the plan before retrying.",
        action: { label: "Inspect", path: missionPath(work.id) },
        acknowledgeable: true,
        at,
      }];
    }

    return [{
      ...shared,
      id: `failure:${work.id}`,
      kind: "failure",
      severity: "action",
      level: levelFor("high", work),
      source: work.planningError && !work.executionError ? "planning" : "execution",
      label: reading.stage === "Stopped while planning" ? "Planning failed" : "Mission stopped",
      detail: reading.failure ?? "It stopped without recording why.",
      consequence: "Nothing finished was lost. A retry resumes from the first step that did not complete.",
      action: { label: "Inspect", path: missionPath(work.id) },
      acknowledgeable: true,
      at,
    }];
  }

  // A decision is raised from the approval itself, which names the step.
  if (!reading.blocked || reading.blocked.kind === "approval") return [];

  if (reading.blocked.kind === "agent_unavailable") {
    const agentId = reading.blocked.agentId;

    return [{
      ...shared,
      id: `agent:${work.id}`,
      kind: "agent_unavailable",
      severity: "action",
      level: levelFor("high", work),
      source: "workforce",
      label: "Assigned to an agent who cannot work",
      detail: reading.blocked.reason,
      consequence: "That step cannot start until the agent is active again or the mission is re-planned.",
      action: agentId && input.agentIds.has(agentId)
        ? { label: "Review agent", path: `/agents/${agentId}` }
        : { label: "Open mission", path: missionPath(work.id) },
      acknowledgeable: false,
      agentId,
      at: reading.lastActivityAt,
    }];
  }

  if (seen(work, reading.lastActivityAt)) return [];

  return [{
    ...shared,
    id: `stalled:${work.id}`,
    kind: "stalled",
    severity: "action",
    level: levelFor("high", work),
    source: "queue",
    label: "Stalled",
    detail: reading.blocked.reason,
    consequence:
      "Nothing will move this on its own. Open it to plan, run or retry it, or mark it as seen if it no longer matters.",
    action: { label: "Open mission", path: missionPath(work.id) },
    acknowledgeable: true,
    at: reading.lastActivityAt,
  }];
}

/**
 * A queued job that has already used an attempt is the queue picking a mission
 * back up - the one recovery the system performs by itself. It needs nobody.
 */
function recoveringItem(job: ExecutionJob, work: WorkSummary | undefined): AttentionItem[] {
  if (job.status !== "queued") return [];
  if (job.attempts === 0 && !job.lastError) return [];

  // A job whose mission is not in view cannot be shown as a mission, and an
  // entry pointing at nothing is worse than one fewer line.
  if (!work) return [];

  return [{
    id: `recovering:${job.id}`,
    kind: "recovering",
    severity: "watch",
    level: "low",
    source: "queue",
    label: job.reason === "recovered"
      ? "Picked back up after a worker stopped"
      : `Retrying on attempt ${job.attempts + 1}`,
    detail: publicFailureReason(job.lastError) ?? clip(work.objective, 200),
    consequence: "UNI-OFFICE is handling this. A worker resumes it without you.",
    action: { label: "Watch it", path: missionPath(job.workId) },
    acknowledgeable: false,
    workId: job.workId,
    objective: clip(work.objective, 200),
    at: job.updatedAt,
  }];
}

function conflictItem(entry: AttentionInput["conflicts"][number]): AttentionItem[] {
  // Both sides are read inside the organization; a side that could not be
  // read is not described with a guess.
  if (!entry.left || !entry.right) return [];

  return [{
    id: `conflict:${entry.conflict.id}`,
    kind: "conflict",
    severity: "review",
    level: "normal",
    source: "knowledge",
    label: "Company knowledge disagrees",
    detail: `“${clip(entry.left.title, 110)}” and “${clip(entry.right.title, 110)}”`,
    consequence: "Planning is handed both, marked as disagreeing, until a person settles it.",
    action: { label: "Settle it", path: `/brain/${entry.left.id}` },
    acknowledgeable: false,
    at: entry.conflict.detectedAt,
  }];
}

function lessonsItem(
  entry: AttentionInput["lessons"][number],
  work: WorkSummary | undefined,
): AttentionItem[] {
  if (!work || entry.count === 0) return [];

  return [{
    id: `lessons:${work.id}`,
    kind: "lessons",
    severity: "review",
    level: "low",
    source: "knowledge",
    label: `${entry.count} ${plural(entry.count, "lesson")} waiting for a decision`,
    detail: clip(work.objective, 200),
    consequence: "Until someone keeps or discards them, later missions only get them as unverified leads.",
    action: { label: "Decide", path: `${missionPath(work.id)}#debrief` },
    acknowledgeable: false,
    workId: work.id,
    objective: clip(work.objective, 200),
    at: entry.at,
  }];
}
