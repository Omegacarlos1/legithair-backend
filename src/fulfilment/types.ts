import type { OrderAccess } from '../orders/types.js';

export type SuborderStatus = 'pending' | 'processing' | 'ready_for_pickup' | 'shipped' | 'delivered' | 'picked_up' | 'cancelled' | 'returned' | 'refunded';

export interface FulfilmentPolicy {
  returnWindowDays?: number;
  refundDeliveryMode?: 'never' | 'full_order';
}

export interface ReturnItemInput { orderItemId: string; quantity: number }

export type ReturnOwner = OrderAccess;
