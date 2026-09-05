import type {
  Event,
  OrganizationId,
  WorkId,
} from "@unioffice/core";

export interface EventRepository {
  create(event: Event): Promise<Event>;

  findByWork(workId: WorkId): Promise<Event[]>;

  /** Most recent events across the organization, newest first. */
  findByOrganization(
    organizationId: OrganizationId,
    limit?: number,
  ): Promise<Event[]>;
}
