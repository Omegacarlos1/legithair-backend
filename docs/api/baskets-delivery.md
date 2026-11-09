# Baskets and delivery quotation API

All amounts are integer minor units. NGN is the settlement currency. USD values are indicative only and include the snapshotted admin rate and its update timestamp.

## Basket credentials

Authenticated customers use `Authorization: Bearer <access-token>`. Guests first call `POST /api/v1/baskets/guest`; the raw `guestBasketToken` is returned once and must be sent as `X-Guest-Basket-Token`. Only its SHA-256 hash is stored. Supplying both credentials is rejected. Guest baskets expire after the configured TTL.

`POST /api/v1/baskets/items` sets the absolute desired quantity for a product, rather than incrementing it. Quantities are 1–20 and a basket supports at most 50 distinct products. The server snapshots the observed price. `POST /api/v1/baskets/refresh` explicitly accepts current prices after checking publication, seller eligibility and stock.

`POST /api/v1/baskets/merge` requires customer authentication plus the guest header. Duplicate products are summed inside one transaction. The entire merge fails if any combined quantity exceeds 20, the basket would exceed 50 lines, or an item is unavailable. Replaying the same guest merge returns the already-merged customer basket without adding quantities again.

## M03 basket read and removal contract

Both guest and authenticated customer baskets use the same read route:

```http
GET /api/v1/baskets/current
Authorization: Bearer <customer-access-token>
```

or, for a guest:

```http
GET /api/v1/baskets/current
X-Guest-Basket-Token: <opaque-guest-basket-token>
```

Exactly one credential is allowed. Supplying neither returns `401 BASKET_CREDENTIAL_REQUIRED`; supplying both returns `400 AMBIGUOUS_BASKET_OWNER`. A valid customer with no previous basket receives `200` with a newly created empty basket. A missing, expired, or already-merged guest credential returns `401 INVALID_GUEST_BASKET`.

The `200` response uses the standard success envelope. Money values are integer NGN minor units:

```json
{
  "success": true,
  "data": {
    "basket": {
      "id": "<uuid>",
      "ownerType": "guest",
      "status": "active",
      "expiresAt": "2026-12-09T10:00:00.000Z",
      "items": [
        {
          "productId": "<uuid>",
          "name": "Example Wig",
          "seller": { "id": "<uuid>", "businessName": "Example Seller" },
          "quantity": 2,
          "observedPriceMinor": 100000,
          "currentPriceMinor": 100000,
          "lineTotalMinor": 200000,
          "priceChanged": false,
          "available": true,
          "stockQuantity": 10
        }
      ],
      "totals": { "currency": "NGN", "itemsSubtotalMinor": 200000 },
      "createdAt": "2026-11-09T10:00:00.000Z",
      "updatedAt": "2026-11-09T10:00:00.000Z"
    }
  },
  "meta": { "requestId": "<request-id>" }
}
```

Customer baskets return `ownerType: "customer"` and `expiresAt: null`. Empty baskets return `items: []` and an `itemsSubtotalMinor` of `0`.

Remove a line by product ID, not by a basket-line index:

```http
DELETE /api/v1/baskets/items/<product-uuid>
X-Guest-Basket-Token: <opaque-guest-basket-token>
```

The customer form uses `Authorization` instead. Success is `204 No Content` with an empty response body. Removing an absent line returns `404 BASKET_ITEM_NOT_FOUND`; the frontend should re-read the basket because its local state is stale. An invalid product UUID returns `400 VALIDATION_ERROR`. Ownership is derived only from the credential, so one customer or guest cannot remove another owner's line.

## Approved browser persistence

The header-based M03 frontend may keep the raw guest credential in same-origin `localStorage` under `legitHair.guestBasketToken.v1`, storing only `{ "token": "...", "expiresAt": "..." }`. Create it lazily, validate it with the current-basket read on startup, never place it in a URL or logs, and remove it after successful login merge, local/server expiry, explicit local reset, or `401 INVALID_GUEST_BASKET`. Retain it across network and `5xx` failures. While authenticated, send only the bearer token except for the merge request. The complete security and cross-tab lifecycle is fixed by [ADR 0014](../decisions/0014-guest-basket-browser-persistence.md).

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
