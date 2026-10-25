# Backend milestones

| Milestone | State | Notes |
|---|---|---|
| B01 Foundation and test infrastructure | ACCEPTED | Explicitly accepted by the owner on 2026-10-12 after local verification. Production MySQL compatibility remains a separate gate if MySQL is selected for production. |
| B02 Authentication and customer accounts | ACCEPTED | Explicitly accepted by the owner on 2026-10-23 with live Gmail delivery, production email provider/sender, hosted CI, and production MySQL compatibility remaining open gates. |
| B03 Seller onboarding and identity checks | ACCEPTED | Explicitly accepted by the owner on 2026-10-23 with reduced scope. Dojah verification, consent records, callbacks, provider evidence, seller approval policy, and production MySQL verification remain open; real seller approval stays disabled until identity verification is implemented. |
| B04 Catalogue and stock management | READY_FOR_REVIEW | Scope and deterministic local checks completed 2026-10-24. Local database evidence is MariaDB 10.4.32, not production MySQL. Approved-seller tests and Postman samples use guarded synthetic `_test` fixtures only; no production seller-approval bypass exists. Manual Postman execution and production storage/hosting checks remain open. |
