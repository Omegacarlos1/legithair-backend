# B11 support chat and notification contract

## Persistent support HTTP API

All support routes use bearer authentication. Customers can create and read only their own threads. Support and admin users can list, join, reply to, assign, close and reopen any support thread. Other roles receive `403`; an inaccessible thread is returned as `404` so its existence is not disclosed.

- `POST /api/v1/support/threads` accepts `subject`, the initial `message`, and a client-generated UUID `clientId`. An identical client-ID retry returns `200`; reuse with changed content returns `409`.
- `GET /api/v1/support/threads` returns the customer's own threads or the staff queue.
- `GET /api/v1/support/threads/:threadId/messages?afterMessageId=...&limit=...` is the ordered HTTP history/reconnect fallback. Message IDs are decimal strings because the database offset is an unsigned bigint.
- `POST /api/v1/support/threads/:threadId/messages` persists a message and its outbox event in one transaction. It uses the same client-ID acknowledgement semantics as Socket.IO.
- `PATCH /api/v1/support/threads/:threadId` is support/admin-only and changes `status` or `assignedSupportUserId`.

## Socket.IO contract

Connect to the default namespace at the API origin and send the bearer access token as `auth.token`. Authentication middleware rejects missing, expired or revoked access tokens. Each mutating event revalidates that token. Rooms are server-controlled and named internally; clients join only through an authorized event.

Client events, each with an acknowledgement callback:

- `support:join`: `{ "threadId": "uuid", "afterMessageId": "optional decimal offset", "limit": 50 }`. The acknowledgement returns the authorized thread and ascending messages after the offset.
- `support:message`: `{ "threadId": "uuid", "clientId": "uuid", "body": "text" }`. The socket must already have joined that thread. The acknowledgement returns the persistent message and `idempotentReplay`.
- `support:leave`: `{ "threadId": "uuid" }`.

Server event:

- `support:message`: `{ "eventId": "outbox ID", "message": { ... } }`.

Socket.IO's default arrival guarantee is at-most-once, so B11 does not treat an in-memory emit as durable delivery. The database message and outbox row commit first. The outbox publisher then emits at least once and marks the event published; a stale publisher lease is recoverable. Consumers deduplicate on `eventId` or message `id`. Disconnected clients recover through `support:join` with the last message offset or the HTTP history endpoint. Official basis: <https://socket.io/docs/v4/delivery-guarantees/> and <https://socket.io/docs/v4/middlewares/>.

## Email delivery records and retries

Every processed email job has one `email_deliveries` record and numbered `email_delivery_attempts`. Jobs have a five-attempt default, quadratic retry delay capped at 60 minutes, terminal `failed` state, completion timestamp and a recoverable processing lease. The same durable job is retried; a new logical email is not created. A provider timeout after acceptance can still make external delivery outcome uncertain because Gmail SMTP exposes no application idempotency key.

## Marketing consent and suppression

- `GET/PUT /api/v1/me/marketing-preference` reads or changes explicit customer consent. The default is not opted in.
- `POST /api/v1/admin/marketing/campaigns` is admin-only and fails closed until `MARKETING_UNSUBSCRIBE_BASE_URL` is configured. It queues one deduplicated job per currently opted-in, unsuppressed user.
- `GET/POST /api/v1/marketing/unsubscribe` consumes an opaque database-backed token. Replays are safe and retain the opt-out and unsubscribe suppression.
- `PUT /api/v1/admin/marketing/suppressions` adds or lifts bounce, complaint or manual suppression. Customer opt-in only lifts an earlier unsubscribe suppression; it cannot override bounce, complaint or manual suppression.
- The worker rechecks consent and suppression immediately before provider delivery. A queued recipient who later opts out or becomes suppressed is recorded as `suppressed` and is never passed to the provider.
- `GET /api/v1/admin/marketing/campaigns/:campaignId/deliveries` exposes delivery/retry state to admin.

Marketing and transactional records carry separate categories. B11 reuses the existing local fake/Gmail adapter for repeatable verification; production marketing provider selection, sender authentication, bounce/complaint ingestion and DNS remain release gates.
