# ADR 0004: Defer the B03 Dojah identity workflow

Status: owner-directed deferral, 2026-10-23

The owner accepted B02 with its documented external gates and instructed the team to skip Dojah for now. B03 may implement independent seller profile, role, approval-state, suspension, authorisation, audit, migration, API-contract, and test work. It must not choose NIN versus BVN, invent consent language, collect raw identity values, fabricate Dojah requests or callbacks, or claim provider acceptance.

Seller identity state and admin approval state remain separate. The database represents identity as `not_started`, `pending`, `verified`, `failed`, or `manual_review`, and approval as `pending`, `approved`, or `suspended`. No public route can set identity to verified while the provider is deferred. Admin approval requires an already verified identity, preventing the deferred integration from becoming an approval bypass. Admin suspension is available independently and blocks verification initiation.

`POST /api/v1/sellers/me/verification` is reserved but returns `503 IDENTITY_PROVIDER_NOT_CONFIGURED` for non-suspended sellers. It accepts only an empty body so no NIN, BVN, consent, or other identity value is accidentally stored. Selecting the Dojah workflow and exact consent text is required before implementing provider requests, callbacks, consent records, or positive verification acceptance evidence.
