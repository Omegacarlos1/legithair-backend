# Reviews, merchandising, and reporting

## Reviews

`POST /api/v1/reviews` requires a customer bearer token, `Idempotency-Key`, and an `orderItemId`. The order item must belong to that customer, its seller suborder must be fulfilled, and its Paystack payment or COD collection must be settled. One customer can review a product once. New reviews are `pending` and therefore absent from `GET /api/v1/products/:productId/reviews` until an admin publishes them.

Admins list the moderation queue with `GET /api/v1/admin/reviews?status=pending` and publish or reject with `PATCH /api/v1/admin/reviews/:reviewId`. Every state change records the actor, reason, previous state, and new state. Rejected content is never returned by the public route.

## Merchandising

`GET /api/v1/products/:productId/related` remains the B04 category-based rule: published products from the same active category, excluding the source, ordered by paid units, publication time, and ID. `paid_units_sold` increments on exact Paystack settlement and, from B10, on the first confirmed COD collection. Refunds do not rewrite historical gross paid-unit popularity.

`GET /api/v1/banners` returns only active banners whose optional UTC start/end window contains the current time. Admin-only create, list, and update routes are under `/api/v1/admin/banners`; changes are audited. Image and target URLs must be HTTPS or application-relative paths.

## Reports and permissions

`GET /api/v1/admin/reports/:report` accepts `sales`, `products`, `refunds`, `commissions`, `earnings`, or `payouts`, plus optional inclusive `from`/`to` UTC dates, `limit` up to 5000, and `format=json|csv`. Admin and finance roles may read reports. Support, seller, and customer roles may not. Money values and aggregates are decimal strings representing NGN minor units so totals cannot lose integer precision.

Accounting definitions:

- `sales`: settled customer order totals before refunds. Gross sales include item subtotal and company-retained delivery fees. Paystack requires `succeeded`; COD requires `confirmed` collection.
- `products`: gross paid units and item sales from those settled orders. Later refunds do not reduce the historical paid-unit count.
- `refunds`: only processed Paystack refunds, separated into item and delivery amounts.
- `commissions`: immutable settled order-item commission snapshots minus commission reversals attached to processed refunds.
- `earnings`: seller-ledger source earnings minus refund reversals and recoverable obligations, with signed held, available, reserved, paid, and recoverable bucket movements.
- `payouts`: persisted transfer requests and provider lifecycle status. Successful amounts reconcile to the signed paid-bucket ledger entries for the same payout.

CSV exports use the same report rows, quote every cell, double embedded quotes, and prefix values whose first meaningful character is `=`, `+`, `-`, `@`, tab, or carriage return. This prevents spreadsheet formula execution without changing stored source data.
