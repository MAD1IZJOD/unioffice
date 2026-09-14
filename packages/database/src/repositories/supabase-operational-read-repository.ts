import type {
  Event,
  EventId,
  OrganizationId,
  TaskId,
  WorkId,
} from "@unioffice/core";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  boundedObjective,
  boundedText,
  dateOf,
  type OperationalEventQuery,
  type OperationalReadRepository,
  type TaskSummary,
  type WorkSummary,
} from "./operational-read-repository.js";

/**
 * Only the fields an operational view needs. Metadata is read key by key, so a
 * plan, a briefing or anything else written there never leaves the database
 * on this path.
 */
const WORK_SUMMARY_COLUMNS = [
  "id",
  "organization_id",
  "workspace_id",
  "objective",
  "status",
  "priority",
  "created_at",
  "updated_at",
  "started_at",
  "completed_at",
  "planning_error:metadata->>planningError",
  "execution_error:metadata->>executionError",
  "interrupted:metadata->>interrupted",
  "acknowledged_at:metadata->acknowledged->>at",
  "mission_name:metadata->>missionName",
  "template_name:metadata->template->>name",
].join(",");

const TASK_SUMMARY_COLUMNS = [
  "id",
  "work_id",
  "title",
  "status",
  "assigned_agent_id",
  "started_at",
  "completed_at",
  "updated_at",
].join(",");

const EVENT_COLUMNS = [
  "id",
  "organization_id",
  "work_id",
  "task_id",
  "agent_id",
  "actor_type",
  "type",
  "timestamp",
  "payload",
].join(",");

/** Postgres takes a long IN list; a URL does not. Ids are chunked below this. */
const MAX_IDS_PER_REQUEST = 100;

export class SupabaseOperationalReadRepository implements OperationalReadRepository {
  constructor(private readonly client: SupabaseClient) {}

  async findWorkSummaries(
    organizationId: OrganizationId,
    limit: number,
  ): Promise<WorkSummary[]> {
    const { data, error } = await this.client
      .from("works")
      .select(WORK_SUMMARY_COLUMNS)
      .eq("organization_id", organizationId)
      .order("updated_at", { ascending: false })
      .limit(limit);

    if (error) {
      throw new Error(`Failed to read mission summaries: ${error.message}`);
    }

    return ((data ?? []) as unknown as WorkSummaryRow[]).map(toWorkSummary);
  }

  async findTaskSummaries(workIds: WorkId[]): Promise<TaskSummary[]> {
    const unique = [...new Set(workIds)];

    if (unique.length === 0) {
      return [];
    }

    const summaries: TaskSummary[] = [];

    for (let start = 0; start < unique.length; start += MAX_IDS_PER_REQUEST) {
      const { data, error } = await this.client
        .from("tasks")
        .select(TASK_SUMMARY_COLUMNS)
        .in("work_id", unique.slice(start, start + MAX_IDS_PER_REQUEST))
        .order("created_at", { ascending: true });

      if (error) {
        throw new Error(`Failed to read step summaries: ${error.message}`);
      }

      summaries.push(...((data ?? []) as unknown as TaskSummaryRow[]).map(toTaskSummary));
    }

    return summaries;
  }

  async findEventsByTypes(
    organizationId: OrganizationId,
    query: OperationalEventQuery,
  ): Promise<Event[]> {
    if (query.types.length === 0 || query.workIds?.length === 0) {
      return [];
    }

    let request = this.client
      .from("events")
      .select(EVENT_COLUMNS)
      .eq("organization_id", organizationId)
      .in("type", query.types);

    if (query.workIds) {
      request = request.in("work_id", [...new Set(query.workIds)].slice(0, MAX_IDS_PER_REQUEST));
    }

    const { data, error } = await request
      .order("timestamp", { ascending: false })
      .limit(query.limit);

    if (error) {
      throw new Error(`Failed to read operational events: ${error.message}`);
    }

    return ((data ?? []) as unknown as EventRow[]).map(toEvent);
  }
}

interface WorkSummaryRow {
  id: string;
  organization_id: string;
  workspace_id: string | null;
  objective: string;
  status: WorkSummary["status"];
  priority: WorkSummary["priority"];
  created_at: string;
  updated_at: string;
  started_at: string | null;
  completed_at: string | null;
  planning_error: string | null;
  execution_error: string | null;
  interrupted: string | null;
  acknowledged_at: string | null;
  mission_name: string | null;
  template_name: string | null;
}

interface TaskSummaryRow {
  id: string;
  work_id: string;
  title: string;
  status: TaskSummary["status"];
  assigned_agent_id: string | null;
  started_at: string | null;
  completed_at: string | null;
  updated_at: string;
}

interface EventRow {
  id: string;
  organization_id: string;
  work_id: string | null;
  task_id: string | null;
  agent_id: string | null;
  actor_type: Event["actorType"];
  type: Event["type"];
  timestamp: string;
  payload: Record<string, unknown> | null;
}

function toWorkSummary(row: WorkSummaryRow): WorkSummary {
  return {
    id: row.id as WorkId,
    organizationId: row.organization_id as OrganizationId,
    workspaceId: row.workspace_id ? (row.workspace_id as WorkSummary["workspaceId"]) : undefined,
    objective: boundedObjective(row.objective),
    status: row.status,
    priority: row.priority,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    startedAt: row.started_at ? new Date(row.started_at) : undefined,
    completedAt: row.completed_at ? new Date(row.completed_at) : undefined,
    planningError: boundedText(row.planning_error),
    executionError: boundedText(row.execution_error),
    // ->> renders a JSON true as the text "true" and an object as its JSON
    // text. Reconciliation at startup records an object; both are the flag.
    interrupted: row.interrupted === "true" || (row.interrupted?.trimStart().startsWith("{") ?? false),
    acknowledgedAt: dateOf(row.acknowledged_at),
    missionName: boundedText(row.mission_name),
    templateName: boundedText(row.template_name),
  };
}

function toTaskSummary(row: TaskSummaryRow): TaskSummary {
  return {
    id: row.id as TaskId,
    workId: row.work_id as WorkId,
    title: row.title,
    status: row.status,
    assignedAgentId: row.assigned_agent_id ? (row.assigned_agent_id as TaskSummary["assignedAgentId"]) : undefined,
    startedAt: row.started_at ? new Date(row.started_at) : undefined,
    completedAt: row.completed_at ? new Date(row.completed_at) : undefined,
    updatedAt: new Date(row.updated_at),
  };
}

function toEvent(row: EventRow): Event {
  return {
    id: row.id as EventId,
    organizationId: row.organization_id as OrganizationId,
    workId: row.work_id ? (row.work_id as WorkId) : undefined,
    taskId: row.task_id ? (row.task_id as Event["taskId"]) : undefined,
    agentId: row.agent_id ? (row.agent_id as Event["agentId"]) : undefined,
    actorType: row.actor_type,
    type: row.type,
    timestamp: new Date(row.timestamp),
    payload: row.payload ?? {},
    metadata: {},
  };
}
