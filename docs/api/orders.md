# Orders and inventory reservations API

All routes use the standard success/error envelope. Monetary values are integer NGN minor units. `POST /api/v1/orders` requires exactly one owner credential: a customer bearer token or the `X-Guest-Basket-Token` that owns the quote. It also requires an `Idempotency-Key` of 8–128 URL-safe characters.

## Create an order

`POST /api/v1/orders`

```json
{ "quoteId": "<uuid>", "paymentMethod": "paystack" }
```

`paymentMethod` is `paystack` or `cod`. A Paystack order starts as `awaiting_payment`; B06 performs no provider call. COD starts as `awaiting_collection` only when `COD_ENABLED=true`. Production checkout is deliberately unavailable until `ORDER_RESERVATION_TTL_SECONDS`, `ORDER_COMMISSION_BASIS=line_item_gross`, and `ORDER_COMMISSION_RATE_BPS` are explicitly configured from owner-approved policy. Guest checkout also requires a secret `ORDER_GUEST_TOKEN_SECRET` of at least 32 characters.

The service locks quoted products in stable ID order inside one short transaction, revalidates seller/product eligibility and stock, decrements available stock, and creates the order, seller suborders, immutable items, commission snapshots, active reservations, and initial status event atomically. Deadlocks and lock timeouts are retried at most three times; every retry revalidates availability. No provider network call occurs in this transaction.

Responses:

- `201`: new order and reservations created.
- `200`: identical idempotent replay; the same order is returned.
- `400`: validation or missing/invalid idempotency key.
- `401`: no owner credential or invalid authentication.
- `404`: quote is absent or not owned by the credential.
- `409`: changed idempotency request, quote already checked out, unavailable item, or disabled COD.
- `410`: quote expired.
- `503`: commission/reservation policy or guest credential secret is not configured.

For guest orders, `data.guestTrackingToken` is an unguessable deterministic credential derived with the configured server secret. Only its SHA-256 hash is stored. Preserve the returned token; it is required to track the order and is redacted from logs.

## Read an order

`GET /api/v1/orders/:orderId`

Use either the owning customer bearer token or `X-Order-Tracking-Token`. Missing credentials return `401`; an unknown, wrong-owner, or wrong-token order returns the same `404 ORDER_NOT_FOUND` response.

The response returns order and suborder states, immutable product names/prices/quantities, per-line commission basis/rate/amount, delivery snapshots, totals, and reservation status. Delivery fees remain company revenue and are excluded from seller net calculations.

## List the authenticated customer's orders

`GET /api/v1/orders?page=1&limit=20&status=delivered`

This route requires a customer bearer token; guest tracking credentials are intentionally single-order credentials and cannot list orders. `page` defaults to `1`, `limit` defaults to `20` and is capped at `100`, and `status` is optional. Results are ordered newest first and are owner-scoped before pagination.

```json
{
  "success": true,
  "data": {
    "orders": [{
      "id": "90000000-0000-4000-8000-000000000001",
      "paymentMethod": "paystack",
      "status": "delivered",
      "currency": "NGN",
      "deliveryMethod": "delivery",
      "totals": { "itemsSubtotalMinor": 100000, "deliveryTotalMinor": 5000, "grandTotalMinor": 105000 },
      "items": [{ "id": "91000000-0000-4000-8000-000000000001", "productId": "40000000-0000-4000-8000-000000000051", "productName": "Synthetic Straight Wig", "quantity": 1, "unitPriceMinor": 100000, "lineTotalMinor": 100000 }],
      "createdAt": "2026-11-10T12:00:00.000Z",
      "updatedAt": "2026-11-10T12:30:00.000Z"
    }]
  },
  "meta": { "requestId": "request-id", "pagination": { "page": 1, "limit": 20, "total": 1, "totalPages": 1 } }
}
```

An empty history returns `200` with `orders: []` and zero pagination totals. Invalid query values return `400`; missing authentication returns `401`; a non-customer account returns `403`.

## Reservation expiry and status rules

Run `npm run orders:release-expired` from a scheduler. It finds persisted due reservations, locks each order, restores product stock only for rows still `active`, marks them `released`, and records an `order_status_events` row. Concurrent or repeated workers release each reservation once.

B06 permits these transitions only:

- `awaiting_payment` → `payment_failed`, `reservation_expired`, or `cancelled`
- `awaiting_collection` → `reservation_expired` or `cancelled`

Those transitions release active stock reservations. Payment, fulfilment, return, and refund transitions are reserved for B07/B08 and are not exposed as B06 public routes.
