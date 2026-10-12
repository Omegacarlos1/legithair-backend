# B01 foundation summary

Status: ACCEPTED by the owner on 2026-10-12 after local verification on 2026-10-11.

## Completed scope

- Express 5 strict-TypeScript application, validated startup configuration, Pino structured logging, safe request IDs and centralized error envelopes.
- Unversioned infrastructure probes plus `/api/v1` aliases; liveness is independent and readiness checks MariaDB with a bounded timeout.
- SQL migration runner with explicit rollback, schema ledger, `durable_jobs` and `outbox_events` primitives.
- Mocha unit/integration suites and Supertest API suite, protected test seed command, lint/typecheck/build scripts and MariaDB-backed GitHub Actions CI.
- API envelope/OpenAPI docs, MariaDB architecture decision, `.env.example`, and importable Postman collection/environment.

## Changed areas

Application source lives in `src/`; migrations in `migrations/`; tests in `test/`; CI in `.github/workflows/ci.yml`; API/decision/milestone documentation in `docs/`; samples in `postman/`. Dependency versions are pinned in `package-lock.json`.

## Migration and recovery

`001_foundation.sql` adds only the job and outbox primitives. `npm run migrate:down` drops those tables in reverse dependency order. Back up any real data before rollback. MariaDB and MySQL can auto-commit DDL, so inspect `schema_migrations` and table state after an interrupted migration before retrying.

## Verification

Executed `npm run lint`, `npm run typecheck`, `npm run build`, `npm test`, `npm run test:integration`, `npm run migrate:down`, `npm run migrate`, `npm run seed:test`, and a missing-configuration `node dist/server.js` check. Results: 7 tests passed, 0 failed, 0 skipped; all static/build/migration commands passed; expected invalid boot exited 1. See `B01-test-results.md` and `evidence/B01/`.

## Postman

Import both JSON files in `postman/`, select “Legit Hair Local,” and start the API. Run Health and Ready-positive while XAMPP MariaDB is available. Stop MariaDB before running Ready-negative, then restart it. B01 has no generated domain fixture IDs; `postman-b01-fixture-001` is the deterministic request-ID fixture.

## Decisions, limitations and gates

- Owner-selected XAMPP MariaDB is the local database. Production MySQL compatibility was not tested and must remain an explicit gate if MySQL is used in production.
- Hosted CI was authored but not remotely executed. No provider integrations apply to B01.
- No Git commit, push or pull request was made; those external workflow actions require an explicit publishing request.
