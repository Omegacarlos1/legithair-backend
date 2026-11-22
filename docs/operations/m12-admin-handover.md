# M12 admin seller and order management handover

Base path: `/api/v1`. Send `Authorization: Bearer <admin token>`. All four reads require the `admin` role; no guest or seller token can access them. Responses use the normal `success`, `data`, `meta` envelope. Run `npm run seed:test` against the isolated local test database to create synthetic IDs, then import `postman/Legit_Hair_Backend.postman_collection.json` and `postman/Local.postman_environment.json`. The collection's **M12 admin seller and order reads** folder has the four requests.

| Screen | Request | Response location |
|---|---|---|
| Sellers | `GET /admin/sellers?page=1&limit=20&approvalStatus=pending` | `data.sellers`, `meta.pagination` |
| Seller detail | `GET /admin/sellers/:sellerId` | `data.seller` |
| Orders | `GET /admin/orders?page=1&limit=20&status=processing` | `data.orders`, `meta.pagination` |
| Order detail | `GET /admin/orders/:orderId` | `data.order` |

Pagination is `{ "page": 1, "limit": 20, "total": 1, "totalPages": 1 }`. `limit` is 1–100. Seller filters are `approvalStatus=pending|approved|suspended` and `identityStatus=not_started|pending|verified|failed|manual_review`. Order filters are `status` (documented order status) and `paymentMethod=paystack|cod`. Invalid filters return `400`.

Seller detail example (IDs and timestamps are synthetic):

```json
{ "success": true, "data": { "seller": { "id": "20000000-0000-4000-8000-000000000001", "userId": "10000000-0000-4000-8000-000000000001", "businessName": "Synthetic Hair Store", "phone": "+2348000000000", "identityStatus": "pending", "approvalStatus": "pending", "approvalReason": null, "approvedBy": null, "approvedAt": null, "suspendedAt": null, "createdAt": "2026-11-16T10:00:00.000Z", "updatedAt": "2026-11-16T10:00:00.000Z" } }, "meta": { "requestId": "request-id" } }
```

Order list example:

```json
{ "success": true, "data": { "orders": [{ "id": "90000000-0000-4000-8000-000000000001", "status": "processing", "paymentMethod": "cod", "currency": "NGN", "grandTotalMinor": "105000", "deliveryMethod": "delivery", "createdAt": "2026-11-16T10:00:00.000Z", "updatedAt": "2026-11-16T10:05:00.000Z" }] }, "meta": { "requestId": "request-id", "pagination": { "page": 1, "limit": 20, "total": 1, "totalPages": 1 } } }
```

Order detail adds `deliveryTotalMinor`, `delivery`, and `suborders`. A suborder has `sellerId`, `id`, `orderId`, `status`, `version`, `allowedTransitions`, `orderStatus`, `paymentMethod`, `currency`, `totals`, `itemCount`, `fulfilledAt`, `createdAt`, `updatedAt`, `items`, and `timeline`. `delivery` is a redacted zone estimate or public pickup snapshot; it excludes customer contact and street address. Money values are decimal strings of NGN minor units. Read the actual suborder `version` immediately before a status action.

Admin seller status action: `PATCH /admin/sellers/:sellerId/status` with `{ "status": "suspended", "reason": "Documented compliance hold" }`. The response is `data.seller`. Self decisions return `403`; approval without verified identity returns `409`. A repeat of the current status returns `200` without another audit event. Dojah verification and real approval policy remain open.

Admin order action: `PATCH /admin/orders/:orderId/suborders/:suborderId/status` with `{ "status": "delivered", "expectedVersion": 3, "reason": "Carrier confirmed delivery" }`. The response is `data.fulfilment`. A stale version returns `409 STALE_SELLER_ORDER_VERSION` with `error.details.currentVersion`; refetch detail before retrying. Valid state changes and cancellation/refund constraints are in [the fulfilment contract](../api/fulfilment-returns-refunds.md). The Postman admin PATCH requests fetch the latest detail in a prerequest script. No new migration or business policy default is required for these reads.

Local verification on 2026-11-16: `npm run lint` and `npm run typecheck` passed. `npm run test:unit`, `npm run test:api`, and `npm run test:integration` could not start because Node's tsx loader failed in `uv_os_get_passwd` with `ENOMEM`. The new integration cases are written but not executed. B12 remains `READY_FOR_REVIEW`; this handover does not constitute owner acceptance or production MySQL evidence.
