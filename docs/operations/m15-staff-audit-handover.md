# M15 staff and audit handover

Run `npm run migrate` and `npm run seed:test` against an isolated `_test` database, start the API, and import the maintained Postman collection and Local environment. Sign in as `admin.fixture@example.test` using the synthetic fixture password, store `data.tokens.accessToken` as `adminAccessToken`, and run the **M15 staff and audit** folder. `staffUserId` defaults to the synthetic support fixture. The grant request is idempotent for that fixture; change it to another verified synthetic user to observe a new audit event. Do not run the seed on production.

The exact contract is in [staff-audit.md](../api/staff-audit.md). Staff reads and role changes require admin. Audit reads are read-only and include five bounded existing event sources. No export, admin role assignment, custom permissions, or retention behavior was added.
