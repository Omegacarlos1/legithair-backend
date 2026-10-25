# Backend milestones

| Milestone | State | Notes |
|---|---|---|
| B01 Foundation and test infrastructure | ACCEPTED | Explicitly accepted by the owner on 2026-10-12 after local verification. Production MySQL compatibility remains a separate gate if MySQL is selected for production. |
| B02 Authentication and customer accounts | ACCEPTED | Explicitly accepted by the owner on 2026-10-23 with live Gmail delivery, production email provider/sender, hosted CI, and production MySQL compatibility remaining open gates. |
| B03 Seller onboarding and identity checks | ACCEPTED | Explicitly accepted by the owner on 2026-10-23 with reduced scope. Dojah verification, consent records, callbacks, provider evidence, seller approval policy, and production MySQL verification remain open; real seller approval stays disabled until identity verification is implemented. |
| B04 Catalogue and stock management | ACCEPTED | Explicitly accepted by the owner on 2026-10-25 after an owner-reported successful manual Postman run. Local database evidence remains MariaDB 10.4.32, not production MySQL. Production image storage and the earlier B03 gates remain open. Approved-seller tests and Postman samples use guarded synthetic `_test` fixtures only; no production seller-approval bypass exists. |
| B05 Baskets and delivery quotations | IN_PROGRESS | Started 2026-10-25 after B04 acceptance and merge. Lagos delivery zones and separate-seller allocation are approved in ADR 0006; the real production pickup street address and courier quotation remain activation gates. |
