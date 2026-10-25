# Baskets and delivery quotation API

All amounts are integer minor units. NGN is the settlement currency. USD values are indicative only and include the snapshotted admin rate and its update timestamp.

## Basket credentials

Authenticated customers use `Authorization: Bearer <access-token>`. Guests first call `POST /api/v1/baskets/guest`; the raw `guestBasketToken` is returned once and must be sent as `X-Guest-Basket-Token`. Only its SHA-256 hash is stored. Supplying both credentials is rejected. Guest baskets expire after the configured TTL.

`POST /api/v1/baskets/items` sets the absolute desired quantity for a product, rather than incrementing it. Quantities are 1–20 and a basket supports at most 50 distinct products. The server snapshots the observed price. `POST /api/v1/baskets/refresh` explicitly accepts current prices after checking publication, seller eligibility and stock.

`POST /api/v1/baskets/merge` requires customer authentication plus the guest header. Duplicate products are summed inside one transaction. The entire merge fails if any combined quantity exceeds 20, the basket would exceed 50 lines, or an item is unavailable. Replaying the same guest merge returns the already-merged customer basket without adding quantities again.

## Routes

| Route | Credential | Purpose |
|---|---|---|
| `POST /api/v1/baskets/guest` | Public, rate limited | Create a guest basket and return its credential once |
| `GET /api/v1/baskets/current` | Customer or guest | Read the isolated current basket |
| `POST /api/v1/baskets/items` | Customer or guest | Set an absolute product quantity |
| `DELETE /api/v1/baskets/items/:productId` | Customer or guest | Remove one line |
| `POST /api/v1/baskets/refresh` | Customer or guest | Accept current prices after availability checks |
| `POST /api/v1/baskets/merge` | Customer plus guest header | Merge the guest basket exactly once |
| `GET /api/v1/delivery-options` | Public | List active Lagos zones and real/test pickup locations |
| `POST /api/v1/admin/delivery-zones` | Admin | Create a Lagos delivery zone |
| `PATCH /api/v1/admin/delivery-zones/:zoneId` | Admin | Change coverage, fee, estimate or active state |
| `POST /api/v1/admin/pickup-locations` | Admin | Create a real Lagos pickup location |
| `PATCH /api/v1/admin/pickup-locations/:pickupLocationId` | Admin | Change or deactivate a pickup location |
| `PUT /api/v1/admin/exchange-rates/usd` | Admin | Set the indicative USD rate |
| `POST /api/v1/checkout/quotes` | Customer or guest | Create an immutable, expiring quote |
| `GET /api/v1/checkout/quotes/:quoteId` | Owning customer or guest | Read an unexpired owned quote |

## Delivery quotes

Quote creation requires an `Idempotency-Key` header. Reusing the same key and input returns the original quote; reusing it with different input returns `409 IDEMPOTENCY_KEY_REUSED`.

Authenticated delivery request:

```json
{
  "deliveryMethod": "delivery",
  "zoneId": "50000000-0000-4000-8000-000000000001",
  "addressId": "80000000-0000-4000-8000-000000000005"
}
```

Guest delivery uses an inline `address` instead of `addressId`. Pickup uses `{ "deliveryMethod": "pickup", "pickupLocationId": "..." }`. Delivery and pickup cannot be mixed.

The server verifies that delivery addresses are in Nigeria and Lagos and that the normalized city/area belongs to the selected active zone. Each distinct seller receives one snapshotted zone-fee allocation. The company retains delivery fees, and they are excluded from seller commission and earnings.

Quote creation rejects unpublished or ineligible products, insufficient stock and price changes. A changed price returns `409 STALE_BASKET_PRICE`; the client must show the change and call the explicit refresh route before retrying. Quotes expire after `CHECKOUT_QUOTE_TTL_SECONDS` (15 minutes by default); reads then return `410 QUOTE_EXPIRED`. B05 quotes do not reserve stock—reservation begins in B06.

The rate input `ngnMinorPerUsdMinor` is the number of NGN minor units per USD minor unit. For example, an indicative rate of ₦1,500 per US dollar is stored as `1500`. Conversion uses integer half-up rounding. A missing rate produces `usdIndicative: null`; it never blocks an NGN quote.
