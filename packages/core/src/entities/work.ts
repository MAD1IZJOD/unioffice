import type {
  OrganizationId,
  UserId,
  WorkspaceId,
  WorkId,
} from "../types/ids.js";

export type WorkStatus =
  | "queued"
  | "planning"
  | "executing"
  | "waiting_approval"
  | "completed"
  | "failed"
  | "cancelled";

export type WorkPriority =
  | "low"
  | "normal"
  | "high"
  | "critical";

export interface Work {
  id: WorkId;

  organizationId: OrganizationId;

  workspaceId?: WorkspaceId;

  requesterId: UserId;

  objective: string;

  status: WorkStatus;

  priority: WorkPriority;

  createdAt: Date;

  updatedAt: Date;

  startedAt?: Date;

  completedAt?: Date;

  metadata: Record<string, unknown>;
}

/**
 * Who started a mission, as the mission row says.
 *
 * Only a schedule writes the mark, and nothing a caller sends can set it - a
 * mission's metadata is written by the system alone - so a mission without
 * one was started by a person.
 */
export function missionStarterOf(work: Pick<Work, "metadata">): "schedule" | "person" {
  return work.metadata?.startedBy === "schedule" ? "schedule" : "person";
}
