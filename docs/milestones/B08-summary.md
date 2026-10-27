# B08 fulfilment, returns, refunds, and COD collection summary

Status: READY_FOR_REVIEW on 2026-10-27 after independent local verification. B07 acceptance and evidence were confirmed before implementation. B08 is not owner-accepted; owner policy, Postman, provider test-mode, production MySQL, and live-authorisation gates remain open.

## Scope completed

- Authenticated seller-only processing and delivery/pickup dispatch states, plus admin completion/cancellation states, locked transitions, cross-seller isolation, aggregate order progress, immutable Lagos estimate/pickup snapshots, and fulfilment audit events.
- Customer/guest pre-fulfilment cancellation with one-time reservation/stock release. Paid cancellations are routed to return/refund review rather than silently reversing money.
- Exact COD cash recording after delivery, idempotent collection references, separate admin confirmation/rejection, and explicit earnings ineligibility until confirmation.
- Owner-protected, item/quantity-bounded, idempotent return requests with configurable fail-closed window and admin approval/rejection with explicit stock disposition.
- Partial/full Paystack refund lifecycle through a dedicated adapter, with persisted intent before network calls, exact amount/currency checks, provider-ID reconciliation, signed refund webhook handling, deduplication, delayed/needs-attention/failed states, and no blind retry after an uncertain create timeout.
- One immutable customer-payment debit per processed refund, exact cumulative commission and seller-net reversal obligations, full-order status transition, and controlled B07 late-payment refunds.
- `seller_refund_adjustments` records what B09 must classify against actual held/available/paid earnings. No payout state or recoverable balance is fabricated before B09's ledger exists.
- Migration/rollback, fail-closed environment placeholders, test-key-only provider acceptance script, refund reconciliation worker, API/OpenAPI/README/ADR documentation, guarded fixtures, and maintained Postman requests.

## Changed areas

- Database: migration 009 adds fulfilment events, COD collections, returns/items, refunds, seller refund adjustments, pickup states, fulfilment timestamps, seller status actors, and refund-linked payment ledger debits.
- Application: `src/fulfilment/`, `src/refunds/`, application/server wiring, signed refund-event routing, B07 ledger logical keys, and B08 policy configuration.
- Operations: `refunds:reconcile`, `refunds:verify-provider`, `.env.example`, and guarded seed wording.
- Tests: refund adapter unit tests, B08 access API tests, seven MariaDB fulfilment/refund scenarios, expanded migration expectations, and a migration-timeout correction for the growing suite.
- Contracts/docs: fulfilment/refund API guide, OpenAPI, ADR 0009, README, Postman collection/environment, tracker, closeout and evidence.

## Migration and recovery

Migration 009 is additive except for controlled enum/index changes. It preserves B07 ledger rows by assigning stable logical keys before replacing the old two-column uniqueness rule. The dedicated payment index preserves the existing payment foreign key.

The down migration is destructive: it deletes refund debit entries, seller refund adjustments, refunds, return requests/items, COD collections and fulfilment events; remaps pickup-only states; removes fulfilment timestamps; and removes seller actor typing. Before any non-disposable rollback, stop API/refund workers, back up every B08 table plus orders/suborders/items/reservations/products/payments/payment ledger/review cases/outbox, reconcile every provider refund and COD collection, preserve finance/audit exports, and prefer a reviewed forward migration.

Migration 009 applied to local `legit_hair_app` and repeatedly rolled down/up on guarded `legit_hair_app_test` using MariaDB 10.4.32. This is not production MySQL evidence.

## Verification

ESLint, TypeScript, build, 16 unit tests, 18 Supertest API tests, and 51 MariaDB integration tests passed with zero assertion failures or skips through the documented host shim. Totals: 85 passing; seven integration scenarios are B08-specific. Normal tsx npm wrappers remain host-blocked before discovery by `uv_os_get_passwd`/ENOMEM and are reported separately.

Postman JSON and OpenAPI YAML parse successfully. Manual owner Postman execution and Paystack refund test-mode acceptance did not occur.

## Postman usage

Use only the guarded `_test` database. Configure synthetic B06 order values, `COD_ENABLED=true`, `RETURN_WINDOW_DAYS=14`, and `REFUND_DELIVERY_MODE=full_order`; migrate and seed; then run B05 through B07 to create and complete the disposable test order before running B08. Positive refund requests require an owner-supplied backend-only `sk_test_...` key and a completed test transaction. Never add the key to Postman or run these requests with live credentials.

## Open gates and limitations

- Owner approval of return window, delivery-fee refund treatment, earnings hold, cancellation/refund policy, and treatment after seller payout.
- Paystack test-mode create/fetch/webhook evidence and owner Postman execution.
- Production MySQL compatibility, deployment scheduling, public TLS/webhook reachability, and live money authorisation.
- B09 must classify refund adjustments against the actual earnings/payout ledger and create finance recoverable balances when already-paid earnings are reversed.
- COD production eligibility/reconciliation policy and B06 commission/reservation policy remain unresolved; production order creation stays fail-closed.
- Earlier Dojah, consent, real seller approval, production image storage, pickup, courier, and production email gates remain unchanged.
