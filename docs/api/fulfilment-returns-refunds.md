# Fulfilment, returns, refunds, and COD collection API

All routes use the standard success/error envelope. Customer routes accept either the owning customer's bearer token or the guest order's `X-Order-Tracking-Token`. Seller routes require the seller role and always resolve the seller from the authenticated account; a caller cannot supply another seller ID. Admin routes require the admin role.

## Fulfilment progress

`PATCH /api/v1/seller/orders/:orderId/status` accepts `processing`, `shipped`, or `ready_for_pickup`. A delivery portion follows `pending -> processing -> shipped`; a pickup portion follows `pending -> processing -> ready_for_pickup`. The authenticated seller can change only its own portion.

`PATCH /api/v1/admin/orders/:orderId/suborders/:suborderId/status` completes delivery with `shipped -> delivered`, completes pickup with `ready_for_pickup -> picked_up`, and may cancel an eligible unpaid COD portion before completion. Paid cancellations must use the return/refund workflow. Invalid jumps and delivery/pickup state mixing return `409`.

`GET /api/v1/orders/:orderId/fulfilment` returns aggregate status, seller portions, the immutable Lagos delivery estimate or pickup snapshot, and COD collection state. Order-level status advances only from locked seller-portion state; mixed-seller progress remains visible per portion.

`POST /api/v1/orders/:orderId/cancel` accepts `{ "reason": "..." }`. It cancels only an owned order whose portions are still pending and whose payment does not require a refund. Active stock reservations are released exactly once. A paid order returns `409 PAID_CANCELLATION_REQUIRES_RETURN`.

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

Items must belong to the owned order, their seller portion must be delivered or picked up, the configured window must remain open, and cumulative non-rejected return quantities cannot exceed the purchase. Identical key/input replays return `200`; a changed replay returns `409`. `GET /api/v1/orders/:orderId/returns` exposes review and refund outcomes.

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
