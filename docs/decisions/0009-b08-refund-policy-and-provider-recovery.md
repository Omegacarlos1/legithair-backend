# ADR 0009: B08 refund policy gates and provider recovery

Date: 2026-10-27

Status: accepted implementation boundary; owner policy and provider acceptance remain open

## Context

B08 must support partial/full returns, COD reconciliation, and Paystack refunds without inventing the owner's return window, delivery-fee treatment, or earnings-hold policy. Paystack refund creation can return a delayed status or time out before returning a provider refund ID. Its documented create-refund request has no client idempotency key.

## Decision

- `RETURN_WINDOW_DAYS` and `REFUND_DELIVERY_MODE` are optional, owner-controlled settings with no production defaults. Return submission or refund approval fails closed when the needed setting is absent. Automated tests use synthetic values only.
- Seller transitions resolve seller ownership from authentication. Admin delivery/pickup completion and customer order access remain separate permissions. Every transition is explicit and invalid jumps fail.
- COD collection is exact against the immutable order total. A recorded collection is not earnings-eligible until a separate admin reconciliation confirms it.
- Each return request is item/quantity bounded and idempotent. One return request can create only one provider refund. Commission reversals use cumulative proportional allocation and reconcile exactly when all units are refunded.
- The refund record commits before the provider call. Pending/processing results remain pending. Processed results append one immutable debit and seller reversal obligation. A create timeout without a provider refund ID becomes `initiation_uncertain` and is never blindly retried.
- Signed refund webhooks may advance a refund only when transaction reference, amount, currency, and a unique pending candidate agree. Duplicate webhook payloads are persisted and deduplicated.
- B08 records `seller_refund_adjustments` but does not fabricate whether earnings were held, available, or already paid. B09 classifies the obligation against its actual earnings/payout ledger; paid amounts become finance-managed recoverable balances there.

## Consequences

Independent local fulfilment and refund logic can be verified safely with fake providers and synthetic policy. Production returns remain unavailable until the owner approves policy, and real refund acceptance remains blocked until Paystack test credentials/dashboard evidence exist. The migration rollback deletes B08 fulfilment, collection, return, refund, reversal, and refund-debit evidence and is destructive outside a disposable schema.

Official Paystack contracts consulted on 2026-10-27:

- <https://paystack.com/docs/api/refund/>
- <https://paystack.com/docs/payments/refunds/>
- <https://paystack.com/docs/payments/webhooks/>
