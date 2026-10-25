export type PaymentMethod = 'paystack' | 'cod';
export type OrderStatus = 'awaiting_payment' | 'awaiting_collection' | 'paid' | 'payment_failed' | 'reservation_expired' | 'cancelled' | 'processing' | 'shipped' | 'delivered' | 'returned' | 'refunded';

export type OrderOwner =
  | { kind: 'customer'; userId: string }
  | { kind: 'guest'; basketToken: string };

export type OrderAccess =
  | { kind: 'customer'; userId: string }
  | { kind: 'guest'; trackingToken: string };

export interface OrderPolicy {
  reservationTtlSeconds?: number;
  commissionBasis?: 'line_item_gross';
  commissionRateBps?: number;
  codEnabled: boolean;
  guestTokenSecret?: string;
}
