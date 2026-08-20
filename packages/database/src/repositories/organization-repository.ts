import type {
  Organization,
  OrganizationId,
} from "@unioffice/core";

export interface OrganizationRepository {
  create(
    organization: Organization,
  ): Promise<Organization>;

  findById(
    id: OrganizationId,
  ): Promise<Organization | null>;

  findBySlug(
    slug: string,
  ): Promise<Organization | null>;

  update(
    organization: Organization,
  ): Promise<Organization>;

  delete(id: OrganizationId): Promise<void>;
}