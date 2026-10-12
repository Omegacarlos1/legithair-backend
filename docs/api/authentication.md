# B02 authentication and customer accounts

All routes are under `/api/v1`. JSON responses use the documented API envelope except successful logout, which deliberately returns `204 No Content`.

| Method and route | Authentication | Purpose |
|---|---|---|
| `POST /auth/register` | Public, rate limited | Register a customer and enqueue verification email. |
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
