# M13 admin delivery and returns backend handover

Date: 2026-11-16. Backend branch: `feature/B12-release-hardening-handover`. B12 remains `READY_FOR_REVIEW`; M13 remains in progress.

## Contracts

- `GET /api/v1/admin/delivery-zones` and `GET /api/v1/admin/delivery-zones/:zoneId` return active and inactive zones under `data.zones` and `data.zone`.
- `GET /api/v1/admin/pickup-locations` and `GET /api/v1/admin/pickup-locations/:pickupLocationId` return active and inactive locations under `data.pickupLocations` and `data.pickupLocation`.
- `GET /api/v1/admin/returns?page=1&limit=20&status=requested` returns `data.returns` and `meta.pagination`. Optional `orderId` filters to one order. `GET /api/v1/admin/returns/:returnRequestId` returns the canonical `data.returnRequest` with items and refund state. `actionable` means the record is `requested`; approval still requires policy and provider checks. No evidence upload contract exists.
- `GET /api/v1/admin/orders/:orderId/suborders/:suborderId/delivery-assignment` returns `data.assignment` or `null`. `PUT` on that path takes `{ "courierName": "Synthetic Courier", "courierReference": "dispatch-fixture-001", "expectedVersion": 2 }` and returns `data.assignment` and `data.version`. Only processing or shipped delivery portions can be assigned or reassigned. A stale version returns `409 STALE_SELLER_ORDER_VERSION`; a pickup or completed portion returns `409 DELIVERY_ASSIGNMENT_UNAVAILABLE`. `GET /api/v1/admin/orders/:orderId` includes each portion's `deliveryAssignment` and current `version`. Assignments do not dispatch a courier or change fulfilment status.

All routes require an admin bearer token; a non-admin gets `403`. Unknown IDs return `404`. The assignment stores only a name and operations reference, with an immutable change event for each update. It contains no customer contact or address data. Existing delivery completion uses the M12 versioned status route.

## Local setup and Postman

Apply `npm run migrate` to the intended local development schema before starting the server. Migration 016 creates `delivery_assignments` and `delivery_assignment_events`; its down migration drops both tables and their history. Run `npm run seed:test` only against an isolated `_test` schema, then obtain an admin token using the collection's login request. Use a synthetic shipped delivery order; set `m13OrderId` and `m13SuborderId` from the admin order detail. Run the `M13 admin delivery and returns` folder in order. The assignment request reads `m13ExpectedVersion` from order detail and the stale request reuses that version. A return record is selected from the list into `m13ReturnId`; if the list is empty, create a synthetic return using the established customer workflow first. The folder performs no refund approval or provider call.

## Verification and gates

`npm run lint`, `npm run typecheck`, and `npm run build` passed after the changes. `npm run test:integration` stopped before test execution with the local Node/tsx `uv_os_get_passwd` ENOMEM error; the new integration case is written but unexecuted. No production MySQL compatibility or provider evidence is claimed. The owner approved the bounded frontend M13 slice on 2026-11-16 and reaffirmed approval on 2026-11-17. This is not B12 backend acceptance. The M13 backend Postman handover remains unrun. No live Paystack refund was tested or authorised.
