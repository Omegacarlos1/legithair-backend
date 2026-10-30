# Legit Hair backend

B01-B11 provide the Express 5 and TypeScript backend foundation through fulfilment, payouts, purchase-linked reviews, merchandising, auditable reports, persistent support chat, and consent-controlled notifications.

## Local setup with XAMPP MariaDB

1. Start MariaDB from the XAMPP control panel.
2. In phpMyAdmin or the MariaDB CLI, create `legit_hair_development` and a least-privilege application user.
3. Copy `.env.example` to `.env` and fill in the local credentials. Application and migration commands automatically load this file.
4. Run `npm run migrate`, then `npm run dev`.

Use a separate database whose name ends in `_test` for integration tests. Local MariaDB verification does not establish compatibility with a production MySQL deployment; that remains a release gate.

## Commands

- `npm run lint`, `npm run typecheck`, `npm test`
- `npm run test:integration` (requires an isolated MariaDB test schema)
- `npm run test:socket` (requires the isolated MariaDB test schema and opens an ephemeral local Socket.IO server)
- `npm run migrate`, `npm run migrate:down`
- `npm run seed:test` (creates guarded synthetic B02-B11 fixtures, including customer, admin, finance, support, and two test-only approved sellers)
- `npm run orders:release-expired` (idempotently releases due B06 reservations; schedule this in deployed environments)
- `npm run payments:reconcile` (verifies persisted pending Paystack references; alerts with a non-zero exit on provider failures)
- `npm run payments:verify-provider` (explicit Paystack test-mode acceptance; refuses live keys)
- `npm run earnings:sync` (idempotently accrues and releases eligible seller earnings)
- `npm run payouts:reconcile` (verifies uncertain/pending transfers by their original reference)
- `npm run payouts:verify-provider` (verification-only Paystack test transfer check; refuses live keys)

## B02 authentication fixtures

After migrating the isolated `legit_hair_test` schema, run `npm run seed:test` with `NODE_ENV=test` and the test database variables. It creates the synthetic Postman users documented in the local environment, including two test-only sellers whose verified/approved state is never available outside a `_test` database. Never run it against a development or production database; the command rejects any database name that does not end in `_test`.

Local verification and password-reset messages are stored as pending `durable_jobs` records for the fake email workflow. The application stores only hashes of opaque authentication tokens; raw verification/reset tokens exist only in the queued email payload until delivery.
Run `npm run email:work-once` to process one ready message through the configured adapter; it reports only the provider result, never the recipient or token.

## Local Gmail delivery

Gmail is an opt-in local provider; automated tests continue to use the fake provider. Enable 2-Step Verification on the sending Google account, create an App Password at <https://myaccount.google.com/apppasswords>, and add the following only to the uncommitted `.env`:

```env
EMAIL_PROVIDER=gmail
EMAIL_FROM_NAME=Legit Hair
GMAIL_USER=your-address@gmail.com
GMAIL_APP_PASSWORD=your_16_character_app_password
EMAIL_WORKER_POLL_MS=2000
```

Use the App Password, not the normal Google account password. Spaces in the displayed App Password are accepted and removed during configuration parsing. Verify SMTP authentication with `npm run email:verify-provider`. Run `npm run email:worker` in a second terminal while the API is running; registration, resend-verification, and forgot-password jobs will then be delivered through Gmail. `npm run email:work-once` remains available to process exactly one ready job.

For Postman, set the Local environment variable `gmailRecipient` to the inbox you control, then run `B02 Register - positive`. If that address is already registered but unverified, run `B02 Resend verification - enumeration safe`. Copy the token from the delivered message into `POST /api/v1/auth/verify-email`.

Gmail is intended here for local owner testing, not production acceptance. The production transactional provider and sender domain remain an explicit owner decision; the PRD currently proposes Resend.

## B03 seller onboarding (Dojah deferred)

B02 was accepted on 2026-10-23. B03 was accepted on 2026-10-23 with reduced scope after the owner deferred Dojah, the NIN/BVN choice, consent records, provider callbacks and provider evidence. Independent seller profile and admin controls are available: create a profile with `POST /api/v1/sellers`, read it with `GET /api/v1/sellers/me`, and manage approval state through the admin-only status endpoint. Identity and approval states are stored separately; approval fails until identity is verified, and there is intentionally no route that can mark identity verified while the provider is deferred. Real seller approval therefore remains disabled.

The reserved `POST /api/v1/sellers/me/verification` route returns `503 IDENTITY_PROVIDER_NOT_CONFIGURED` and accepts no identity fields. Run migrations and `npm run seed:test` against the isolated `_test` database before using the B03 Postman samples. The seeded admin account is documented in the local Postman environment.

## B04 catalogue and stock

B04 catalogue work is on `feature/B04-catalogue-stock`. Public browsing supports category, search, NGN minor-unit price, brand, colour and size metadata filters with stable pagination and sorting. Colour and size do not create variants. Popularity is stored as paid units sold and remains zero until the paid-order integration updates it.

Seller catalogue writes require a verified and approved seller. Because B03's real identity provider remains deferred, only the guarded `_test` seed creates synthetic approved sellers for B04 verification. The seed is rejected outside a database ending in `_test`. Product images use generated private storage keys, JPEG/PNG/WebP signature validation, a configurable size limit, and controlled reads; production object storage is not yet configured.

## B05 baskets and delivery quotes

B05 supports isolated customer and token-protected guest baskets, explicit price refresh, safe login merge, approved Lagos zones, synthetic test-only pickup, admin-maintained indicative USD rates, and expiring idempotent checkout quotes. Delivery is charged once per distinct seller and retained by the company. Run migrations and the guarded test seed before the B05 Postman workflow. The seed creates two published synthetic products, the customer address, an active synthetic pickup location, and an indicative test rate; none can be seeded outside a database ending in `_test`.

Set `GUEST_BASKET_TTL_DAYS` and `CHECKOUT_QUOTE_TTL_SECONDS` as needed. The production pickup location remains inactive until the owner supplies a real street address. B05 quotes check current stock but do not reserve it; B06 owns reservations.

## B06 orders and inventory reservations

`POST /api/v1/orders` converts one owned, unexpired quote into one customer order with seller suborders, immutable prices and commission snapshots, and transactionally reserved stock. `GET /api/v1/orders/:orderId` requires the owning customer token or the guest-specific tracking credential. Paystack orders remain `awaiting_payment`; B06 makes no Paystack call. Explicitly enabled COD orders remain `awaiting_collection` until later reconciliation work.

Production order creation fails closed until the owner-approved policy is supplied through `ORDER_RESERVATION_TTL_SECONDS`, `ORDER_COMMISSION_BASIS`, and `ORDER_COMMISSION_RATE_BPS`. COD defaults off. Guest orders additionally require an uncommitted `ORDER_GUEST_TOKEN_SECRET` of at least 32 characters. The synthetic Postman workflow may enable COD and use test values only in the isolated `_test` environment; see `docs/decisions/0007-b06-order-policy-gates.md`.

## B07 Paystack payments and paid receipts

Configure `PAYSTACK_SECRET_KEY` only on the backend. `POST /api/v1/payments/initialize` creates or reuses the single persisted reference for an owned Paystack order; `POST /api/v1/payments/verify` independently queries Paystack; and the signed webhook endpoint is `/api/v1/payments/webhooks/paystack`. The webhook signature is computed over exact raw JSON bytes. Browser callbacks never mark an order paid.

Valid success atomically consumes the reservation, marks the order paid, records one ledger entry, creates one downloadable JSON receipt, and queues one receipt email. Late success opens a controlled review case and does not reacquire stock or issue a paid-order receipt. See `docs/api/payments.md` and ADR 0008.

Local setup may leave `PAYSTACK_SECRET_KEY` blank; payment routes then fail closed with `503 PAYMENT_PROVIDER_NOT_CONFIGURED`. For explicit provider testing, add a Paystack `sk_test_...` key and `PAYSTACK_ACCEPTANCE_EMAIL` only to the uncommitted environment and run `npm run payments:verify-provider`. This creates and verifies a test transaction but does not complete a payment. Live keys, public webhook reachability, and production settlement remain separate acceptance gates.

## B08 fulfilment, returns, refunds, and COD collection

Seller fulfilment uses `PATCH /api/v1/seller/orders/:orderId/status`; seller identity comes from the authenticated account, so a seller cannot select another seller's portion. Admin completion uses `PATCH /api/v1/admin/orders/:orderId/suborders/:suborderId/status`. Delivery and pickup have separate transition paths, and the owned fulfilment view returns the immutable Lagos estimate/pickup snapshot.

Customer cancellation releases eligible reservations once. Delivered customers and guests can submit bounded, idempotent item returns. `RETURN_WINDOW_DAYS` and `REFUND_DELIVERY_MODE` intentionally have no production defaults because the owner has not approved those policies. Refund approval therefore fails closed until explicit values are supplied. Local tests use a synthetic 14-day window and `full_order` delivery-fee treatment.

Paystack refunds are persisted before the provider call and reconciled by provider ID, `npm run refunds:reconcile`, or signed refund events. An uncertain create timeout is never blindly retried. Processed refunds append payment-ledger debits and exact seller/commission reversal obligations for B09 classification. COD collection must match the delivered order total and requires a separate admin confirmation before future earnings can become eligible. See `docs/api/fulfilment-returns-refunds.md` and ADR 0009. No live refund or money movement is authorised.

## B09 seller earnings and payouts

Seller earnings use the immutable suborder net/commission snapshot and exclude company-retained delivery fees. Eligible funds enter an append-only held ledger, then release to available after `EARNINGS_HOLD_DAYS`. This setting has no default. `PAYOUTS_ENABLED` separately defaults to false.

The `finance` role binds an already verified Paystack recipient code and approves NGN payouts. Available earnings are allocated and reserved before the provider call. Timeouts remain uncertain and reconciliation verifies the original durable reference; failure or reversal restores availability once. Processed refunds consume their source earning lot and put previously paid exposure into a recoverable balance without making available earnings negative. See `docs/api/seller-earnings-payouts.md` and ADR 0010. No live money movement is authorised.

## B10 reviews, merchandising, and reporting

Authenticated customers can submit one idempotent review only for an item in their own settled, fulfilled order. Reviews remain pending until an admin publishes or rejects them; only published reviews are public. Category-related products remain popularity ordered, and both verified Paystack settlement and confirmed COD collection increment `paid_units_sold` exactly once.

Admins manage audited homepage banners and review moderation. Admin and finance roles can read separately defined sales, products, refunds, commissions, seller-earnings, and payout reports; support cannot access financial reports or content administration. CSV exports quote every cell and prefix formula-like values. Report money totals are decimal strings in NGN minor units to preserve aggregate precision. See `docs/api/reviews-merchandising-reporting.md` and ADR 0011.

## B11 realtime support and notifications

Customer support threads and messages are persisted before Socket.IO publication. Connections authenticate with bearer access tokens, authorized joins control room membership, client UUIDs deduplicate retries, acknowledgements return the stored message and reconnects fetch missed history after a bigint message offset. HTTP history and message routes remain available when sockets are unavailable. The leased outbox publisher is at-least-once, so clients deduplicate persistent event/message IDs.

Email jobs now record delivery and attempt state, recover abandoned worker leases, stop after a bounded retry count and retain one logical job across retries. Marketing defaults off, requires explicit customer consent, respects unsubscribe/bounce/complaint/manual suppression at send time and includes an opaque unsubscribe link. Set `MARKETING_UNSUBSCRIBE_BASE_URL` to the public `/api/v1/marketing/unsubscribe` URL before campaign creation; production sender/DNS/provider approval remains open. See `docs/api/support-notifications.md` and ADR 0012.
