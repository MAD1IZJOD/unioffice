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
}
