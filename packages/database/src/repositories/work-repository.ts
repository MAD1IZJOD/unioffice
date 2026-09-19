import type {
  Work,
  WorkId,
  WorkStatus,
  OrganizationId,
  WorkspaceId,
} from "@unioffice/core";

export interface WorkRepository {
  create(work: Work): Promise<Work>;

  findById(id: WorkId): Promise<Work | null>;

  findByOrganization(
    organizationId: OrganizationId,
  ): Promise<Work[]>;

  /** The work opened inside one workspace, newest first. */
  findByWorkspace(
    organizationId: OrganizationId,
    workspaceId: WorkspaceId,
  ): Promise<Work[]>;

  /**
   * Work in any of the given states, across every organization. Used at
   * startup to find runs an earlier process left behind.
   */
  findByStatuses(
    statuses: WorkStatus[],
    limit?: number,
  ): Promise<Work[]>;

  update(work: Work): Promise<Work>;

  /**
   * Moves work from one status to another only if it is still in `from`,
   * and returns it - or null when something else changed it first.
   *
   * A whole-row update from an in-memory copy is last-writer-wins, so two
   * callers racing for the same transition (starting a plan and cancelling,
   * say) can silently undo each other. This is the transition done as one
   * conditional write instead. Optional so test doubles need not provide it.
   */
  transitionStatus?(
    id: WorkId,
    from: WorkStatus,
    to: WorkStatus,
    at: Date,
  ): Promise<Work | null>;

  delete(id: WorkId): Promise<void>;
}