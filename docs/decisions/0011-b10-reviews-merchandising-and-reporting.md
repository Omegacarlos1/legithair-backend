# ADR 0011: B10 reviews, merchandising, and reporting

Date: 2026-10-29

## Decision

Reviews are linked to an eligible order item rather than trusting a product ID supplied by the customer. A unique customer/product constraint prevents duplicate product reviews, while an idempotency key makes retries safe. Reviews start pending; admin moderation is explicit and audited.

Related products remain the existing simple category rule from B04. Popularity is the gross count of units in settled orders: exact Paystack success or confirmed COD collection. COD confirmation updates the counter in the same transaction as collection reconciliation so a retry cannot double-count. Refunds do not retroactively change popularity.

Banners are database-managed content with explicit activation and optional UTC windows. Admin owns banner and review moderation. Reports read the existing transactional and append-only ledgers instead of copying balances into reporting tables. Admin and finance can read financial reports; support cannot, preserving least privilege ahead of B11 support work.

Report money values are serialized as decimal strings in minor units. CSV exports quote all values and neutralize spreadsheet formula prefixes. Report definitions are part of the API contract so gross sales, refunds, commissions, seller earnings, and payouts cannot be mistaken for one another.

## Consequences

Migration 013 adds reviews, moderation history, banners, banner audit history, and the support role. Rolling it down deletes B10 content and moderation evidence and therefore requires export before any production rollback. Reports remain bounded by an explicit row limit and are basic operational exports, not an analytics warehouse. Production MySQL compatibility, deployment performance, data retention, and final staff-role assignments remain B12 or owner gates.
