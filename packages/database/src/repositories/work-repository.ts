import type {
  Work,
  WorkId,
  OrganizationId,
} from "@unioffice/core";

export interface WorkRepository {
  create(work: Work): Promise<Work>;

  findById(id: WorkId): Promise<Work | null>;

  findByOrganization(
    organizationId: OrganizationId,
  ): Promise<Work[]>;

  update(work: Work): Promise<Work>;

  delete(id: WorkId): Promise<void>;
}