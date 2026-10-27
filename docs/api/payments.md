# Paystack payments and paid receipts API

All money is integer NGN minor units. Every customer-facing operation requires either the owning customer's bearer token or the guest order's `X-Order-Tracking-Token`. Wrong-owner and unknown records use the same not-found response.

## Initialize payment

`POST /api/v1/payments/initialize`

Registered customer body:

```json
{ "orderId": "<uuid>" }
```

Guest body (email is required on first initialization):

```json
{ "orderId": "<uuid>", "email": "guest@example.com" }
```

The backend accepts only an owned `awaiting_payment` Paystack order with a live reservation. It persists a server-generated reference before calling Paystack, and sends the database email, exact order total, `NGN`, and order/payment metadata. Client-supplied amount, currency, metadata, callback URL, or arbitrary reference are not accepted.

Responses: `201` for a new attempt, `200` for the same persisted attempt, `400` when guest email is missing, `401` without access, `404` for inaccessible orders, `409` for a non-Paystack/non-payable/expired order or changed guest email, and `503` when Paystack is unconfigured or temporarily unavailable. A timeout leaves one recoverable `initialization_pending` row with the original reference.

## Verify payment

`POST /api/v1/payments/verify`

```json
{ "orderId": "<uuid>", "reference": "LH-<server-generated-reference>" }
```

The reference must equal the one returned by initialization. The backend then queries Paystack and validates provider status, exact amount, `NGN`, reference, and `order_id`/`payment_id` metadata. A successful, timely payment consumes the existing reservation and atomically increments product paid-unit popularity, creates one ledger entry, one receipt, one receipt-email job, an order status event, and an outbox event. Pending verification returns `200` with `outcome: "pending"`. Tampering or provider mismatch returns `409` without delivering value.

## Paystack webhook

`POST /api/v1/payments/webhooks/paystack`

This public provider route requires `X-Paystack-Signature`. The value must be the hexadecimal HMAC SHA-512 of the exact raw JSON bytes using `PAYSTACK_SECRET_KEY`. The application validates the signature before database work. `charge.success` is handled; repeated provider events return `200` with `duplicate: true` and cannot duplicate a ledger entry, receipt, or email job. Unsupported signed event types are acknowledged and recorded as ignored.

Do not put the Paystack secret in Postman environments or frontend code. Configure the public HTTPS webhook URL in the Paystack dashboard. Localhost cannot receive Paystack delivery.

## Download paid receipt

`GET /api/v1/orders/:orderId/receipt`

Returns the immutable JSON receipt using `Content-Disposition: attachment`. It includes receipt/order/payment identifiers, currency, amount, Paystack reference and transaction identifier, paid timestamp, and immutable order item snapshots. It returns `404` until a valid timely payment is settled; late payments intentionally receive no paid-order receipt.

## Recovery and late payments

Run `npm run payments:reconcile` under the same isolated worker configuration to verify persisted pending references. The worker exits non-zero if any provider checks fail so scheduling/monitoring can alert.

When Paystack confirms success after a reservation has expired or been released, the payment becomes `late_success`. The application records `late_payment_received` and opens a review case, but does not mark the order paid, create a receipt, or consume/reacquire stock. Refund execution and review resolution are B08 scope.

For separate provider acceptance, set an uncommitted `sk_test_...` secret and `PAYSTACK_ACCEPTANCE_EMAIL`, then run `npm run payments:verify-provider`. It initializes NGN 100.00 and verifies the pending test transaction without completing payment. The command refuses live keys.
