import {
  createEntityId,
  type ApprovalId,
  type ApprovalRequest,
  type OrganizationId,
  type Task,
  type Work,
  type WorkspaceId,
} from "@unioffice/core";

import type {
  ApprovalRepository,
  TaskRepository,
  WorkRepository,
} from "@unioffice/database";

import type { EventRecorder } from "./event-recorder.js";

export interface ApprovalCoordinator {
  requestApproval(work: Work, task: Task): Promise<Task>;
}

/**
 * Raised when an approval was already resolved by another actor. This is a
 * caller-visible conflict rather than a server fault, so the API maps it to 409.
 */
export class ApprovalConflictError extends Error {
  readonly approvalId: ApprovalId;

  constructor(approvalId: ApprovalId) {
    super(`Approval is already resolved: ${approvalId}`);
    this.name = "ApprovalConflictError";
    this.approvalId = approvalId;
  }
}

/** Coordinates durable approval decisions with the work and task lifecycle. */
export class WorkApprovalService implements ApprovalCoordinator {
  constructor(
    private readonly approvalRepository: ApprovalRepository,
    private readonly taskRepository: TaskRepository,
    private readonly workRepository: WorkRepository,
    private readonly eventRecorder: EventRecorder,
  ) {}

  async requestApproval(work: Work, task: Task): Promise<Task> {
    const approval = approvalMetadata(task);

    if (approval.requestId) {
      const existing = await this.approvalRepository.findById(
        approval.requestId as ApprovalId,
      );
      if (existing?.status === "pending") return task;
    }

    const now = new Date();
    const request = await this.approvalRepository.create({
      id: createEntityId<"ApprovalId">() as ApprovalId,
      organizationId: work.organizationId,
      workId: work.id,
      taskId: task.id,
      agentId: task.assignedAgentId,
      action: task.title,
      resource: `task:${task.id}`,
      reason: approval.reason ?? "Human approval is required before this task can execute.",
      status: "pending",
      createdAt: now,
      metadata: governingPolicy(approval),
    });

    const waitingTask = await this.taskRepository.update({
      ...task,
      status: "waiting",
      updatedAt: now,
      metadata: {
        ...task.metadata,
        approval: {
          ...approval,
          required: true,
          requestId: request.id,
          status: "pending",
          requestedAt: now.toISOString(),
        },
      },
    });

    await this.eventRecorder.record({
      organizationId: work.organizationId,
      workId: work.id,
      taskId: waitingTask.id,
      agentId: waitingTask.assignedAgentId,
      type: "approval.requested",
      payload: {
        approvalId: request.id,
        title: waitingTask.title,
        reason: request.reason,
      },
    });

    return waitingTask;
  }

  async getApproval(id: ApprovalId): Promise<ApprovalRequest> {
    const approval = await this.approvalRepository.findById(id);
    if (!approval) throw new Error(`Approval not found: ${id}`);
    return approval;
  }

  /**
   * What deciding an approval depends on, read before anyone decides it: the
   * workspace its mission is filed under, and whether a governance policy
   * rather than the planner put the step in front of a person. Another
   * organization's approval reads as not found.
   */
  async getDecisionContext(
    approvalId: ApprovalId,
    organizationId: OrganizationId,
  ): Promise<{ approval: ApprovalRequest; workspaceId?: WorkspaceId; governedByPolicy: boolean }> {
    const approval = await this.getApproval(approvalId);

    if (approval.organizationId !== organizationId) {
      throw new Error(`Approval not found: ${approvalId}`);
    }

    const [task, work] = await Promise.all([
      this.taskRepository.findById(approval.taskId),
      this.workRepository.findById(approval.workId),
    ]);

    if (!work || work.organizationId !== organizationId) {
      throw new Error(`Approval not found: ${approvalId}`);
    }

    return {
      approval,
      workspaceId: work.workspaceId,
      governedByPolicy: isGovernedByPolicy(approval, task),
    };
  }

  async getWorkApprovals(workId: Work["id"]): Promise<ApprovalRequest[]> {
    return this.approvalRepository.findByWork(workId);
  }

  async getPendingApprovals(
    organizationId: Work["organizationId"],
  ): Promise<ApprovalRequest[]> {
    return this.approvalRepository.findPendingByOrganization(organizationId);
  }

  async approve(
    approvalId: ApprovalId,
    resolvedBy: string,
    organizationId: OrganizationId,
  ): Promise<ApprovalRequest> {
    const { approval, task, work } = await this.loadPendingApproval(
      approvalId,
      organizationId,
    );
    const now = new Date();
    // Claim the transition first. If another decider already won, we must not
    // run any of the task/work/event side effects below.
    const resolvedApproval = await this.approvalRepository.resolvePending({
      ...approval,
      status: "approved",
      resolvedAt: now,
      resolvedBy,
    });

    if (!resolvedApproval) throw new ApprovalConflictError(approvalId);

    await this.taskRepository.update({
      ...task,
      status: "pending",
      updatedAt: now,
      metadata: {
        ...task.metadata,
        approval: {
          ...approvalMetadata(task),
          required: true,
          requestId: approval.id,
          status: "approved",
          resolvedAt: now.toISOString(),
          resolvedBy,
        },
      },
    });
    await this.workRepository.update({
      ...work,
      status: "queued",
      updatedAt: now,
      metadata: {
        ...work.metadata,
        waitingTaskId: undefined,
      },
    });
    await this.eventRecorder.record({
      organizationId: work.organizationId,
      workId: work.id,
      taskId: task.id,
      agentId: task.assignedAgentId,
      actorType: "user",
      actorId: resolvedBy,
      type: "approval.approved",
      payload: { approvalId: approval.id, title: task.title },
    });

    return resolvedApproval;
  }

  async reject(
    approvalId: ApprovalId,
    resolvedBy: string,
    organizationId: OrganizationId,
  ): Promise<ApprovalRequest> {
    const { approval, task, work } = await this.loadPendingApproval(
      approvalId,
      organizationId,
    );
    const now = new Date();
    // Same claim-before-effects ordering as approve().
    const resolvedApproval = await this.approvalRepository.resolvePending({
      ...approval,
      status: "rejected",
      resolvedAt: now,
      resolvedBy,
    });

    if (!resolvedApproval) throw new ApprovalConflictError(approvalId);

    await this.taskRepository.update({
      ...task,
      status: "failed",
      updatedAt: now,
      completedAt: now,
      metadata: {
        ...task.metadata,
        approval: {
          ...approvalMetadata(task),
          required: true,
          requestId: approval.id,
          status: "rejected",
          resolvedAt: now.toISOString(),
          resolvedBy,
        },
      },
    });
    await this.workRepository.update({
      ...work,
      status: "failed",
      updatedAt: now,
      completedAt: now,
      metadata: {
        ...work.metadata,
        executionError: `Approval rejected for task: ${task.title}`,
      },
    });
    await this.eventRecorder.record({
      organizationId: work.organizationId,
      workId: work.id,
      taskId: task.id,
      agentId: task.assignedAgentId,
      actorType: "user",
      actorId: resolvedBy,
      type: "approval.rejected",
      payload: { approvalId: approval.id, title: task.title },
    });
    await this.eventRecorder.record({
      organizationId: work.organizationId,
      workId: work.id,
      taskId: task.id,
      type: "work.failed",
      payload: { reason: `Approval rejected for task: ${task.title}` },
    });

    return resolvedApproval;
  }

  private async loadPendingApproval(
    approvalId: ApprovalId,
    organizationId: OrganizationId,
  ): Promise<{
    approval: ApprovalRequest;
    task: Task;
    work: Work;
  }> {
    const approval = await this.getApproval(approvalId);

    // A decision may only be made within the organization that owns the
    // approval. Without this, anyone could approve or reject any tenant's
    // pending request by id - and an approval, once granted, puts that
    // tenant's work straight onto the execution queue. Reported as not-found
    // so a foreign approval is indistinguishable from one that never existed.
    if (approval.organizationId !== organizationId) {
      throw new Error(`Approval not found: ${approvalId}`);
    }

    // Cheap pre-check only. resolvePending is what actually enforces the
    // invariant, because this read cannot be atomic with the later write.
    if (approval.status !== "pending") {
      throw new ApprovalConflictError(approvalId);
    }

    const task = await this.taskRepository.findById(approval.taskId);
    if (!task) throw new Error(`Task not found: ${approval.taskId}`);
    const work = await this.workRepository.findById(approval.workId);
    if (!work) throw new Error(`Work not found: ${approval.workId}`);
    return { approval, task, work };
  }
}

/**
 * Whether a governance policy, rather than the planner, put this step in
 * front of a person. Deciding those takes more authority than deciding a
 * planner's own request. Approvals raised before the policy was recorded on
 * the request fall back to the task, which has always carried it.
 */
export function isGovernedByPolicy(approval: ApprovalRequest, task?: Task | null): boolean {
  if (typeof approval.metadata.policyId === "string" || hasExternalWrites(approval.metadata) || typeof approval.metadata.skill === "string") return true;
  if (!task) return false;

  const metadata = approvalMetadata(task);
  return typeof metadata.policyId === "string" || hasExternalWrites(metadata) || typeof metadata.skill === "string";
}

/**
 * A step that writes to another system is decided with the same authority
 * as one a policy governs: an owner or admin, never a member approving an
 * agent's change to the company's GitHub on their own.
 */
function hasExternalWrites(metadata: Record<string, unknown>): boolean {
  return Array.isArray(metadata.externalWrites) && metadata.externalWrites.length > 0;
}

/** The policy fields worth keeping on the request itself; empty for planner-raised approvals. */
function governingPolicy(approval: Record<string, unknown>): Record<string, unknown> {
  const externalWrites = hasExternalWrites(approval)
    ? { externalWrites: (approval.externalWrites as unknown[]).filter((entry): entry is string => typeof entry === "string") }
    : {};

  // A skill that requires approval is company configuration, like a policy,
  // so it is decided with the same authority.
  const skill = typeof approval.skill === "string" ? { skill: approval.skill } : {};

  if (typeof approval.policyId !== "string") return { ...externalWrites, ...skill };

  return {
    ...externalWrites,
    ...skill,
    policyId: approval.policyId,
    ...(typeof approval.policyName === "string" ? { policyName: approval.policyName } : {}),
    ...(typeof approval.risk === "string" ? { risk: approval.risk } : {}),
  };
}

function approvalMetadata(task: Task): {
  required?: boolean;
  reason?: string;
  requestId?: string;
  status?: string;
  [key: string]: unknown;
} {
  const value = task.metadata.approval;
  return typeof value === "object" && value !== null
    ? value as {
        required?: boolean;
        reason?: string;
        requestId?: string;
        status?: string;
        [key: string]: unknown;
      }
    : {};
}
