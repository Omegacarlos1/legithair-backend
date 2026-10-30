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

## Verification summary

Final deterministic regression: 119 passing (25 unit, 28 API, 64 MariaDB integration, 2 Socket.IO), zero failing/skipped. Build/static checks, isolated restore, operations check, 15-request/21-assertion smoke, final load profiles, OpenAPI lint, JSON parsing, diff whitespace check, and dependency audit passed. Browsing p95 was 82 ms at 50 VUs; checkout p95 was 89 ms at 10 VUs, both with 0% request and assertion failures. Full detail is in [B12 test results](B12-test-results.md).

## Migration, rollback, and recovery

B12 adds no schema migration. Migrations 001-014 remain the database contract. The rehearsal proved a local logical dump can restore into `legit_hair_b12_restore_test`, survive the complete destructive down/up cycle, and be replaced by the original dump with matching representative counts.

Do not use down migrations as routine production rollback; they destroy milestone data and DDL may implicitly commit. Take a verified backup and prefer reviewed forward recovery. Hosted MySQL recovery and the proposed 24-hour recovery point/eight-working-hour restore target remain unverified and owner/hosting dependent.

## Postman usage

1. Migrate and seed only a database ending `_test`, then start the API with synthetic test policy values and no live provider key.
2. Run `postman collection run postman/B12_Smoke.postman_collection.json --no-report-events --timeout-request 5000` for the provider-safe handover smoke.
3. For load, run `npm run performance:prepare`; the ignored token file is generated under `postman/performance/`.
4. Run the documented fixed browsing and checkout commands in the performance evidence. Load only an isolated target with explicit authority.
5. The main B01-B12 collection remains the detailed manual workflow. Provider refund/payout/payment requests must not be run against live accounts without separate authorization.

## Changed areas

- Runtime/security: `.env.example`, `src/app.ts`, `src/config.ts`, `src/server.ts`, `src/http/security.ts`.
- Recovery/operations/performance: `scripts/check-operations.ts`, `scripts/verify-backup-restore.ts`, `scripts/prepare-performance.ts`, `postman/performance/`, `postman/B12_Smoke.postman_collection.json`.
- Contention hardening: `src/baskets/service.ts`, `src/orders/service.ts`.
- Verification: focused unit/API tests and B12 evidence.
- Handover/contracts: ADR 0013, `docs/operations/`, API docs/OpenAPI, README, Postman collection, milestone tracker, and AGENTS status.

## Open release gates

- Owner acceptance, staging UAT, named staff assignments, two training sessions, incident contacts, data-retention decision, support hours, and no unresolved critical/high defects.
- Owner-approved seller identity/consent/approval, commission/reservation/COD, return/refund, earnings/payout/recovery, delivery/pickup, and retention policies.
- Dojah workflow and provider evidence; Paystack transaction/refund/transfer test-mode dashboard/webhook evidence; production email provider/sender/SPF/DKIM/DMARC and bounce/complaint ingestion.
- Production MySQL migration/integration/locking/restore evidence; durable production object storage; client-owned hosting/domain/DNS/TLS/monitoring/backup accounts and MFA.
- Production-like load on selected infrastructure and a shared Socket.IO adapter/coordination design if multiple API instances are required.
- Explicit authorization for deployment, DNS changes, live credentials, and live payments/refunds/transfers. B12 local verification authorizes none of these.

## Pull request description

Harden the B01-B11 backend for B12 review with exact CORS/security/proxy controls, safe body errors, operations checks, guarded backup/restore, deployment and handover runbooks, provider-safe Postman smoke, and fixed 50/10-VU pilot profiles. Add bounded quote/order deadlock retries discovered by load. Final local evidence is 119 deterministic checks, successful isolated restore, browsing p95 82 ms, checkout p95 89 ms, zero final load errors/assertion failures, clean OpenAPI lint, and zero npm-audit findings. Production MySQL, hosted capacity, policy/provider/infrastructure gates, training, deployment, and live money movement remain unapproved.

## Final backend handover

There is no B13. Review [the backend handover](../operations/backend-handover.md), [release runbook](../operations/release-runbook.md), [backup/restore procedure](../operations/backup-restore.md), this summary, and the test evidence. The owner should either accept B12 with explicitly recorded exceptions or return a bounded defect/gate list. Do not merge, deploy, change DNS, introduce live credentials, or move money solely because local B12 checks passed.

