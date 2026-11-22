# Seller product deletion handover â€” 2026-11-19

`DELETE /api/v1/seller/products/:productId` requires an approved seller bearer token and no body. It returns 204 with an empty response. The same seller can repeat the request. A different seller receives 403, an unauthenticated caller 401, and a missing product 404.

Deletion archives the product: `archived_at` is set and publication becomes `unpublished` in one transaction. The seller list and public catalogue omit it. Edit, publication, stock adjustment, and image upload return 409 `PRODUCT_ARCHIVED`. Public image bytes are no longer served. Existing order references, stock history, product audit, and stored image files remain intact. The seller UI can remove the row after 204. This is not a physical purge or undo endpoint.

Migration 018 adds nullable `products.archived_at`. The down migration removes the marker and would make archived products visible again as unpublished seller records; do not roll it back as a routine undo. Apply with `npm run migrate` after database backup and use an isolated database ending `_test` for integration checks. The Postman request `Seller archive product - manual run after product checks` uses `{{sellerAccessToken}}` and `{{productId}}`; run `npm run seed:test` in the isolated test database to obtain synthetic approved-seller fixtures.

Local checks: `npm run typecheck`, `npm run lint`, `npm run build`, and Postman JSON parse passed. `npm run test:integration -- --grep "archives an owned product"` failed before test execution because Node/tsx raised `uv_os_get_passwd` ENOMEM. No database migration, API, or Postman run was executed. Production MySQL compatibility and frontend integration remain open. B12 stays READY_FOR_REVIEW.
