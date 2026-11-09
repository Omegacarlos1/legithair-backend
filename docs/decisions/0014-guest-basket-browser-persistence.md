# ADR 0014: Guest basket browser persistence

Status: approved backend integration contract for the M03 frontend handover, 2026-11-09. This does not change B05 acceptance or imply B12 acceptance.

The API already uses a random opaque guest-basket bearer credential returned once by `POST /api/v1/baskets/guest`. Only its SHA-256 hash is stored by the backend. The credential expires after the configured `GUEST_BASKET_TTL_DAYS` (30 days by default), and the exact server expiry is returned as `basket.expiresAt` when the basket is read.

For the current header-based browser contract, the frontend may persist the raw credential in same-origin `localStorage` under the versioned key `legitHair.guestBasketToken.v1`. Store an object containing only `token` and `expiresAt`; do not store basket contents, addresses, quotes, access tokens, or refresh tokens in that entry. The server remains authoritative even if the locally recorded expiry differs.

This approval is conditional on the following lifecycle rules:

- Create a guest basket lazily, when an unauthenticated user first mutates the basket and no usable stored credential exists. Do not create a new basket on every page load.
- On unauthenticated startup, read the stored credential and call `GET /api/v1/baskets/current` with `X-Guest-Basket-Token`. A `200` response hydrates the UI and refreshes the stored `expiresAt` from the response.
- On `401 INVALID_GUEST_BASKET`, remove the stored credential and show an empty guest basket. Create a replacement only on the next basket mutation. Retain the credential on network failures or `5xx` responses so a transient outage does not discard the basket.
- Never send both `Authorization` and `X-Guest-Basket-Token` on ordinary read, set, remove, refresh, or quote requests. While authenticated, use the bearer token only.
- Immediately after login, if a guest credential exists, call `POST /api/v1/baskets/merge` with both credentials. Clear the guest credential only after `200`. Retain it after a merge conflict so the user can resolve quantity, stock, or line-limit problems. If the merge returns `401 INVALID_GUEST_BASKET`, clear it and continue with the authenticated customer basket.
- Clear the credential after successful merge, explicit local basket reset, local expiry, or `401 INVALID_GUEST_BASKET`. Do not clear it for `404 BASKET_ITEM_NOT_FOUND`, `409`, network failure, or server failure.
- Treat the credential as a secret bearer value: never put it in a URL, log, analytics event, error report, source control, or persisted Postman export. Do not copy it between origins. Redact the header in client diagnostics.
- Same-origin script execution can read `localStorage`, so the frontend must maintain its CSP and XSS controls. Moving the credential to an `HttpOnly; Secure; SameSite` cookie requires an explicit future API/CORS/CSRF contract revision; the current backend does not set browser cookies.

Cross-tab synchronization may use the browser `storage` event. A tab that observes removal must stop sending the old credential. A tab that receives `401 INVALID_GUEST_BASKET` must remove the entry only if it still contains the token used by that failed request, so it does not erase a newer credential created by another tab.
