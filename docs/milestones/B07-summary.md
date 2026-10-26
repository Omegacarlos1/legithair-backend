# B07 Paystack payments and paid receipts summary

Status: READY_FOR_REVIEW on 2026-10-26 after local verification. B06 acceptance and its evidence were confirmed before implementation. B07 is not owner-accepted, and Paystack test-mode/provider acceptance remains open because no test credentials are configured.

## Scope completed

- Server-side Paystack NGN initialization with a persisted server-generated reference, account/guest email handling, exact database amount, fixed currency and order/payment metadata. One order has one recoverable attempt; provider calls remain outside database transactions.
- Owner-protected `POST /api/v1/payments/initialize`, `POST /api/v1/payments/verify` and downloadable JSON `GET /api/v1/orders/:orderId/receipt` routes for registered and guest orders.
- Current Paystack adapter for `POST /transaction/initialize` and `GET /transaction/verify/:reference`, bounded request timeout, fail-closed missing configuration, and a test-key-only provider acceptance command.
- Exact raw-body Paystack webhook HMAC SHA-512 validation using `X-Paystack-Signature`, persisted event deduplication, and safe replay after transaction failure.
- Validation of provider success, amount, `NGN`, reference, and `order_id`/`payment_id` association before value delivery. Browser-return reference tampering is rejected before a provider call.
- One atomic settlement transaction that locks the payment/order/reservations/products, consumes valid reservations, marks the order paid, increments paid-unit popularity, writes the payment ledger, creates an immutable receipt, inserts a deduplicated receipt-email job, records order status and creates an outbox event.
- Persisted mismatch review cases. Late success releases any still-active expired reservation once, records distinct late-payment money evidence, and opens controlled refund/manual review without marking paid, issuing a paid-order receipt, reacquiring stock or affecting a later reservation.
- Pending-payment reconciliation worker and crash recovery. Provider timeouts retain the original reference and do not create another attempt.
- Receipt-email rendering, secret/signature log redaction, configuration placeholders, migration/rollback, OpenAPI, API guide, ADR, README, guarded test fixtures, and B07 Postman samples.

## Changed files

- Database: migration 008 and rollback; migration integration expectations.
- Application: `src/payments/`, raw-body capture and router registration, Paystack configuration/server wiring, email receipt job support, and sensitive log redaction.
- Operations: `scripts/reconcile-payments.ts`, `scripts/verify-paystack.ts`, `.env.example`, and package scripts.
- Tests: Paystack adapter/signature unit tests, payment access API tests, and seven MariaDB payment/recovery scenarios.
- Contracts/docs: `docs/api/payments.md`, OpenAPI, ADR 0008, README, Postman collection/environment, tracker and B07 evidence.

## Migration and recovery

Migration 008 adds `payments`, `payment_webhook_events`, `payment_ledger_entries`, `payment_review_cases`, and `paid_receipts`. It adds nullable `durable_jobs.deduplication_key` with a unique index so existing jobs remain valid while logical receipt emails are unique.

The down migration permanently removes all B07 payment references, provider-event history, financial entries, review cases and receipts, then removes the job deduplication column. Before any non-disposable rollback: stop API payment traffic and reconciliation/email workers; back up all B07 tables plus orders/reservations/products/durable jobs; reconcile every pending or late provider reference; preserve receipts and ledger records for finance/audit; and use a reviewed forward migration where possible. Integration tests exercised full rollback only on the disposable `_test` schema.

Migration 008 applied successfully to local `legit_hair_app` and repeatedly to `legit_hair_app_test` on MariaDB 10.4.32. This does not prove production MySQL compatibility.

## Verification

ESLint, TypeScript, build, 13 unit tests, 15 Supertest API tests and 44 MariaDB integration tests passed with zero assertion failures or skips. Seven integration scenarios are B07-specific. The ordinary `tsx` npm test wrappers remain blocked before discovery by the Windows host `uv_os_get_passwd` ENOMEM issue; the established process-local shim executed the same TypeScript Mocha suites. Exact commands and outcomes are in `B07-test-results.md` and `docs/milestones/evidence/B07/`.

The Postman collection/environment JSON and OpenAPI YAML parse successfully. Manual owner Postman execution and real Paystack test-mode acceptance have not occurred.

## Provider checks and open gates

- Paystack configuration probe: no key configured. Test-mode initialization, hosted checkout, verification and dashboard webhook delivery are therefore unaccepted.
- Configure only an owner-supplied `sk_test_...` key, a test recipient and a public HTTPS webhook URL, then run `npm run payments:verify-provider` and the B07 Postman workflow. Never add the key to Postman or frontend code.
- Live keys, live payment/refund execution, production DNS/TLS/webhook reachability and real money movement require separate explicit authorisation.
- Production order creation remains fail-closed until the owner approves B06 reservation and commission policy. COD reconciliation is still unresolved. The production email sender/provider and production MySQL verification remain open.
- B08 must implement controlled refunds and resolution of `late_payment` review cases; B07 deliberately records but does not refund them.
- Earlier B03 Dojah, consent and real seller approval gates remain open and unchanged.

## Postman usage

Use the guarded disposable database: set `NODE_ENV=test`, point `DATABASE_NAME` to a name ending `_test`, run `npm run migrate` and `npm run seed:test`, and configure synthetic B06 reservation/commission values only for this isolated environment. Import both files in `postman/`, select Local, and run the B05 login/quote requests, B06 Paystack-order request, then the B07 folder in order. Open `paystackCheckoutUrl` to complete a test-mode payment, run verify, then download the receipt. A real signed webhook must come from Paystack to a public HTTPS endpoint; the collection intentionally contains only a forged-signature negative request.
