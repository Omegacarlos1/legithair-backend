# B05 baskets and delivery quotations summary

Status: READY_FOR_REVIEW on 2026-10-25. B04 acceptance and merge were confirmed before implementation. ADR 0006 supplied the approved Lagos delivery and mixed-seller policy. B05 is locally implemented but is not owner-accepted, and B06 must not start yet.

## Scope completed

- Customer baskets and SHA-256-hashed, expiring guest-basket credentials with strict owner isolation and log redaction.
- Absolute 1–20 line quantities, a 50-line basket limit, current availability reporting, observed price snapshots, and explicit price refresh.
- Transactional guest-to-customer merge with summed duplicate quantities, all-or-nothing limits/stock validation, and safe replay under concurrent requests.
- Admin-created and editable/deactivatable Lagos delivery zones and pickup locations, with append-only configuration audit events and the three ADR 0006 zones seeded by migration.
- Lagos-only address/zone matching; authenticated customers must use their own saved address, while guests provide a validated inline address.
- Admin-maintained indicative USD rate with timestamp, integer half-up conversion, and NGN-only settlement.
- Immutable, expiring checkout quotes with price, product, destination, zone, item and per-seller delivery snapshots.
- One delivery fee per distinct seller, retained by the company and excluded from seller earnings/commission inputs.
- Required quote idempotency keys, conflict detection for changed input, ownership checks, stock checks and explicit stale-price rejection.
- B05 deliberately checks stock without reserving it. Stock reservation remains B06 scope.

## Changed areas

- Database: migrations 005 and 006 plus rollbacks create zones, pickup locations, exchange rates, append-only delivery configuration audit events, baskets/items, quotes/items and delivery allocations.
- Application: `src/baskets/`, router registration, TTL configuration, guest-token log redaction, and an auth rate-limiter isolation correction exposed by the expanded test suite.
- Tests: money unit tests, Supertest access checks, six MariaDB B05 scenarios, and B01–B05 migration assertions.
- Contracts: `docs/api/baskets-delivery.md`, OpenAPI, `.env.example`, README, and Postman collection/environment.
- Fixtures: guarded `_test` data now includes two B05 products, an owned customer address, one explicitly synthetic pickup location and an indicative test USD rate.

## Migration and recovery

Migrations 005 and 006 add nine tables and seed three approved delivery zones. They applied successfully to the local development schema and disposable integration schema. The server identifies as MariaDB 10.4.32, so production MySQL compatibility remains unverified.

Rollback drops quote allocations/items, quotes, basket items/baskets, rates, configuration audit events, pickup locations and zones. This permanently deletes active baskets, financial configuration history and immutable quote evidence. Back up these tables or prefer forward recovery outside a disposable environment. B06 must account for quote references before any later rollback strategy is approved.

The current `npm run migrate:down` runner rolls back every applied migration in reverse order, not only B05. It is suitable only for the disposable test schema; production recovery must use a reviewed targeted or forward migration.

## Verification

Executed ESLint, TypeScript checking, build, 7 unit tests, 11 Supertest API tests, and 33 MariaDB integration tests; all application assertions passed and none were skipped. Six integration scenarios are B05-specific. Migration 005 applied to development and test, the guarded fixture seed passed, its non-test refusal passed, and OpenAPI/Postman parsing passed.

The normal `tsx`-based npm test commands remain blocked before discovery on this Codex Windows host by `uv_os_get_passwd/ENOMEM`. Equivalent Mocha invocations used the established process-local `os.userInfo` shim and ran the repository's unchanged TypeScript test files. See [B05-test-results.md](B05-test-results.md) and [evidence/B05](evidence/B05/automated-tests.txt).

## Postman usage

Import `postman/Legit_Hair_Backend.postman_collection.json` and `postman/Local.postman_environment.json`. Point the environment at the API running against `legit_hair_app_test`, then run migrations and the guarded seed. Run requests whose names start with `B05` in order. They log in the seeded customer, inspect seeded delivery options, create a guest credential, add products from two sellers, reject an unsupported address, merge into the customer basket, create a two-seller quote and replay its idempotency key.

The seed supplies product IDs, the owned address, zone 1, the synthetic pickup location and the indicative test USD rate. Postman scripts store the guest credential, access token, quote key and quote ID. The exports parsed successfully; no manual Postman execution artifact was produced in this session.

## Open gates and limitations

- Owner review, manual Postman execution and explicit B05 acceptance.
- Production MySQL migration, locking and query-plan verification.
- The real production pickup street address and selected courier's written fees/estimates; the synthetic pickup must never be activated as real.
- The seeded USD value is test-only. An authorised admin must supply the current display rate; NGN remains the only settlement currency.
- Quotes expire and do not reserve stock. B06 must revalidate the quote and reserve stock transactionally.
- Failed delivery, redelivery, COD, returns, commission and payout policies remain gates for their dependent milestones.
- Earlier B03 identity/provider gates and B04 production image-storage gate remain open; real seller approval remains disabled.
- Do not start B06 until B05 is explicitly accepted and the B06 commission/COD dependencies are resolved or explicitly deferred.
