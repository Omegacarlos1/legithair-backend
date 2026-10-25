# B04 catalogue and stock management summary

Status: READY_FOR_REVIEW on 2026-10-24. B03 acceptance and its reduced-scope evidence were confirmed before implementation. B04 is locally implemented, but it is not owner-accepted and B05 must not start yet.

## Scope completed

- Admin-managed active categories.
- Seller-owned draft products with NGN integer-minor-unit prices, one stock quantity, descriptive brand/colour/size metadata, and low-stock state.
- Approved-owner and admin metadata, publication, and idempotent stock operations with product/audit history.
- Public published-only catalogue, detail, controlled image delivery, category-related products, stable pagination, text search, metadata and price filters, and newest/price/popularity sorts.
- Popularity is explicitly `paid_units_sold`; B04 initializes and reads it while later paid-order work will increment it.
- Multipart JPEG/PNG/WebP uploads with byte limits, MIME/signature checks, generated private storage keys, ten-image cap, ownership checks, cleanup on failed persistence, and `nosniff` delivery.
- Row-locked stock deltas preserve the non-negative invariant under concurrent requests; `(product_id, idempotency_key)` prevents duplicate application.
- B03's production restriction is preserved. Catalogue seller operations require verified and approved state. Only the guarded `_test` seed and integration setup create synthetic approved sellers.

## Changed areas

- Database: `migrations/004_catalogue_stock.sql` and rollback.
- Application: `src/catalog/`, router registration, image configuration, and runtime wiring.
- Dependencies: pinned `multer` and `@types/multer` in the lockfile.
- Tests: catalogue Supertest authentication checks, seven MariaDB catalogue/stock scenarios, and B01-B04 migration assertions.
- Contracts: `docs/api/catalogue.md`, OpenAPI, ADR 0005, `.env.example`, README, and Postman collection/environment.
- Fixtures: four deterministic users and two fixed test-only approved sellers, protected by both `NODE_ENV=test` and an `_test` database suffix.

## Migration and recovery

Migration 004 creates `categories`, `products`, `product_images`, `stock_adjustments`, and `product_audit_events`. Product deletes are restricted where inventory history exists; images and product audit events cascade with a product. Rollback drops all five tables and permanently removes their database records, so back up catalogue and audit data before rollback outside a disposable environment.

The down migration does not delete locally stored image files. A rollback or failed deployment therefore requires an explicit storage reconciliation after the database backup/restore decision; blindly deleting the storage root is unsafe. Production also needs object storage, backup/restore, malware-scanning, retention, and CDN decisions before release.

Migration 004 applied to the local development database and to the disposable integration schema. The server identifies as MariaDB 10.4.32, so production MySQL compatibility remains unverified.

## Verification

Executed lint, type checking, build, 5 unit tests, 8 Supertest API tests, 27 MariaDB integration tests, the development migration, guarded test seed, seed refusal check, OpenAPI parse, and Postman JSON parse. All application assertions passed; no tests were skipped. Manual Postman execution, production MySQL, and production image-storage checks were not run.

Exact results are in [B04-test-results.md](B04-test-results.md), with saved evidence in [evidence/B04](evidence/B04/automated-tests.txt). The normal `tsx` command remains blocked by this Codex Windows host's `uv_os_get_passwd/ENOMEM` issue; the recorded equivalent invocations use the established process-local shim.

## Postman evidence and usage

Import `postman/Legit_Hair_Backend.postman_collection.json` and `postman/Local.postman_environment.json`. Run migrations and the guarded seed against `legit_hair_app_test`, start the API using that same test database, set `productImagePath` to a local JPEG/PNG/WebP file, and run the requests whose names start with `B04` in order:

1. Login admin and create category.
2. Login synthetic approved seller and create draft product.
3. Confirm the draft is hidden and publication without an image fails.
4. Upload the local image, publish, browse with filters, adjust stock, and replay the key.
5. Login the second synthetic seller and confirm cross-seller stock adjustment returns 403.

Scripts store `adminAccessToken`, `sellerAccessToken`, `otherSellerAccessToken`, `categoryId`, `productId`, and `imageId`, and assert expected status codes and response fields. The JSON exports parsed successfully, but no manual Postman run artifact was produced in this session.

## Open gates and limitations

- Owner review and explicit B04 acceptance.
- Manual Postman execution/exported run evidence.
- Production MySQL migration, concurrency, and query-plan verification.
- Production object storage, backup/recovery, malware scanning, CDN, and retention decisions/evidence.
- B03's Dojah, consent, callback, provider evidence, seller approval policy, and production MySQL gates remain open. Real seller approval remains disabled.
- Paid-order integration must increment `paid_units_sold` only after the payment milestone defines authoritative paid units.
- Do not start B05 until B04 is explicitly accepted and the mixed-seller delivery allocation and delivery-zone policy decisions needed by B05 are approved.
