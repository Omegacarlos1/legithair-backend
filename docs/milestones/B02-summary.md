# B02 authentication and customer accounts summary

Status: ACCEPTED by the owner on 2026-10-23 with the documented Gmail and production gates remaining open.

## Completed

- Customer registration, normalized unique email, Argon2id password hashing, email verification, login/logout, password reset, roles, profile, and saved addresses.
- Opaque hashed bearer/access tokens and rotating refresh-token families with replay detection and family revocation.
- Explicit unauthenticated, forbidden, validation, duplicate, expired, used-token, and enumeration-safe contracts.
- Transactional verification/reset email job creation, local fake email adapter, safe job claiming, completion, and retry scheduling.
- Opt-in Gmail SMTP adapter using App Password authentication, continuous and one-shot worker commands, provider authentication check, and HTML/text verification and reset templates.
- Enumeration-safe `POST /auth/resend-verification`, including revocation of earlier unused verification tokens.
- B02 schema/rollback, guarded deterministic fixtures, OpenAPI/auth docs, architecture decision, and Postman positive/negative samples.

## Changed files for the Gmail extension

- Provider and configuration: `src/email/provider.ts`, `src/config.ts`, `.env.example`, `package.json`, and `package-lock.json`.
- Worker and API: `scripts/process-email-once.ts`, `scripts/process-email-worker.ts`, `scripts/verify-gmail.ts`, `src/auth/service.ts`, and `src/auth/router.ts`.
- Tests and contracts: unit/integration tests, OpenAPI, authentication docs, README, Postman collection/environment, ADR 0003, milestone tracker, and this closeout evidence.

## Migrations and recovery

`002_authentication.sql` creates `users`, `user_roles`, `auth_tokens`, and `addresses`. The down migration drops them in dependency order and permanently deletes account/auth/address data. Back up before rollback. The migration applied successfully to both the empty isolated MariaDB schema and local development database.

The Gmail extension adds no schema migration. Rollback is the code/config reversal: select `EMAIL_PROVIDER=fake`, stop the Gmail worker, and remove the Gmail-specific dependency and adapter changes. Pending durable jobs remain retryable and are not deleted.

## Verification

The Gmail extension was checked with lint, type checking, build, 5 unit tests, 4 API tests, and 13 real MariaDB integration tests: 22 passed, 0 assertion failures, and 0 skipped. The Codex Windows host could not start the normal `tsx/cjs` wrapper because `uv_os_get_passwd` returned `ENOMEM`; the same Mocha suites passed with a process-local host shim. See `B02-test-results.md` and `evidence/B02/gmail-email-extension.txt`.

Exact commands and outputs are recorded in `evidence/B02/gmail-email-extension.txt`.

## Postman

Import the maintained collection and Local environment. With test variables active, run `npm run migrate` and `npm run seed:test` using the guarded `_test` configuration, start the API, then run Login before authenticated samples. Login stores access/refresh tokens automatically. Registration uses a synthetic address unless `gmailRecipient` is explicitly set, and the resend request reuses that address. Invalid registration, unauthenticated `/me`, and forbidden cross-account address access provide negative evidence.

## Limitations and open gates

- Gmail is implemented only for local owner testing. Live authentication and delivery remain unverified until the owner supplies `GMAIL_USER` and a Gmail App Password in `.env` and runs the explicit provider check. The production transactional provider and sender domain remain unresolved; the PRD proposes Resend.
- Hosted CI and production MySQL compatibility were not executed. XAMPP MariaDB evidence is local evidence only.
- Owner acceptance does not claim live Gmail delivery, hosted CI, production MySQL compatibility, or production email-provider acceptance.
