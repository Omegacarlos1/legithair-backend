# Legit Hair backend

B01 establishes an Express 5 and TypeScript API with MariaDB-backed readiness and migrations.

## Local setup with XAMPP MariaDB

1. Start MariaDB from the XAMPP control panel.
2. In phpMyAdmin or the MariaDB CLI, create `legit_hair_development` and a least-privilege application user.
3. Copy `.env.example` to `.env` and fill in the local credentials. Application and migration commands automatically load this file.
4. Run `npm run migrate`, then `npm run dev`.

Use a separate database whose name ends in `_test` for integration tests. Local MariaDB verification does not establish compatibility with a production MySQL deployment; that remains a release gate.

## Commands

- `npm run lint`, `npm run typecheck`, `npm test`
- `npm run test:integration` (requires an isolated MariaDB test schema)
- `npm run migrate`, `npm run migrate:down`
- `npm run seed:test` (creates guarded synthetic B02 fixtures)

## B02 authentication fixtures

After migrating the isolated `legit_hair_test` schema, run `npm run seed:test` with `NODE_ENV=test` and the test database variables. It creates the synthetic Postman users documented in the local environment. Never run it against a development or production database; the command rejects any database name that does not end in `_test`.

Local verification and password-reset messages are stored as pending `durable_jobs` records for the fake email workflow. The application stores only hashes of opaque authentication tokens; raw verification/reset tokens exist only in the queued email payload until delivery.
Run `npm run email:work-once` to process one ready message through the local fake adapter; it prints only the recipient, never the token.
