# Fulfilment, returns, refunds, and COD collection API

All routes use the standard success/error envelope. Customer routes accept either the owning customer's bearer token or the guest order's `X-Order-Tracking-Token`. Seller routes require the seller role and always resolve the seller from the authenticated account; a caller cannot supply another seller ID. Admin routes require the admin role.

## Fulfilment progress

### Seller order workspace

`GET /api/v1/seller/orders?page=1&limit=20&status=pending&deliveryMethod=delivery` lists only the authenticated seller's portions, newest first. `status` and `deliveryMethod` are optional. `page` defaults to `1`; `limit` defaults to `20` and is capped at `100`. `GET /api/v1/seller/orders/:orderId` returns the matching detail, immutable items and seller-portion timeline. An unknown order and another seller's order both return `404 SELLER_ORDER_NOT_FOUND`.

Both reads return `version` and `allowedTransitions`. The delivery object is an immutable checkout snapshot. For company delivery it contains only the zone/estimate and deliberately omits the customer's recipient name, phone and street address. For pickup it contains the public pickup name, address and estimate.

```json
{
  "success": true,
  "data": {
    "sellerOrder": {
      "id": "92000000-0000-4000-8000-000000000001",
      "orderId": "90000000-0000-4000-8000-000000000001",
      "status": "processing",
      "version": 2,
      "allowedTransitions": ["shipped"],
      "orderStatus": "processing",
      "paymentMethod": "cod",
      "currency": "NGN",
      "delivery": { "method": "delivery", "zone": { "name": "Ikeja", "estimate": { "minBusinessDays": 1, "maxBusinessDays": 3 } } },
      "totals": { "itemsSubtotalMinor": 100000, "deliveryFeeMinor": 5000, "commissionMinor": 10000, "sellerNetMinor": 90000 },
      "itemCount": 1,
      "fulfilledAt": null,
      "createdAt": "2026-11-11T09:00:00.000Z",
      "updatedAt": "2026-11-11T09:05:00.000Z",
      "items": [{ "id": "91000000-0000-4000-8000-000000000001", "productId": "40000000-0000-4000-8000-000000000051", "productName": "Straight Wig", "quantity": 1, "unitPriceMinor": 100000, "lineTotalMinor": 100000, "commission": { "basis": "line_item_gross", "rateBps": 1000, "amountMinor": 10000 } }],
      "timeline": [{ "id": "suborder:17", "fromStatus": "pending", "toStatus": "processing", "reason": "Preparing order", "createdAt": "2026-11-11T09:05:00.000Z" }]
    }
  },
  "meta": { "requestId": "request-id" }
}
```

`PATCH /api/v1/seller/orders/:orderId/status` accepts `processing`, `shipped`, or `ready_for_pickup` and requires the last read `version` as `expectedVersion`:

```json
{ "status": "shipped", "expectedVersion": 2, "reason": "Handed to company dispatcher" }
```

The successful response uses the detail shape above at `data.sellerOrder`, with the incremented version. A stale browser must stop and refetch on this exact conflict; it must not silently retry with a guessed version:

```json
{
  "success": false,
  "error": {
    "code": "STALE_SELLER_ORDER_VERSION",
    "message": "Seller order changed after it was read",
    "details": { "expectedVersion": 2, "currentVersion": 3 }
  },
  "meta": { "requestId": "request-id" }
}
```

The complete transition matrix is:

| Actor | From | To | Constraint |
| --- | --- | --- | --- |
| Seller or admin | `pending` | `processing` | Parent order must be paid, COD-awaiting-collection, or already in fulfilment |
| Seller or admin | `processing` | `shipped` | Delivery orders only |
| Seller or admin | `processing` | `ready_for_pickup` | Pickup orders only; this is the seller pickup-readiness action |
| Admin only | `shipped` | `delivered` | Delivery orders only |
| Admin only | `ready_for_pickup` | `picked_up` | Pickup orders only |
| Admin only | `pending` or `processing` | `cancelled` | COD only; stock restoration is idempotent |

All other jumps return `409 INVALID_FULFILMENT_TRANSITION`; mixing delivery and pickup states returns `409 INVALID_DELIVERY_TRANSITION` or `409 INVALID_PICKUP_TRANSITION`. A seller cannot cancel, complete delivery/pickup, approve a return, or issue a refund. A syntactically valid transition on an awaiting-payment, failed, expired, cancelled, returned or refunded parent order returns `409 ORDER_NOT_FULFILLABLE`. For example, `pending -> shipped` is rejected:

```json
{
  "success": false,
  "error": { "code": "INVALID_FULFILMENT_TRANSITION", "message": "Suborder cannot transition from pending to shipped" },
  "meta": { "requestId": "request-id" }
}
```

`PATCH /api/v1/admin/orders/:orderId/suborders/:suborderId/status` completes delivery with `shipped -> delivered`, completes pickup with `ready_for_pickup -> picked_up`, and may cancel an eligible unpaid COD portion before completion. Paid cancellations must use the return/refund workflow. Invalid jumps and delivery/pickup state mixing return `409`.

`GET /api/v1/orders/:orderId/fulfilment` accepts either the owning customer bearer token or the guest order's `X-Order-Tracking-Token`. It returns aggregate status, seller portions, the immutable Lagos delivery estimate or pickup snapshot, COD collection state, and a chronological `timeline`. Order-level status advances only from locked seller-portion state; mixed-seller progress remains visible per portion. Timeline entries deliberately omit staff/user identifiers.

```json
{
  "success": true,
  "data": {
    "fulfilment": {
      "orderId": "90000000-0000-4000-8000-000000000001",
      "status": "shipped",
      "deliveryMethod": "delivery",
      "destination": { "method": "delivery", "zone": { "name": "Ikeja", "estimate": { "minBusinessDays": 1, "maxBusinessDays": 3 } } },
      "suborders": [{ "id": "92000000-0000-4000-8000-000000000001", "sellerId": "20000000-0000-4000-8000-000000000001", "status": "shipped", "fulfilledAt": null }],
      "timeline": [
        { "id": "order:41", "type": "order_status", "suborderId": null, "fromStatus": null, "toStatus": "awaiting_payment", "reason": "order_created", "createdAt": "2026-11-10T12:00:00.000Z" },
        { "id": "suborder:17", "type": "suborder_status", "suborderId": "92000000-0000-4000-8000-000000000001", "fromStatus": "processing", "toStatus": "shipped", "reason": null, "createdAt": "2026-11-10T15:00:00.000Z" }
      ],
      "codCollection": null,
      "codEarningsEligible": false
    }
  },
  "meta": { "requestId": "request-id" }
}
```

`POST /api/v1/orders/:orderId/cancel` accepts `{ "reason": "..." }`. It cancels only an owned order whose portions are still pending and whose payment does not require a refund. Active stock reservations are released exactly once. Once any seller starts processing, cancellation returns `409 ORDER_CANCELLATION_TOO_LATE`. A paid order returns `409 PAID_CANCELLATION_REQUIRES_RETURN`; the customer must use the item-level return workflow after fulfilment instead. Sellers have no cancellation or refund route.

## COD collection

`POST /api/v1/admin/orders/:orderId/cod-collection` requires `Idempotency-Key` and an exact body:

```json
{
  "amountMinor": 205000,
  "collectionReference": "COD-DISPATCH-2026-0001",
  "collectedAt": "2026-10-27T10:00:00.000Z"
}
```

The order must be a delivered/picked-up COD order and the amount must equal its immutable NGN total. Recording alone does not make seller earnings eligible. `PATCH /api/v1/admin/cod-collections/:collectionId` with `{ "action": "confirm", "note": "Cash matched dispatch record" }` marks the collection eligible for B09 earnings processing; `reject` leaves it ineligible. The collection reference and one-row-per-order constraint prevent duplicate reconciliation.

## Customer returns

`RETURN_WINDOW_DAYS` has no production default. When absent, return submission fails closed with `503 RETURN_POLICY_NOT_CONFIGURED`. Local tests use a synthetic 14-day window.

`POST /api/v1/orders/:orderId/returns` requires `Idempotency-Key`:

```json
{
  "items": [{ "orderItemId": "uuid", "quantity": 1 }],
  "reason": "Item differs from description"
}
```

`orderItemId` comes from the owned order detail/list response. Items must belong to the owned order, their seller portion must be delivered or picked up, the configured window must remain open, and cumulative non-rejected return quantities cannot exceed the purchase. Identical key/input replays return `200`; a changed replay returns `409`.

The current return contract accepts item quantities and a text reason only. It does not accept evidence URLs or files: durable production object storage and an upload authorization/retention contract remain open release gates. Frontends must not upload return evidence elsewhere or send undocumented fields; Zod rejects additional properties with `400`.

Creation returns `data.returnRequest` plus `data.idempotentReplay`. `GET /api/v1/orders/:orderId/returns` returns the same records under `data.returns`:

```json
{
  "id": "93000000-0000-4000-8000-000000000001",
  "orderId": "90000000-0000-4000-8000-000000000001",
  "reason": "Item differs from description",
  "status": "requested",
  "adminNote": null,
  "items": [{
    "orderItemId": "91000000-0000-4000-8000-000000000001",
    "quantity": 1,
    "itemRefundMinor": 100000,
    "commissionReversalMinor": 0,
    "sellerReversalMinor": 100000,
    "stockDisposition": "pending"
  }],
  "refund": null,
  "createdAt": "2026-11-10T16:00:00.000Z",
  "updatedAt": "2026-11-10T16:00:00.000Z"
}
```

## Admin review and Paystack refunds

`REFUND_DELIVERY_MODE` has no production default. Allowed reviewed values are `never` and `full_order`; approval fails closed while unset. A full-order delivery refund is included only when cumulative approved quantities cover the complete order. Item refunds always use immutable unit prices. Commission reversals use cumulative proportional allocation and the final unit receives any rounding remainder, so full refunds exactly reverse the snapshotted commission.

Reject with:

```json
{ "action": "reject", "adminNote": "Return condition did not meet policy" }
```

Approve with:

```json
{ "action": "approve", "adminNote": "Inspected and approved", "stockDisposition": "restock" }
```

Approval persists one refund before calling Paystack `POST /refund` with the original transaction reference, exact bounded amount and `NGN`. External calls occur outside the database transaction. `pending` and `processing` remain pending; `processed` appends one debit to the payment ledger, records seller/commission reversal obligations, resolves a late-payment review when applicable, and changes a completely refunded order to `refunded`. `failed` is recorded without a debit.

`POST /api/v1/admin/refunds/:refundId/reconcile` fetches the original Paystack refund ID. A timeout before Paystack returns an ID becomes `initiation_uncertain`; the backend does not blindly send another create-refund request because Paystack's contract does not provide a client idempotency key. Such cases require provider/dashboard review. A definitely unconfigured provider may be retried after a test key is configured.

`npm run refunds:reconcile` fetches up to 100 persisted `pending`, `processing`, or `needs_attention` refunds that already have provider IDs. It never creates a replacement refund and is safe to rerun.

Signed `refund.pending`, `refund.processing`, `refund.processed`, and `refund.failed` events use the existing raw-body HMAC SHA-512 Paystack endpoint. Association requires one unambiguous pending refund with the same transaction reference, amount, and currency. Ambiguous events deliver no value.

`POST /api/v1/admin/payment-review-cases/:caseId/refund` creates at most one full refund for a B07 `late_payment` review case. Duplicate calls reuse the persisted refund.

## Accounting boundary

Processed refunds create immutable customer-payment debit entries and `seller_refund_adjustments`. B08 records the exact gross, commission, and seller-net reversal obligation. B09 must classify each adjustment against held/available earnings or as a finance-managed recoverable balance after checking actual payout allocations; B08 does not invent a payout state before the earnings ledger exists.

Paystack test-mode/dashboard evidence, owner return/refund policy, owner Postman execution, and production MySQL verification remain separate acceptance gates. Never put a Paystack secret in Postman or frontend code, and do not run refund samples with a live key without explicit authorization.
