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
- `npm run seed:test` (guard validation; B01 has no domain fixtures)
