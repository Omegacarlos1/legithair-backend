# B04 catalogue and stock management

All routes use `/api/v1` and the standard JSON envelope. NGN prices are integer minor units. `colour` and `size` are descriptive product metadata used for filtering; they do not create selectable stock variants. Each product has one stock quantity and one purchasable configuration.

## Ownership and seller eligibility

Every product, including a future company product, has a seller owner. Seller catalogue routes require the `seller` role plus both `identity_status=verified` and `approval_status=approved`. B03 has no real verification path, so normal production accounts cannot satisfy this guard yet. `npm run seed:test` creates two explicitly synthetic approved sellers only in a database ending with `_test`; it is not a production approval route.

Admins can create and deactivate categories, edit any product, change publication, and adjust stock. Admin publication cannot bypass seller eligibility: publishing fails unless the owning seller is verified and approved. Suspended sellers cannot use their catalogue workspace.

## Routes

| Method and route | Access | Behavior |
|---|---|---|
| `GET /categories` | Public | Active categories in stable alphabetical order. |
| `POST /admin/categories` | Admin | Create a category. |
| `PATCH /admin/categories/:categoryId` | Admin | Rename, activate, or deactivate a category. |
| `GET /products` | Public | Published products only, with stable pagination and filters. |
| `GET /products/:productId` | Public | Published product detail and image metadata. |
| `GET /products/:productId/related` | Public | Same-category published products ordered by paid units sold. |
| `GET /products/:productId/images/:imageId` | Public | Validated bytes only when the product and category are public. |
| `GET /seller/products` | Approved seller | Own products, including drafts and unpublished products. |
| `POST /seller/products` | Approved seller | Create an owned draft product. |
| `PATCH /seller/products/:productId` | Approved owner | Edit product metadata. |
| `POST /seller/products/:productId/images` | Approved owner | Upload one image using multipart field `image`. |
| `PATCH /seller/products/:productId/publication` | Approved owner | Publish or unpublish; publication requires a validated image. |
| `PATCH /seller/products/:productId/stock` | Approved owner | Apply an idempotent stock delta. |
| `PATCH /admin/products/:productId` | Admin | Edit any product metadata. |
| `PATCH /admin/products/:productId/publication` | Admin | Publish or unpublish without bypassing seller eligibility. |
| `PATCH /admin/products/:productId/stock` | Admin | Apply an audited idempotent stock delta. |

## Browse contract

`GET /products` supports `page`, `limit`, `q`, `categoryId`, `minPriceMinor`, `maxPriceMinor`, `brand`, `colour`, `size`, and `sort`. Sort values are `newest`, `price_asc`, `price_desc`, and `popularity`. Every ordering includes the product ID as a deterministic tie-breaker. Popularity is `paid_units_sold`; B04 initializes it to zero and a later paid-order milestone will update it.

Example:

```text
GET /api/v1/products?page=1&limit=20&brand=Legit%20Synthetic&colour=Black&size=Medium&sort=price_asc
```

## Product creation

```json
{
  "categoryId": "{{categoryId}}",
  "name": "Postman Brazilian Wig",
  "description": "Synthetic Postman catalogue product with one configuration.",
  "priceMinor": 125000,
  "brand": "Legit Synthetic",
  "colour": "Black",
  "size": "Medium",
  "lowStockThreshold": 2,
  "initialStock": 5
}
```

## Stock adjustment

Send a unique `Idempotency-Key` header of 8–128 safe characters:

```json
{
  "delta": -1,
  "reason": "Postman synthetic stock decrement"
}
```

The product row is locked during the adjustment. Negative resulting quantities fail with `409 INSUFFICIENT_STOCK`. Repeating the same key returns the original adjustment with `idempotentReplay=true` and does not change stock again.

## Image handling

The upload route accepts one JPEG, PNG, or WebP file, `altText`, and optional `sortOrder`. It enforces the configured byte limit, compares the declared MIME type with the file signature, generates the storage key, does not trust the original filename, writes outside the public web root, and caps each product at ten images. Files are served with `X-Content-Type-Options: nosniff` only through controlled routes. Local filesystem storage is for development and single-node evidence; production object storage, backup, malware scanning, and CDN configuration remain deployment gates.
