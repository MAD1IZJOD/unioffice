import type {
  ApprovalRequest,
  ExecutionJob,
  OrganizationId,
  Work,
  WorkId,
} from "@unioffice/core";

import type {
  ApprovalRepository,
  ExecutionJobRepository,
  WorkRepository,
} from "@unioffice/database";

/**
 * What is genuinely waiting on a person, and what is merely worth knowing.
 *
 * This used to be worked out in the browser from the overview payload, which
 * meant it could only see the eight active and six recently finished missions
 * that read happens to carry. A mission that failed while thirty others were
 * opened after it simply stopped being mentioned - it had not been dealt
 * with, it had fallen off the end of an array.
 *
 * Everything here is a row. A pending approval, a work item the backend
 * marked failed, a queue job that has burned an attempt. Nothing is
 * synthesised to keep the list from being empty, because empty is the correct
 * and common answer and the product should be able to say so plainly.
 */

export type AttentionKind =
  | "decision"
  | "failure"
  | "interrupted"
  | "recovering";

/**
 * The distinction the whole layer exists for.
 *
 * `action` is stopped and will stay stopped until a person does something.
 * `watch` is the system handling something itself, which is worth seeing and
 * is not a task. Mixing the two is how an attention queue becomes an alarm
 * nobody reads.
 */
export type AttentionSeverity = "action" | "watch";

export interface AttentionItem {
  id: string;
  kind: AttentionKind;
  severity: AttentionSeverity;

  /** What it is, in a few words. */
  label: string;
  /** Why it is here. */
  detail: string;
  /** What happens next, or what a person can do about it. */
  consequence: string;

  workId: WorkId;
  /** The objective this belongs to, so a queue entry names its own mission. */
  objective: string;
  taskId?: string;
  agentId?: string;

  at: Date;
}

export interface AttentionQueue {
  items: AttentionItem[];
  /** How many need a person. */
  actionCount: number;
  /** How many are the system telling you what it is doing. */
  watchCount: number;
  /** Everything found, which can exceed what is returned. */
  total: number;
}

/**
 * Decisions outrank failures because a decision is blocking a live operation
 * right now, while a failed mission has already stopped and will wait. Both
 * outrank a recovery, which is the system doing its job.
 */
const KIND_RANK: Record<AttentionKind, number> = {
  decision: 0,
  failure: 1,
  interrupted: 2,
  recovering: 3,
};

const DEFAULT_LIMIT = 25;

export class AttentionService {
  constructor(
    private readonly approvalRepository: ApprovalRepository,
    private readonly workRepository: WorkRepository,
    private readonly executionJobRepository: ExecutionJobRepository,
  ) {}

  async getQueue(
    organizationId: OrganizationId,
    options: { limit?: number } = {},
  ): Promise<AttentionQueue> {
    const [approvals, allWork, jobs] = await Promise.all([
      this.approvalRepository.findPendingByOrganization(organizationId),
      this.workRepository.findByOrganization(organizationId),
      this.executionJobRepository.findByOrganization(organizationId, 100),
    ]);

    const byId = new Map<WorkId, Work>(allWork.map((work) => [work.id, work]));

    const items = [
      ...approvals.map((approval) => decisionItem(approval, byId)),
      ...allWork.flatMap((work) => stoppedItem(work)),
      ...jobs.flatMap((job) => recoveringItem(job, byId)),
    ].sort(order);

    return {
      items: items.slice(0, options.limit ?? DEFAULT_LIMIT),
      actionCount: items.filter((item) => item.severity === "action").length,
      watchCount: items.filter((item) => item.severity === "watch").length,
      total: items.length,
    };
  }
}

/** Newest first within a kind; kinds in the order above. */
function order(left: AttentionItem, right: AttentionItem): number {
  const byKind = KIND_RANK[left.kind] - KIND_RANK[right.kind];

  return byKind !== 0 ? byKind : right.at.getTime() - left.at.getTime();
}

function decisionItem(
  approval: ApprovalRequest,
  work: Map<WorkId, Work>,
): AttentionItem {
  return {
    id: `approval:${approval.id}`,
    kind: "decision",
    severity: "action",
    label: approval.action,
    detail: approval.reason,
    consequence:
      "The mission is stopped here. Approving puts it back on the queue; rejecting means the step is not taken.",
    workId: approval.workId,
    objective: work.get(approval.workId)?.objective ?? "",
    taskId: approval.taskId,
    agentId: approval.agentId,
    at: approval.createdAt,
  };
}

function stoppedItem(work: Work): AttentionItem[] {
  if (work.status !== "failed") return [];

  const at = work.completedAt ?? work.updatedAt;

  // A run whose process died is not a run that went wrong. It is recoverable
  // and calling it a failure teaches people to ignore the word.
  if (work.metadata.interrupted) {
    return [
      {
        id: `interrupted:${work.id}`,
        kind: "interrupted",
        severity: "action",
        label: "Interrupted mid-run",
        detail: work.objective,
        consequence:
          "Finished tasks were kept. Resuming picks up from the first one that did not.",
        workId: work.id,
        objective: work.objective,
        at,
      },
    ];
  }

  return [
    {
      id: `failure:${work.id}`,
      kind: "failure",
      severity: "action",
      label: "Mission stopped",
      detail: textOf(work.metadata.executionError) ??
        textOf(work.metadata.planningError) ??
        work.objective,
      consequence:
        "Nothing finished was lost. A retry resumes from the first task that did not complete.",
      workId: work.id,
      objective: work.objective,
      at,
    },
  ];
}

/**
 * A queued job that has already burned an attempt is the queue picking a
 * mission back up, which is the only recovery the system genuinely performs.
 * It needs nobody, so it is information.
 */
function recoveringItem(
  job: ExecutionJob,
  work: Map<WorkId, Work>,
): AttentionItem[] {
  if (job.status !== "queued") return [];
  if (job.attempts === 0 && !job.lastError) return [];

  const objective = work.get(job.workId)?.objective;

  // A job whose work item no longer exists cannot be shown as a mission, and
  // a queue entry pointing at nothing is worse than one fewer line.
  if (!objective) return [];

  return [
    {
      id: `recovering:${job.id}`,
      kind: "recovering",
      severity: "watch",
      label:
        job.reason === "recovered"
          ? "Picked back up after a worker stopped"
          : `Retrying on attempt ${job.attempts + 1}`,
      detail: job.lastError ?? objective,
      consequence:
        "UNI-OFFICE is handling this. A worker resumes it without you.",
      workId: job.workId,
      objective,
      at: job.updatedAt,
    },
  ];
}

function textOf(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
