# Seller earnings and payouts

B09 uses integer NGN minor units and an append-only seller ledger. Delivery fees remain company funds; seller earnings use the immutable `seller_net_minor` snapshot, which already reflects the order/item commission snapshot. Eligible Paystack orders require a succeeded payment; COD orders additionally require confirmed collection.

`EARNINGS_HOLD_DAYS` has no default. Until it is approved and configured, earnings accrual is fail-closed. `PAYOUTS_ENABLED` defaults to `false` and independently prevents money movement. The release worker is `npm run earnings:sync`.

Balances are separate ledger buckets: `held`, `available`, `reserved`, `paid`, and `recoverable`. Payout reservations debit available and credit reserved atomically. A successful transfer moves reserved to paid; a failed/reversed transfer restores available exactly once. Processed refunds consume held then available; any remainder becomes a finance-managed recoverable balance and never makes available negative.

Finance-only routes are:

- `PUT /api/v1/admin/sellers/:sellerId/payout-recipient` binds a Paystack recipient code already verified outside this API.
- `POST /api/v1/admin/payouts` requires `Idempotency-Key` and `{ "sellerId": "uuid", "amountMinor": 1000 }`.
- `GET /api/v1/admin/payouts/:payoutId` reads transfer state.
- `POST /api/v1/admin/payouts/:payoutId/reconcile` verifies the original durable reference.

Provider timeouts become `initiation_uncertain`; no new transfer reference is generated. Run `npm run payouts:reconcile` or use the reconciliation route. Signed `transfer.success`, `transfer.failed`, and `transfer.reversed` webhook events are accepted at the existing Paystack webhook URL and deduplicated.
