import type {
  ApprovalId,
  ApprovalRequest,
  OrganizationId,
  WorkId,
} from "@unioffice/core";

export interface ApprovalRepository {
  create(approval: ApprovalRequest): Promise<ApprovalRequest>;

  findById(id: ApprovalId): Promise<ApprovalRequest | null>;

  findByWork(workId: WorkId): Promise<ApprovalRequest[]>;

  findPendingByOrganization(
    organizationId: OrganizationId,
  ): Promise<ApprovalRequest[]>;

  update(approval: ApprovalRequest): Promise<ApprovalRequest>;

  /**
   * Persists a decision only while the request is still pending. A null result
   * means another actor already resolved it.
   */
  resolvePending(approval: ApprovalRequest): Promise<ApprovalRequest | null>;
}
