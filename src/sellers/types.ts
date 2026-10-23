export type SellerIdentityStatus = 'not_started' | 'pending' | 'verified' | 'failed' | 'manual_review';
export type SellerApprovalStatus = 'pending' | 'approved' | 'suspended';

export interface SellerProfile {
  id: string;
  userId: string;
  businessName: string;
  phone: string;
  identityStatus: SellerIdentityStatus;
  approvalStatus: SellerApprovalStatus;
  approvalReason: string | null;
  approvedBy: string | null;
  approvedAt: Date | null;
  suspendedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
