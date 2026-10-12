# ADR 0002: Authentication tokens and local email

Status: accepted for B02 implementation, 2026-10-12

Use opaque bearer access tokens in the `Authorization` header. Access tokens live for 15 minutes. Refresh tokens live for 30 days and are submitted only to the refresh endpoint. Only SHA-256 token hashes are stored; the random 256-bit values are returned once. Refresh rotation links tokens into a family. Reuse of a consumed/revoked refresh token revokes the entire family. Password reset revokes active access and refresh tokens.

This API does not use browser cookies in B02. A frontend must keep access tokens in memory and use a suitably protected client-side strategy for refresh tokens; a later same-site browser deployment may adopt HttpOnly Secure cookies through an explicit contract revision.

Passwords use Argon2id. Verification and reset tokens are single-use and expire after 24 hours and 1 hour respectively. Enumeration-resistant password-reset responses are identical for known and unknown addresses.

Email is provider-agnostic. Registration and reset transactions enqueue durable `email` jobs. `FakeEmailProvider` captures local/test messages without network traffic. The job processor claims work using a short `FOR UPDATE` transaction compatible with the XAMPP MariaDB version, performs provider calls outside the claim transaction, marks completion, and schedules bounded quadratic retry delay on failure.
