export type BasketOwner = { kind: 'customer'; userId: string } | { kind: 'guest'; token: string };

export interface GuestAddress {
  recipientName: string;
  phone: string;
  line1: string;
  line2?: string;
  city: string;
  state: string;
  countryCode: string;
}

export type QuoteInput =
  | { deliveryMethod: 'delivery'; zoneId: string; addressId?: string; address?: GuestAddress }
  | { deliveryMethod: 'pickup'; pickupLocationId: string };
