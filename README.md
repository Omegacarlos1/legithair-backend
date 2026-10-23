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
Run `npm run email:work-once` to process one ready message through the configured adapter; it reports only the provider result, never the recipient or token.

## Local Gmail delivery

Gmail is an opt-in local provider; automated tests continue to use the fake provider. Enable 2-Step Verification on the sending Google account, create an App Password at <https://myaccount.google.com/apppasswords>, and add the following only to the uncommitted `.env`:

```env
EMAIL_PROVIDER=gmail
EMAIL_FROM_NAME=Legit Hair
GMAIL_USER=your-address@gmail.com
GMAIL_APP_PASSWORD=your_16_character_app_password
EMAIL_WORKER_POLL_MS=2000
```

Use the App Password, not the normal Google account password. Spaces in the displayed App Password are accepted and removed during configuration parsing. Verify SMTP authentication with `npm run email:verify-provider`. Run `npm run email:worker` in a second terminal while the API is running; registration, resend-verification, and forgot-password jobs will then be delivered through Gmail. `npm run email:work-once` remains available to process exactly one ready job.

For Postman, set the Local environment variable `gmailRecipient` to the inbox you control, then run `B02 Register - positive`. If that address is already registered but unverified, run `B02 Resend verification - enumeration safe`. Copy the token from the delivered message into `POST /api/v1/auth/verify-email`.

Gmail is intended here for local owner testing, not production acceptance. The production transactional provider and sender domain remain an explicit owner decision; the PRD currently proposes Resend.

## B03 seller onboarding (Dojah deferred)

B02 was accepted on 2026-10-23. B03 was accepted on 2026-10-23 with reduced scope after the owner deferred Dojah, the NIN/BVN choice, consent records, provider callbacks and provider evidence. Independent seller profile and admin controls are available: create a profile with `POST /api/v1/sellers`, read it with `GET /api/v1/sellers/me`, and manage approval state through the admin-only status endpoint. Identity and approval states are stored separately; approval fails until identity is verified, and there is intentionally no route that can mark identity verified while the provider is deferred. Real seller approval therefore remains disabled.

The reserved `POST /api/v1/sellers/me/verification` route returns `503 IDENTITY_PROVIDER_NOT_CONFIGURED` and accepts no identity fields. Run migrations and `npm run seed:test` against the isolated `_test` database before using the B03 Postman samples. The seeded admin account is documented in the local Postman environment.
