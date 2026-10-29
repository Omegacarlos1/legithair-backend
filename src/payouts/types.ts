export interface EarningsPolicy { holdDays?: number; payoutsEnabled: boolean }

export interface EarningsBalance {
  sellerId: string;
  currency: 'NGN';
  heldMinor: number;
  availableMinor: number;
  reservedMinor: number;
  paidMinor: number;
  recoverableMinor: number;
  holdDays: number | null;
  policyConfigured: boolean;
}
