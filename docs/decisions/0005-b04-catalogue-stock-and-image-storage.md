# ADR 0005: B04 catalogue, stock, and local image storage

Status: accepted for B04 local implementation, 2026-10-24

Every product has a seller owner, including future company-operated products. This keeps ownership and order allocation explicit without adding a separate company-product path. Seller catalogue operations require both verified identity and approved seller status. Because B03's real verification workflow is deferred, B04 uses fixed synthetic approved-seller records only in the guarded `_test` seed and integration setup. There is no production API or configuration bypass. Admins may edit any product, but publication still validates the owning seller.

Products have one purchasable configuration. `brand`, `colour`, and `size_label` are nullable descriptive metadata and filters, not stock variants. Prices are NGN integer minor units. Popularity is the persisted `paid_units_sold` count; B04 reads and sorts it but does not increment it before later paid-order work exists.

Stock changes are deltas recorded in `stock_adjustments`. Each request requires a per-product idempotency key. The product row is locked, the resulting quantity is checked against zero and the supported maximum, and the adjustment and product quantity commit together. Replaying a key returns the original result without applying the delta again.

Local development uses a filesystem adapter rooted at `IMAGE_STORAGE_ROOT`, outside Express static serving and ignored by Git. Uploads use memory-limited multipart handling, accept JPEG/PNG/WebP only, compare the declared MIME type with the file signature, generate storage keys, discard original path information, cap images per product, and serve bytes only through controlled published-product routes with `nosniff`. This establishes local behavior but is not production storage acceptance. Production object storage, backups, malware scanning, CDN policy, and retention remain deployment gates.
