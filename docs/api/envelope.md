# API response envelope

Successful responses use `{ "success": true, "data": {...}, "meta": { "requestId": "..." } }`.

Failed responses use `{ "success": false, "error": { "code": "...", "message": "..." }, "meta": { "requestId": "..." } }`. Optional safe validation details may be added under `error.details`. Stack traces, credentials, connection strings and raw provider/database errors are never returned.

Clients may send `X-Request-Id` containing 1–128 letters, digits, periods, underscores or hyphens; otherwise the server creates a UUID. The response always echoes the accepted/generated value in `X-Request-Id` and `meta.requestId`.

`GET /health` is process liveness. `GET /ready` is dependency readiness and returns 503 when MariaDB cannot answer. Versioned aliases are available at `/api/v1/health` and `/api/v1/ready`; unversioned probe paths are retained for conventional infrastructure configuration.
