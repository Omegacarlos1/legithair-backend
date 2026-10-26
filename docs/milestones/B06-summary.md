# B06 orders and inventory reservations summary

Status: ACCEPTED by the owner on 2026-10-26 after local verification and an owner-reported successful manual Postman run. B05 acceptance and evidence were confirmed before implementation. The documented production and policy gates remain open.

## Scope completed

- Idempotent `POST /api/v1/orders` and owner-protected `GET /api/v1/orders/:orderId` for authenticated customers and guests.
- One marketplace order with per-seller suborders, immutable line price/name/quantity snapshots, per-line commission basis/rate/amount snapshots, seller totals and delivery allocation snapshots.
- Stable-order product row locking, atomic stock decrement and persisted inventory reservations inside short database transactions.
- Bounded retry for MariaDB/MySQL deadlocks and lock timeouts followed by full stock revalidation; the final-item race has exactly one winner.
- Transactional rollback across orders, suborders, items, reservations and stock; an injected database failure proves no orphan suborders remain.
- Persisted reservation expiry, one-time release with stock restoration, status audit events, and `npm run orders:release-expired` for scheduler use.
- Explicit B06 transition rules and rejection of invalid transitions. B07/B08 payment and fulfilment transitions are not exposed early.
- HMAC-derived guest tracking credentials with only SHA-256 hashes stored and both guest credential headers redacted from logs.
- Paystack orders stop at `awaiting_payment`; no provider call occurs. COD is fail-closed by default and creates `awaiting_collection` only when explicitly enabled.
- Fail-closed configuration for the unresolved production commission basis/rate and reservation duration, documented in ADR 0007.

## Changed areas

- Database: migration 007 and rollback add `orders`, `seller_suborders`, `order_items`, `inventory_reservations`, and `order_status_events`.
- Application: `src/orders/`, order router registration, configuration validation, tracking-header redaction and the expiry worker script.
- Tests: B06 API access checks, four MariaDB order scenarios, configuration coverage and B01-B06 migration assertions.
- Contracts: `docs/api/orders.md`, OpenAPI paths/security/schema, `.env.example`, README, and B06 Postman requests/environment variables.
- Decision: ADR 0007 records fail-closed production policy gates and labels all automated commission/COD values synthetic.

## Migration and recovery

Migration 007 applied to both local development and disposable integration schemas on MariaDB 10.4.32. Production MySQL compatibility is not verified.

Rollback drops every B06 order, suborder, item, reservation and status event. It does not restore stock for active reservations. Before any non-disposable rollback: stop checkout and expiry workers; back up all five B06 tables plus `products`; release or reconcile every active reservation; verify product quantities; then use a reviewed targeted rollback or forward migration. The repository's `npm run migrate:down` rolls back all applied milestones, not only B06, and is suitable only for disposable schemas.

## Verification

ESLint, TypeScript, build, 8 unit tests, 13 Supertest API tests and 37 MariaDB integration tests passed with zero assertion failures or skips. Four integration scenarios are B06-specific. Migration 007 applied to development and test, the guarded seed and its refusal guard passed, the expiry worker exited cleanly, and OpenAPI/Postman artifacts parsed.

The normal `tsx` npm test wrappers are host-blocked before discovery by `uv_os_get_passwd/ENOMEM`; the established process-local `os.userInfo` shim ran the unchanged test files successfully. See [B06-test-results.md](B06-test-results.md) and [evidence/B06](evidence/B06/automated-tests.txt).

## Postman usage

1. Use only the isolated database ending in `_test`. Run migrations, then `npm run seed:test` with `NODE_ENV=test`.
2. In the uncommitted local `.env`, set synthetic review values such as `ORDER_RESERVATION_TTL_SECONDS=900`, `ORDER_COMMISSION_BASIS=line_item_gross`, an explicitly chosen test `ORDER_COMMISSION_RATE_BPS`, `COD_ENABLED=true`, and a unique test-only `ORDER_GUEST_TOKEN_SECRET` of at least 32 characters. These are not approved production policy.
3. Start the API and import `postman/Legit_Hair_Backend.postman_collection.json` plus `postman/Local.postman_environment.json`.
4. Run the B05 seeded customer/basket/quote requests needed to populate `quoteId`, then run requests whose names start with `B06` in order. The collection stores `orderId`, the idempotency key, guest basket/quote/order IDs and the guest tracking credential, and asserts positive and negative responses.

On 2026-10-26, the owner reported that the B06 Postman workflow passed and explicitly accepted B06. No exported Collection Runner artifact accompanied the report, so the manual result remains owner-reported evidence. See `evidence/B06/owner-postman-report.txt` and `evidence/B06/owner-acceptance.txt`.

## Open gates and limitations

- Owner approval is required for commission basis/rate, inventory reservation lifetime, COD eligibility and collection reconciliation. Production order creation must remain fail-closed until those values are approved and configured.
- Production MySQL migration, locking, deadlock behavior and query-plan verification remain open; local evidence is MariaDB 10.4.32 only.
- A deployment scheduler/worker must invoke `orders:release-expired`; only a local one-shot smoke check was run.
- No exported Postman Collection Runner artifact was supplied; the successful manual run is owner-reported.
- B07 must consult current official Paystack documentation and obtain test credentials before provider acceptance. B06 made no provider calls and never treats a browser callback as payment proof.
- Earlier Dojah/seller approval, production image storage, real pickup/courier and related production gates remain open. Synthetic approved-seller fixtures remain restricted to `_test` databases.
- B06 is accepted. B07 remains NOT_STARTED and requires a separate instruction before implementation begins.
