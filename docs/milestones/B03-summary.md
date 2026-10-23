# B03 seller onboarding and identity checks summary

Status: ACCEPTED with reduced scope on 2026-10-23. The owner explicitly accepted the Dojah-independent seller onboarding controls while keeping the provider and production gates below open. This acceptance does not claim that identity verification or real seller approval works.

## Independent scope completed

- One seller profile per authenticated user with the `seller` role granted transactionally.
- Separate identity states (`not_started`, `pending`, `verified`, `failed`, `manual_review`) and approval states (`pending`, `approved`, `suspended`).
- Admin-only, reasoned approval-state changes; self-decisions are forbidden and approval requires verified identity.
- Suspension blocks the reserved verification operation.
- Auditable seller creation and admin status decisions without raw identity values.
- Reserved verification route fails safely with `503 IDENTITY_PROVIDER_NOT_CONFIGURED` and rejects identity fields.
- OpenAPI, endpoint documentation, deterministic Postman requests, migration/rollback, and automated tests for the independent scope.

## Changed files

- Migration: `migrations/003_seller_onboarding.sql` and its down migration.
- Application: `src/sellers/`, role middleware, and seller-router registration in `src/app.ts`.
- Tests: seller API authentication, MariaDB seller workflow, and B01-B03 migration coverage.
- Contracts and evidence: `docs/api/sellers.md`, OpenAPI, ADR 0004, Postman collection/environment, README, milestone tracker, and B03 reports.

## Migration and recovery

Migration 003 creates `sellers` and `seller_audit_events`. It does not create consent or provider-result tables while their contract is unresolved. Rollback deletes seller-role grants associated with seller rows, then drops audit events and sellers. Rollback permanently deletes seller profiles and audit history; back up before using it outside a disposable schema. The migration applied to the isolated MariaDB test schema and local development database. MariaDB evidence does not prove production MySQL compatibility.

## Verification

Executed lint, type checking, build, equivalent unit/API suites, real MariaDB integration suites, development migration, guarded test fixture seeding, and Postman JSON parsing. Results: 11 unit/API tests and 20 integration tests passed, 0 assertions failed, 0 skipped. The first seller integration run hit Mocha's two-second setup timeout before seller assertions; the suite timeout was made explicit and the complete rerun passed. See `B03-test-results.md` and `evidence/B03/local-independent-work.txt`.

Exact commands and the process-local Windows host workaround are recorded in `docs/milestones/evidence/B03/local-independent-work.txt`. The normal repository commands remain `npm run test:unit`, `npm run test:api`, `npm run test:integration`, `npm run migrate`, and `npm run seed:test`; the workaround was necessary only because this Codex host failed while `tsx` queried the Windows user profile.

The owner reported completing the manual Postman exercise and explicitly accepted the reduced scope. No exported Postman run artifact was supplied, so this is recorded as owner-reported evidence rather than an automated Postman run. See `evidence/B03/owner-acceptance.txt`.

## Postman

Against the disposable `_test` database, run `npm run migrate:down`, `npm run migrate`, and `npm run seed:test`, then start the API. Run `B02 Login seeded customer`, followed by the B03 requests in order. Seller creation stores `sellerId`; admin login stores `adminAccessToken`. Current positive evidence covers profile creation and suspension. Approval correctly returns `409` until a future approved provider workflow establishes verified identity.

## Open gates and limitations

- Choose the Dojah NIN or BVN workflow and API or hosted-widget integration.
- Approve exact seller consent text, retention, and provider callback/authentication behavior.
- Implement consent records, provider adapter/requests, minimal provider references, callbacks, and success/rejection/timeout/duplicate acceptance evidence.
- Run provider test-mode acceptance with owner-controlled credentials; no Dojah network call was made.
- Approve the seller approval policy before enabling real seller approval.
- Run production MySQL verification; local evidence is MariaDB-only.
- Real seller approval remains disabled because no supported path can establish `identityStatus=verified`.
- B04 remains `NOT_STARTED` and requires a new instruction before work begins.

## Owner acceptance

On 2026-10-23, the owner explicitly accepted the reduced B03 scope with Dojah verification, consent records, provider callbacks, provider test-mode evidence, seller approval policy, and production MySQL verification remaining open. The owner directed that real seller approval stay disabled until identity verification is implemented.
