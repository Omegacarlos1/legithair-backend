# Seller Products and Inventory contract audit

Date: 2026-11-16. This audit corrects the frontend assumption that both destinations lack backend APIs. The B04 seller catalogue routes already exist; it does not change the backend milestone state.

## Products

`GET /api/v1/seller/products` requires a seller bearer token and returns `data.products` for the current seller, including drafts. There is no pagination on this seller-owned list. Each product includes ID, category, name, description, `priceMinor`, publication state, stock quantity, low-stock fields, image metadata, and timestamps. `GET /api/v1/categories` supplies public active category IDs. `POST /api/v1/seller/products` creates a draft with required `categoryId`, `name`, `description`, and `priceMinor`; optional `brand`, `colour`, `size`, `lowStockThreshold`, and `initialStock`. `PATCH /api/v1/seller/products/:productId` edits allowed metadata. `PATCH /api/v1/seller/products/:productId/publication` takes `{ "status": "published" }` or `unpublished`; publishing requires a validated image. `POST /api/v1/seller/products/:productId/images` accepts multipart field `image`, required `altText`, and optional `sortOrder`.

## Inventory

The same seller product list supplies `stockQuantity`, `lowStockThreshold`, `isLowStock`, and `stockAvailable` for an inventory table. `PATCH /api/v1/seller/products/:productId/stock` requires an `Idempotency-Key` header (8–128 allowed characters) and exact body `{ "delta": 5, "reason": "Synthetic stock receipt" }`. `delta` must be a nonzero integer. The response is `data.adjustment`. Retain the same key for a retry of the same input; a different input with a reused key is a conflict. Cross-seller access and unapproved/suspended seller access are denied. The backend does not expose a separate inventory dashboard, stock movement list, or adjustment history read; those features need additional contracts.

## Settings boundary

`GET /api/v1/sellers/me` provides the current seller profile. There is no seller profile/settings update endpoint. The frontend must define which Settings fields and actions it needs before a write contract can be added; provider, payout, identity, and approval controls cannot be inferred from a screenshot.

These contracts are in `docs/api/openapi.yaml` and `src/catalog/router.ts`. Production seller approval is still disabled pending B03 identity and policy decisions. Any product or inventory integration must preserve the existing approved-seller gate and use synthetic fixtures for local tests.
