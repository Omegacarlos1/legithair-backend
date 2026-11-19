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
| `GET /me/addresses` | Bearer access token | List only the current account’s saved addresses, default first. |
| `POST /me/addresses` | Bearer access token | Create an address owned by the current account. |
| `PATCH /me/addresses/:addressId` | Bearer access token | Update fields on an address owned by the current account. |
| `PUT /me/addresses/:addressId/default` | Bearer access token | Select one owned address as the account default. |
| `GET /users/:userId/addresses` | Owner or admin | Explicit ownership/role enforcement demonstration. |

Registration requires `email`, `displayName`, and a 12–128 character password containing lowercase, uppercase, and a digit. Address creation requires `label`, `recipientName`, `phone`, `line1`, `city`, and `state`; `countryCode` defaults to `NG`.

## Saved customer addresses

All self-service address routes derive ownership from the bearer access token. The client never supplies a user ID. Cross-customer and unknown address identifiers return `404 ADDRESS_NOT_FOUND` on mutation so the API does not expose whether another customer owns the identifier.

Create an address:

```http
POST /api/v1/me/addresses
Authorization: Bearer <access-token>
Content-Type: application/json

{
  "label": "Home",
  "recipientName": "Customer Name",
  "phone": "+2348000000000",
  "line1": "10 Example Street",
  "city": "Ikeja",
  "state": "Lagos",
  "countryCode": "NG",
  "isDefault": true
}
```

`GET /api/v1/me/addresses` returns `{ "addresses": [...] }`, ordered with the selected default first. Update one or more editable fields with `PATCH /api/v1/me/addresses/:addressId`; send `line2: null` to clear the optional second line. Default selection is a separate atomic operation:

```http
PUT /api/v1/me/addresses/80000000-0000-4000-8000-000000000005/default
Authorization: Bearer <access-token>
Content-Type: application/json

{}
```

Selecting a default clears the prior default for that customer in the same transaction. At checkout, submit the selected saved address ID as `addressId` only for a delivery quote; pickup quotes use `pickupLocationId` instead.

Raw access/refresh tokens are returned only at login/rotation. Send access tokens as `Authorization: Bearer <token>`. The database stores SHA-256 hashes. Never log or commit tokens.

## Email delivery

Registration automatically creates a 24-hour verification token and durable email job. `POST /auth/resend-verification` accepts `{ "email": "customer@example.com" }`, revokes prior unused verification tokens, and returns the same `202` response for unknown, verified, and unverified addresses. This prevents account enumeration.

`EMAIL_PROVIDER=fake` is the deterministic local/test default. For local Gmail delivery, select `EMAIL_PROVIDER=gmail`, configure a Gmail App Password in the uncommitted `.env`, and run `npm run email:worker` alongside the API. The email contains the token that the client submits to `POST /auth/verify-email` as `{ "token": "..." }`.

## Password recovery

`POST /auth/forgot-password` accepts `{ "email": "customer@example.com" }` and always returns `202` with the same enumeration-safe message. When the account exists, it revokes prior unused reset tokens, creates a one-hour single-use token, and queues a `send_password_reset` email job. A `202` response alone does not prove that the account exists or that email delivery succeeded.

Submit the delivered token to `POST /auth/reset-password` as `{ "token": "...", "password": "NewValidPass123!" }`. A successful reset returns `200`, marks the token used, updates the Argon2id password hash, and revokes all existing access and refresh sessions for that account. Invalid, expired, revoked, and reused tokens fail safely.

The maintained Postman collection exposes these requests under `auth > password-recovery`. Set `passwordResetEmail`, copy the delivered token into the runtime-only `passwordResetToken`, and set `passwordResetNewPassword`. The reset requests are duplicated under `manual-regression` because they require a captured one-time token and change fixture state. Never save a real reset token in the exported environment; rerun `npm run seed:test` after resetting the seeded fixture to restore `FixturePass123!`.
