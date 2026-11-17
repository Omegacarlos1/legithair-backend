# M15 staff roles and audit reads

All routes use `/api/v1`, require an admin bearer token, return the standard envelope, and set `Cache-Control: no-store`. Other roles receive 403; missing authentication receives 401. Only the existing `finance` and `support` roles can be changed. There is no admin-role assignment API.

`GET /admin/staff?page=1&limit=20&role=support` returns `data.staff` and `meta.pagination`. The optional role filter accepts `finance` or `support`; without it, the list includes accounts with admin, finance, or support. Each item has `id`, `email`, `displayName`, `emailVerified`, and `roles`. Limit is at most 100. `GET /admin/staff/:userId` returns `data.staff` for an existing account, including one without a staff role; unknown IDs return 404 `USER_NOT_FOUND`.

`PATCH /admin/staff/:userId/roles` takes `{ "role": "support", "action": "grant", "reason": "Assigned to customer support queue" }`. `role` is `support|finance`; `action` is `grant|revoke`; trimmed reason is 10–500 characters. It returns `data` with `userId`, `role`, `assigned`, and `changed`. A repeated desired state is 200 with `changed:false` and no new event. Target must be an existing email-verified account; otherwise 404 or 409 `EMAIL_NOT_VERIFIED`. Self changes are 403 `SELF_ROLE_CHANGE_FORBIDDEN`. A successful change and its audit event are one transaction; the target's active access and refresh tokens are revoked, requiring sign-in again.

`GET /admin/audit-events?page=1&limit=20&source=staff_role&actorUserId=<uuid>&targetId=<id>` returns `data.events` and `meta.pagination`. Optional filters may be combined. `source` accepts `staff_role`, `seller`, `product`, `delivery_config`, or `banner`. Each event has `id` (source-prefixed stable ID), `source`, `targetId`, `actorUserId`, `action`, `reason` (nullable), and `createdAt`. Records are newest first. The feed omits payloads, identity documents, secrets, financial values, and customer data. It is read-only and bounded to these five sources; it is not a complete system-wide audit trail. Export and retention policy remain open.

## Response examples

Staff list (`GET /api/v1/admin/staff?page=1&limit=20`):

```json
{"success":true,"data":{"staff":[{"id":"10000000-0000-4000-8000-000000000006","email":"support.fixture@example.test","displayName":"Support Fixture","emailVerified":true,"roles":["support"]}]},"meta":{"requestId":"m15-example","pagination":{"page":1,"limit":20,"total":1,"totalPages":1}}}
```

Staff detail (`GET /api/v1/admin/staff/10000000-0000-4000-8000-000000000006`):

```json
{"success":true,"data":{"staff":{"id":"10000000-0000-4000-8000-000000000006","email":"support.fixture@example.test","displayName":"Support Fixture","emailVerified":true,"roles":["support"]}},"meta":{"requestId":"m15-example"}}
```

Role change (`PATCH /api/v1/admin/staff/10000000-0000-4000-8000-000000000006/roles`):

```json
{"success":true,"data":{"userId":"10000000-0000-4000-8000-000000000006","role":"support","assigned":true,"changed":false},"meta":{"requestId":"m15-example"}}
```

Audit read (`GET /api/v1/admin/audit-events?source=staff_role&page=1&limit=20`):

```json
{"success":true,"data":{"events":[{"id":"staff_role:1","source":"staff_role","targetId":"10000000-0000-4000-8000-000000000006","actorUserId":"10000000-0000-4000-8000-000000000002","action":"role_granted:support","reason":"Assigned to customer support queue","createdAt":"2026-11-17T12:00:00.000Z"}]},"meta":{"requestId":"m15-example","pagination":{"page":1,"limit":20,"total":1,"totalPages":1}}}
```

These values are illustrative synthetic examples, not database execution evidence. Errors use the standard envelope, for example `{"success":false,"error":{"code":"FORBIDDEN","message":"The admin role is required"},"meta":{"requestId":"m15-example"}}`.
