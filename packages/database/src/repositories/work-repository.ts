import type {
  Work,
  WorkId,
  WorkStatus,
  OrganizationId,
} from "@unioffice/core";

export interface WorkRepository {
  create(work: Work): Promise<Work>;

  findById(id: WorkId): Promise<Work | null>;

  findByOrganization(
    organizationId: OrganizationId,
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

  delete(id: WorkId): Promise<void>;
}