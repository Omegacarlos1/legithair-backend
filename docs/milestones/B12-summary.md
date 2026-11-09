# B12 release hardening and backend handover summary

Status: READY_FOR_REVIEW on 2026-10-30; owner acceptance is not inferred.

## Completed scope

- Added exact-origin CORS, security headers, explicit proxy trust, safe JSON body errors, stricter production configuration, and lower-risk logging for expected client failures.
- Added bounded deadlock/lock-timeout retries with jitter to short quote/order transactions after the checkout pilot exposed contention. No external provider call is retried by this change.
- Added an operations snapshot for email/outbox leases, expired reservations, refunds needing attention, and uncertain payouts.
- Added a guarded logical backup/restore verifier with separate source and restore identities, fixed `_test` target, representative count checks, complete rollback/up, final restore, checksum, and temporary-file cleanup.
- Added provider-safe Postman smoke plus fixed 50-VU browsing and isolated 10-VU checkout profiles. Runtime access-token data is ignored.
- Added staging/DNS/HTTPS/MySQL/worker/monitoring/deployment guidance, backup/recovery procedure, staff handover, responsibilities, training outline, and explicit release gates.
- Repaired OpenAPI flow-map syntax and a missing payout path parameter; updated the maintained collection and API envelope documentation.
- On 2026-11-02, reorganized the 112-request maintained collection into the existing cloud `legit-hair` collection under `auth`, `seller`, `admin`, `products`, `delivery`, `payment`, and `finance`, with domain subfolders. Replaced stale saved examples that contained credentials/tokens and added the placeholder-only `Legit Hair Local` environment. B12 remains READY_FOR_REVIEW.
- Added a 15-request `frontend-handover` folder sourced from the provider-safe B12 smoke. Customer, seller, admin, finance, and support logins capture tokens only for the active run; the final local folder run passed 21/21 assertions without persisting token values.
- Added a dependency-ordered `full-regression` folder with 110 safely runnable requests and a two-request `manual-regression` folder for externally controlled cases. A clean isolated run passed 110/110 requests and 214/214 assertions; the separately captured fake-email verification passed 2/2 assertions. The MariaDB-outage readiness request remains explicitly NOT RUN. The same cloud `legit-hair` collection was updated in place to 239 requests, and the existing local environment received the validated synthetic payout-recipient value; no duplicate or saved token was introduced.
- On 2026-11-09, added the previously missing password-recovery Postman samples under `auth > password-recovery`: enumeration-safe forgot-password, token consumption, and login confirmation. The one-time-token workflow is manual-only, the environment exports an empty token placeholder, and the maintained local collection now contains 245 requests after deterministic organization. The saved forgot-password request passed 2/2 assertions against the running local backend; B12 remains READY_FOR_REVIEW.
- On 2026-11-09, closed the frontend M03 basket handover gap without changing runtime routes or schema. Published exact guest/customer basket-read and item-removal contracts, approved the versioned same-origin guest-token persistence lifecycle in ADR 0014, added focused ownership/regression checks, and added a self-cleaning nine-request `frontend-handover > m03-baskets` workflow. The maintained collection now contains 254 requests; the complete 24-request handover passed 37/37 assertions. B12 remains READY_FOR_REVIEW.
- On 2026-11-09, closed the frontend M04 saved-address and pickup-quote handover gap. Existing list/create and pickup-quote behavior is now explicit in focused docs and OpenAPI. Added owner-scoped `PATCH /me/addresses/:addressId` and atomic `PUT /me/addresses/:addressId/default`, including cross-owner, unknown-ID, nullable `line2`, and concurrent default-selection coverage. Added a rerunnable six-request `frontend-handover > m04-checkout` workflow that removes its temporary basket line. The maintained collection now contains 260 requests; both the standalone smoke and maintained 30-request handover passed 47/47 assertions. No migration or business-policy default changed; B12 remains READY_FOR_REVIEW.

## Verification summary

Latest deterministic regression: 122 passing (25 unit, 30 API, 65 MariaDB integration, 2 Socket.IO), zero final failing/skipped. Build/static checks, isolated restore, operations check, the latest 30-request/47-assertion handover, final load profiles, OpenAPI lint, JSON parsing, diff whitespace check, and dependency audit passed. The M04-focused authentication file passed 12/12, including concurrent default selection and cross-owner denial. Browsing p95 was 82 ms at 50 VUs; checkout p95 was 89 ms at 10 VUs, both with 0% request and assertion failures. Full detail is in [B12 test results](B12-test-results.md).

## Migration, rollback, and recovery

B12 adds no schema migration. Migrations 001-014 remain the database contract. The rehearsal proved a local logical dump can restore into `legit_hair_b12_restore_test`, survive the complete destructive down/up cycle, and be replaced by the original dump with matching representative counts.

Do not use down migrations as routine production rollback; they destroy milestone data and DDL may implicitly commit. Take a verified backup and prefer reviewed forward recovery. Hosted MySQL recovery and the proposed 24-hour recovery point/eight-working-hour restore target remain unverified and owner/hosting dependent.

## Postman usage

1. Migrate and seed only a database ending `_test`, then start the API with synthetic test policy values and no live provider key.
2. Run `postman collection run postman/B12_Smoke.postman_collection.json --no-report-events --timeout-request 5000` for the provider-safe handover smoke.
3. For load, run `npm run performance:prepare`; the ignored token file is generated under `postman/performance/`.
4. Run the documented fixed browsing and checkout commands in the performance evidence. Load only an isolated target with explicit authority.
5. The main B01-B12 collection remains the detailed manual workflow. Provider refund/payout/payment requests must not be run against live accounts without separate authorization.
6. In Postman, select the `Legit Hair Local` environment before running the `legit-hair` collection. Run `npm run postman:organize` after adding maintained samples so every request is assigned to exactly one domain folder before export or cloud sync.
7. Frontend should run the complete `frontend-handover` folder and require 30 requests and 47 assertions with zero failures. M03 checks are under `frontend-handover > m03-baskets`; saved-address and pickup-quote checks are under `frontend-handover > m04-checkout`. See [frontend Postman handover](../operations/frontend-postman-handover.md).
8. For complete synthetic backend verification, run `full-regression`, then `npm run postman:verify-email`. Require 111 executed requests and 216 assertions with zero failures. Treat the separate database-outage readiness request as NOT RUN until MariaDB is intentionally stopped in an approved test window.
9. For password recovery, set `passwordResetEmail`, send the request under `auth > password-recovery`, copy the one-hour token into the runtime-only `passwordResetToken`, then send reset and login confirmation in order. These requests are also visible under `manual-regression`; rerun `npm run seed:test` after changing the seeded fixture password.

## Changed areas

- Runtime/security: `.env.example`, `src/app.ts`, `src/config.ts`, `src/server.ts`, `src/http/security.ts`.
- Recovery/operations/performance: `scripts/check-operations.ts`, `scripts/verify-backup-restore.ts`, `scripts/prepare-performance.ts`, `postman/performance/`, `postman/B12_Smoke.postman_collection.json`.
- Postman maintenance: `scripts/organize-postman-collection.mjs`, `scripts/run-postman-email-verification.mjs`, `postman/Full_Regression_Order.json`, the maintained collection/environment, and the local Paystack simulation files.
- Contention hardening: `src/baskets/service.ts`, `src/orders/service.ts`.
- Verification: focused unit/API tests and B12 evidence.
- Handover/contracts: ADR 0013, `docs/operations/`, API docs/OpenAPI, README, Postman collection, milestone tracker, and AGENTS status.
- M03 basket handover follow-up: ADR 0014, basket/OpenAPI contracts, focused API/MariaDB tests, the nine-request Postman workflow, and recorded local evidence. No runtime or migration file changed.
- M04 saved-address/pickup handover follow-up: `src/auth/addresses.ts`, `src/auth/router.ts`, focused authentication integration coverage, address/quote docs and OpenAPI, organizer and Postman collections, and recorded local evidence. No migration file changed.

## Open release gates

- Owner acceptance, staging UAT, named staff assignments, two training sessions, incident contacts, data-retention decision, support hours, and no unresolved critical/high defects.
- Owner-approved seller identity/consent/approval, commission/reservation/COD, return/refund, earnings/payout/recovery, delivery/pickup, and retention policies.
- Dojah workflow and provider evidence; Paystack transaction/refund/transfer test-mode dashboard/webhook evidence; production email provider/sender/SPF/DKIM/DMARC and bounce/complaint ingestion.
- Production MySQL migration/integration/locking/restore evidence; durable production object storage; client-owned hosting/domain/DNS/TLS/monitoring/backup accounts and MFA.
- Production-like load on selected infrastructure and a shared Socket.IO adapter/coordination design if multiple API instances are required.
- Explicit authorization for deployment, DNS changes, live credentials, and live payments/refunds/transfers. B12 local verification authorizes none of these.

## Pull request description

Harden the B01-B11 backend for B12 review with exact CORS/security/proxy controls, safe body errors, operations checks, guarded backup/restore, deployment and handover runbooks, provider-safe Postman smoke, and fixed 50/10-VU pilot profiles. Add bounded quote/order deadlock retries discovered by load; close the M03 basket handover with explicit read/remove contracts and approved guest-token persistence; then close the M04 handover with owner-scoped saved-address update/default selection and explicit pickup quoting. Latest local evidence is 122 deterministic checks, a 30-request/47-assertion handover, successful isolated restore, browsing p95 82 ms, checkout p95 89 ms, zero final load errors/assertion failures, clean OpenAPI lint, and zero npm-audit findings. Production MySQL, hosted capacity, policy/provider/infrastructure gates, training, deployment, and live money movement remain unapproved.

## Final backend handover

There is no B13. Review [the backend handover](../operations/backend-handover.md), [release runbook](../operations/release-runbook.md), [backup/restore procedure](../operations/backup-restore.md), this summary, and the test evidence. The owner should either accept B12 with explicitly recorded exceptions or return a bounded defect/gate list. Do not merge, deploy, change DNS, introduce live credentials, or move money solely because local B12 checks passed.

