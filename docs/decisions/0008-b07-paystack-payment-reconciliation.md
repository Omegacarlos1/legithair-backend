# ADR 0008: Paystack payment verification and late-payment handling

Date: 2026-10-26

Status: accepted implementation boundary; provider and production policy gates remain open

## Context

B07 must accept NGN through Paystack without trusting browser callbacks, double-delivering value, or overselling after a reservation expires. The production Paystack account is not yet configured, and B06's reservation duration and commission policy remain owner decisions.

## Decision

- The backend generates and persists one Paystack reference per order before any provider call. Initialization sends the server-side order total, `NGN`, customer email, and `order_id`/`payment_id` metadata.
- Browser verification supplies an order ID and reference, but the backend requires the reference to equal the persisted reference and independently queries Paystack. A callback is never proof of payment.
- Paystack webhooks are authenticated over the exact raw request bytes with HMAC SHA-512 and the server-side secret, following the current official Paystack webhook contract. Provider event identifiers are deduplicated in the database.
- Amount, currency, reference, and metadata association must all match. Successful settlement locks the payment, order, and reservations; marks the order paid; consumes active reservations; appends one payment ledger entry; creates one immutable JSON receipt; and enqueues one deduplicated receipt email in a single database transaction.
- A successful payment received after reservation expiry, release, cancellation, or another invalid state does not mark the order paid and never decrements stock again. It is recorded as `late_success`, gets a distinct ledger entry, and opens a `late_payment` review case for controlled refund or manual resolution. Refund execution belongs to B08.
- Provider timeouts retain the original reference and pending attempt for safe retry and reconciliation. `npm run payments:reconcile` verifies pending references; it never creates a replacement charge.

## Consequences

Local fake-provider tests can establish idempotency, rollback, signature, mismatch, timeout, and late-payment behavior. They do not prove Paystack account configuration, dashboard webhook delivery, public TLS reachability, or live settlement. The separate acceptance command refuses live keys and requires an explicit test recipient. Production payment creation remains indirectly fail-closed while B06 order policy is unapproved and directly unavailable when `PAYSTACK_SECRET_KEY` is absent.

Official contracts consulted on 2026-10-26:

- <https://paystack.com/docs/api/transaction/>
- <https://paystack.com/docs/payments/webhooks/>
- <https://paystack.com/docs/payments/accept-payments/>
