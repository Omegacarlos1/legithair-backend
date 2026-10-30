# API response envelope

Successful responses use `{ "success": true, "data": {...}, "meta": { "requestId": "..." } }`.

Failed responses use `{ "success": false, "error": { "code": "...", "message": "..." }, "meta": { "requestId": "..." } }`. Optional safe validation details may be added under `error.details`. Stack traces, credentials, connection strings and raw provider/database errors are never returned.

Clients may send `X-Request-Id` containing 1–128 letters, digits, periods, underscores or hyphens; otherwise the server creates a UUID. The response always echoes the accepted/generated value in `X-Request-Id` and `meta.requestId`.

`GET /health` is process liveness. `GET /ready` is dependency readiness and returns 503 when MariaDB cannot answer. Versioned aliases are available at `/api/v1/health` and `/api/v1/ready`; unversioned probe paths are retained for conventional infrastructure configuration.

JSON request bodies are limited to 1 MiB. Malformed JSON returns `400 INVALID_JSON`; an oversized JSON body returns `413 REQUEST_TOO_LARGE`. These errors and ordinary validation/authentication failures are logged without the submitted body or error object.

All responses set `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, a no-referrer policy, a deny-by-default API content security policy, and a restrictive permissions policy. Production responses also set HSTS; HTTPS must already be enforced by the controlled reverse proxy before production is enabled.

Browser requests with an `Origin` header are accepted only when the value exactly matches `CORS_ALLOWED_ORIGINS`; denied origins return `403 ORIGIN_NOT_ALLOWED`. Non-browser/server requests without `Origin` remain available. Allowed preflight responses advertise credentials and only the maintained methods and headers. Configure the exact proxy hop count so rate-limit client identification cannot be spoofed through untrusted forwarding headers.
