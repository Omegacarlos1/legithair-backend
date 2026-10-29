# ADR 0010: B09 earnings ledger and payout recovery

Date: 2026-10-27

Status: accepted implementation boundary; owner policy and provider acceptance remain open

## Decision

- Seller money is represented by immutable double-entry-style bucket movements with unique logical keys. Stored order and item commission snapshots are the source; delivery fees are excluded from seller net.
- `EARNINGS_HOLD_DAYS` is optional and has no invented production default. `PAYOUTS_ENABLED=false` is a separate money-movement kill switch.
- Paystack and confirmed COD proceeds become held only after fulfilment. Release moves held to available. Refunds consume held and available without either going negative; already-paid exposure becomes recoverable finance balance.
- A distinct `finance` role configures payout recipients, approves payouts, reads payout state, and reconciles uncertain transfers. Customer, seller, and general admin roles cannot approve transfers.
- A payout reserves available balance and commits its unique provider reference before the network call. Provider calls happen outside the transaction. Timeouts remain uncertain and verification always queries the original reference. Failed/reversed transfers restore eligibility once through unique ledger keys.
- Paystack recipient creation and bank-account collection are not implemented here. Finance binds an already verified Paystack recipient code and stores only masked account metadata.

## Consequences

Production payout initiation remains disabled until hold duration, payout frequency/review process, recovery policy, Paystack transfer access, recipient verification operations, and live money-movement authority are approved. Rolling migration 010 down deletes payout and seller-ledger evidence and must only be done with an audited recovery plan outside disposable environments.

Official Paystack contracts consulted on 2026-10-27:

- <https://paystack.com/docs/api/transfer/>
- <https://paystack.com/docs/transfers/how-transfers-work/>
- <https://paystack.com/docs/transfers/creating-transfer-recipients/>
- <https://paystack.com/docs/payments/webhooks/>
