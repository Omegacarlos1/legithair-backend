# B02 authentication and customer accounts

All routes are under `/api/v1`. JSON responses use the documented API envelope except successful logout, which deliberately returns `204 No Content`.

| Method and route | Authentication | Purpose |
|---|---|---|
| `POST /auth/register` | Public, rate limited | Register a customer and enqueue verification email. |
| `POST /auth/resend-verification` | Public, rate limited | Queue a replacement verification email without revealing account state. |
| `POST /auth/verify-email` | Public, rate limited | Consume the 24-hour single-use verification token. |
| `POST /auth/login` | Public, rate limited | Issue 15-minute access and 30-day refresh tokens after verification. |
| `POST /auth/refresh` | Public, rate limited | Rotate a refresh token; replay revokes its family. |
| `POST /auth/logout` | Bearer access token | Revoke the presented access token. |
| `POST /auth/forgot-password` | Public, rate limited | Queue an enumeration-safe reset message. |
| `POST /auth/reset-password` | Public, rate limited | Consume the one-hour token, update password, revoke sessions. |
| `GET /me` | Bearer access token | Return the current account and roles. |
| `GET/POST /me/addresses` | Bearer access token | List or create only the current account’s addresses. |
| `GET /users/:userId/addresses` | Owner or admin | Explicit ownership/role enforcement demonstration. |

Registration requires `email`, `displayName`, and a 12–128 character password containing lowercase, uppercase, and a digit. Address creation requires `label`, `recipientName`, `phone`, `line1`, `city`, and `state`; `countryCode` defaults to `NG`.

Raw access/refresh tokens are returned only at login/rotation. Send access tokens as `Authorization: Bearer <token>`. The database stores SHA-256 hashes. Never log or commit tokens.

## Email delivery

Registration automatically creates a 24-hour verification token and durable email job. `POST /auth/resend-verification` accepts `{ "email": "customer@example.com" }`, revokes prior unused verification tokens, and returns the same `202` response for unknown, verified, and unverified addresses. This prevents account enumeration.

`EMAIL_PROVIDER=fake` is the deterministic local/test default. For local Gmail delivery, select `EMAIL_PROVIDER=gmail`, configure a Gmail App Password in the uncommitted `.env`, and run `npm run email:worker` alongside the API. The email contains the token that the client submits to `POST /auth/verify-email` as `{ "token": "..." }`.

## Password recovery

`POST /auth/forgot-password` accepts `{ "email": "customer@example.com" }` and always returns `202` with the same enumeration-safe message. When the account exists, it revokes prior unused reset tokens, creates a one-hour single-use token, and queues a `send_password_reset` email job. A `202` response alone does not prove that the account exists or that email delivery succeeded.

Submit the delivered token to `POST /auth/reset-password` as `{ "token": "...", "password": "NewValidPass123!" }`. A successful reset returns `200`, marks the token used, updates the Argon2id password hash, and revokes all existing access and refresh sessions for that account. Invalid, expired, revoked, and reused tokens fail safely.

The maintained Postman collection exposes these requests under `auth > password-recovery`. Set `passwordResetEmail`, copy the delivered token into the runtime-only `passwordResetToken`, and set `passwordResetNewPassword`. The reset requests are duplicated under `manual-regression` because they require a captured one-time token and change fixture state. Never save a real reset token in the exported environment; rerun `npm run seed:test` after resetting the seeded fixture to restore `FixturePass123!`.
