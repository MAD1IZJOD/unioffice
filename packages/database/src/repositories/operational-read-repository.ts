import type {
  AgentId,
  Event,
  EventType,
  OrganizationId,
  TaskId,
  TaskStatus,
  Work,
  WorkId,
  WorkPriority,
  WorkspaceId,
  WorkStatus,
} from "@unioffice/core";

/**
 * Reading the company's operational state, cheaply.
 *
 * The Command Center needs to know what every mission is doing, not what every
 * mission contains. Reading whole work rows for that meant shipping plans,
 * briefings and anything else ever written into metadata - on the live store
 * one early test row alone carried 900 KB - on every live refresh. These reads
 * select the handful of fields an operational view is built from and nothing
 * else.
 *
 * Kept apart from WorkRepository and friends, the same way event tailing and
 * knowledge search are, so the many callers and test doubles of the CRUD
 * contracts never have to know these projections exist.
 */

/** Longest stored error text carried in a summary. */
export const SUMMARY_TEXT_LIMIT = 500;

/**
 * Longest objective carried in a summary. Objectives were unbounded before
 * the API limited them, and early test rows on the live store hold objectives
 * hundreds of kilobytes long. PostgREST cannot shorten a column in a select,
 * so the row still arrives whole from the database; what is bounded is
 * everything handed on from here.
 */
export const SUMMARY_OBJECTIVE_LIMIT = 400;

export interface WorkSummary {
  id: WorkId;
  organizationId: OrganizationId;
  workspaceId?: WorkspaceId;
  objective: string;
  status: WorkStatus;
  priority: WorkPriority;
  createdAt: Date;
  updatedAt: Date;
  startedAt?: Date;
  completedAt?: Date;

  /** Why planning stopped, as the backend recorded it. Raw; not for display. */
  planningError?: string;
  /** Why execution stopped, as the backend recorded it. Raw; not for display. */
  executionError?: string;
  /** The run was cut short by a process stopping, not by the work. */
  interrupted: boolean;
  /** When a person last said they had seen this mission's problem. */
  acknowledgedAt?: Date;

  /** A short name given when the mission was started from a template. */
  missionName?: string;
  templateName?: string;
}

export interface TaskSummary {
  id: TaskId;
  workId: WorkId;
  title: string;
  status: TaskStatus;
  assignedAgentId?: AgentId;
  startedAt?: Date;
  completedAt?: Date;
  updatedAt: Date;
}

export interface OperationalEventQuery {
  types: EventType[];
  /** Narrows to these missions. Absent reads across the organization. */
  workIds?: WorkId[];
  limit: number;
}

export interface OperationalReadRepository {
  /** Summaries of the organization's missions, most recently changed first. */
  findWorkSummaries(
    organizationId: OrganizationId,
    limit: number,
  ): Promise<WorkSummary[]>;

  /**
   * Summaries of the steps of these missions.
   *
   * Tasks carry no organization of their own, so the caller must pass only
   * mission ids it has already read inside the organization.
   */
  findTaskSummaries(workIds: WorkId[]): Promise<TaskSummary[]>;

  /** Events of the given types, newest first, never outside the organization. */
  findEventsByTypes(
    organizationId: OrganizationId,
    query: OperationalEventQuery,
  ): Promise<Event[]>;
}

/** The summary of a full work row, computed exactly as the database projects it. */
export function summarizeWork(work: Work): WorkSummary {
  const acknowledged = work.metadata.acknowledged as { at?: unknown } | undefined;
  const template = work.metadata.template as { name?: unknown } | undefined;

  return {
    id: work.id,
    organizationId: work.organizationId,
    workspaceId: work.workspaceId,
    objective: boundedObjective(work.objective),
    status: work.status,
    priority: work.priority,
    createdAt: work.createdAt,
    updatedAt: work.updatedAt,
    startedAt: work.startedAt,
    completedAt: work.completedAt,
    planningError: boundedText(work.metadata.planningError),
    executionError: boundedText(work.metadata.executionError),
    interrupted: isInterruptedFlag(work.metadata.interrupted),
    acknowledgedAt: dateOf(acknowledged?.at),
    missionName: boundedText(work.metadata.missionName),
    templateName: boundedText(template?.name),
  };
}

/**
 * Whether a run was cut short by its process stopping. Recorded two ways: the
 * worker writes `true`, and startup reconciliation writes an object saying
 * when it noticed and how many steps were caught mid-flight. Both mean the
 * same thing; a string or a number is not a flag.
 */
export function isInterruptedFlag(value: unknown): boolean {
  return value === true || (typeof value === "object" && value !== null && !Array.isArray(value));
}

export function boundedObjective(objective: string): string {
  return objective.length <= SUMMARY_OBJECTIVE_LIMIT
    ? objective
    : `${objective.slice(0, SUMMARY_OBJECTIVE_LIMIT - 1)}…`;
}

export function boundedText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;

  const trimmed = value.trim();
  if (!trimmed) return undefined;

  return trimmed.length <= SUMMARY_TEXT_LIMIT
    ? trimmed
    : trimmed.slice(0, SUMMARY_TEXT_LIMIT);
}

export function dateOf(value: unknown): Date | undefined {
  if (typeof value !== "string" && !(value instanceof Date)) return undefined;

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}
