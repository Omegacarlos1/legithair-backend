# B02 authentication and customer accounts summary

Status: LOCAL_VERIFIED on 2026-10-12. This is not owner acceptance.

## Completed

- Customer registration, normalized unique email, Argon2id password hashing, email verification, login/logout, password reset, roles, profile, and saved addresses.
- Opaque hashed bearer/access tokens and rotating refresh-token families with replay detection and family revocation.
- Explicit unauthenticated, forbidden, validation, duplicate, expired, used-token, and enumeration-safe contracts.
- Transactional verification/reset email job creation, local fake email adapter, safe job claiming, completion, and retry scheduling.
- B02 schema/rollback, guarded deterministic fixtures, OpenAPI/auth docs, architecture decision, and Postman positive/negative samples.

## Migrations and recovery

`002_authentication.sql` creates `users`, `user_roles`, `auth_tokens`, and `addresses`. The down migration drops them in dependency order and permanently deletes account/auth/address data. Back up before rollback. The migration applied successfully to both the empty isolated MariaDB schema and local development database.

## Verification

Executed `npm run lint`, `npm run typecheck`, `npm run build`, `npm test`, `npm run test:integration`, `npm run migrate`, and `npm run seed:test`. Totals: 19 automated tests passed, 0 failed, 0 skipped. See `B02-test-results.md`.

## Postman

Import the maintained collection and Local environment. With test variables active, run `npm run migrate` and `npm run seed:test` using the guarded `_test` configuration, start the API, then run Login before authenticated samples. Login stores access/refresh tokens automatically. Registration positive uses a synthetic random address; invalid registration, unauthenticated `/me`, and forbidden cross-account address access provide negative evidence.

## Limitations and open gates

- Fake email is local-only; selecting and accepting a live transactional email provider is a later deployment gate.
- Hosted CI and production MySQL compatibility were not executed. XAMPP MariaDB evidence is local evidence only.
- B02 is not accepted until the owner explicitly reviews it. B03 must not begin before acceptance.
