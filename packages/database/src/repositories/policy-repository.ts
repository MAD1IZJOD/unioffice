import type {
  OrganizationId,
  Policy,
  PolicyId,
  PolicySubject,
} from "@unioffice/core";

export interface PolicyQuery {
  /** Narrows to one kind of rule. Omitted means both. */
  subject?: PolicySubject;

  /** Archived policies are excluded unless this is true. */
  includeArchived?: boolean;
}

export interface PolicyRepository {
  create(policy: Policy): Promise<Policy>;

  findById(id: PolicyId): Promise<Policy | null>;

  /** Every policy the organization has written, newest first. */
  findByOrganization(
    organizationId: OrganizationId,
    query?: PolicyQuery,
  ): Promise<Policy[]>;

  /**
   * The active policies only.
   *
   * This is the read on the execution path - it runs before a step and before
   * a tool call - so it is its own method rather than a filter applied after
   * fetching everything. The table is indexed for exactly this query.
   */
  findEnforced(organizationId: OrganizationId): Promise<Policy[]>;

  update(policy: Policy): Promise<Policy>;
}
