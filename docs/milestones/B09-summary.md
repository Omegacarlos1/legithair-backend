# B09 seller earnings and payouts summary

Status: READY_FOR_REVIEW (not accepted)

## Completed scope

- Added a dedicated finance role and finance-only recipient, payout approval, lookup, and reconciliation operations.
- Added append-only seller ledger movements plus per-suborder earning lots and payout allocations so commission-snapshot net earnings reconcile across held, available, reserved, paid, and recoverable states.
- Paystack proceeds require succeeded payment; COD proceeds require confirmed collection. Delivery fees do not enter seller earnings.
- Hold release is idempotent. Processed refunds reduce their source earning lot's held/available value; paid or in-flight exposure becomes recoverable without negative payout availability.
- Payouts reserve balance before the external call, persist one unique durable reference, and call Paystack outside the transaction. Unknown outcomes remain uncertain/pending and verification uses the original reference. Failure/reversal restores eligibility once.
- Added Paystack transfer webhooks, reconciliation workers, provider verification, API/OpenAPI documentation, Postman samples, fixtures, migrations, and tests.

## Migrations and recovery

Migration 010 adds the finance role, recipient records, payouts, append-only ledger, and transfer webhook evidence. Migration 011 adds source earning lots and payout allocations. Migration 012 adds the `refund_recovery_settled` ledger type so returned provider funds can settle an existing recovery before any remainder becomes payout-eligible again. Rollback removes or rewrites financial audit data and is destructive; production rollback requires export/reconciliation and an audited recovery plan. Development and disposable MariaDB migrations passed through 012; production MySQL remains unverified.

## Verification

Lint, type checking, build, 19 unit tests, 21 API tests, and 56 MariaDB integration tests passed on the final 2026-10-29 rerun: 96 total, zero application failures/skips. See [B09 test results](B09-test-results.md) and [evidence/B09](evidence/B09/automated-tests.txt).

Exact checks executed:

```text
npm run lint
npm run typecheck
npm run build
node -e "... os.userInfo shim ... test/unit/**/*.test.ts test/api/**/*.test.ts"
NODE_ENV=test DATABASE_NAME=legit_hair_app_test EMAIL_PROVIDER=fake node -e "... os.userInfo shim ... test/integration/**/*.test.ts"
node -e "... JSON.parse Postman collection and environment ..."
node -e "... os.userInfo shim ... migrate('up')"
NODE_ENV=test DATABASE_NAME=legit_hair_app_test EMAIL_PROVIDER=fake node -e "... os.userInfo shim ... seedTestFixtures()"
```

The shim and PowerShell environment syntax are recorded verbatim in [automated test evidence](evidence/B09/automated-tests.txt) and [database evidence](evidence/B09/local-database-and-fixtures.txt). Normal npm Mocha wrappers were also attempted and hit the documented host startup error before discovery.

## Changed areas

- `migrations/010_*`, `011_*`, and `012_*`: financial schema, source allocations, recovery settlement, and rollback.
- `src/payouts/`, `src/app.ts`, `src/server.ts`, `src/payments/router.ts`, `src/config.ts`, and auth role types: service, provider, routes, webhook dispatch, and fail-closed configuration.
- `scripts/`: earnings sync, payout reconciliation, verification-only provider check, and finance fixture.
- `test/`: provider, access-control, migration, and MariaDB accounting/recovery coverage.
- `docs/api/`, `docs/decisions/`, `postman/`, `.env.example`, tracker, and milestone evidence: maintained contracts and handoff.

## Postman

Run migrations and the guarded seed, log in the seller and `finance.fixture@example.test`, then run the B09 requests in order. The positive payout request additionally requires an owner-approved hold duration, explicit `PAYOUTS_ENABLED=true`, a Paystack test secret, an actual test-mode recipient code replacing the placeholder, and eligible synthetic earnings. Keep payouts disabled for normal local review. Owner Postman execution is still open.

## Open gates

Owner decisions remain required for hold duration, payout frequency/approval operations, fees, and recoverable-balance treatment. Paystack transfer access, verified recipient operations, test-mode webhook/dashboard evidence, owner Postman review, production MySQL compatibility, deployment, and all live money-movement authority remain open. B09 is ready for review, not accepted. B10 must not start until explicit acceptance.

## Pull request description

Implement B09 seller earnings and payouts with an append-only ledger, source earning allocations, finance-only approval, fail-closed policy, durable Paystack transfer reconciliation, refund recovery, migrations, OpenAPI/Postman artifacts, and 96 passing automated checks. Risks are destructive financial-table rollback and unverified production provider/MySQL operation. No live transfer was made.
