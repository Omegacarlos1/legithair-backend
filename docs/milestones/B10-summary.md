# B10 reviews, merchandising, and reporting summary

Status: READY_FOR_REVIEW on 2026-10-29

## Completed scope

- Added one purchase-linked review per customer and product, restricted to settled, fulfilled purchases. Review creation is idempotent and keeps pending content out of public responses.
- Added admin moderation with immutable publish/reject audit events. Public review lists expose only published content and update rating summaries from visible reviews.
- Retained the simple category-related-product rule and completed paid-unit popularity for first-time confirmed COD collections; Paystack settlement already updates the same counter.
- Added time-windowed homepage banners with admin-only create/update operations and audit history.
- Added bounded JSON and CSV reports for gross sales, product units, processed refunds, commission snapshots/reversals, seller earnings buckets and payout/paid-ledger reconciliation.
- Added the support role while keeping financial reports limited to admin and finance. CSV output quotes every field and neutralises spreadsheet formula prefixes.
- Updated OpenAPI, focused API documentation, Postman requests/environment, guarded fixtures, architecture decision, migrations and automated coverage.

## Migration and recovery

Migration `013_reviews_merchandising_reporting.sql` adds `product_reviews`, `review_moderation_events`, `homepage_banners`, `banner_audit_events` and the `support` role. The down migration removes support-role assignments before narrowing the enum, then drops all B10 review/banner content and audit history. That rollback is destructive and requires an export and audited recovery plan before production use. Migration 013 applied successfully to the local development MariaDB and to a clean disposable test schema. Production MySQL compatibility remains unverified.

## Verification

ESLint, type checking, build, 20 unit tests, 23 Supertest API tests and 61 MariaDB integration tests passed on the final 2026-10-29 run: 104 total, zero application failures and zero skipped. Five integration scenarios are B10-specific. See [B10 test results](B10-test-results.md) and [evidence/B10](evidence/B10/automated-tests.txt).

Exact checks executed:

```text
npm run lint
npm run typecheck
npm run build
node -e "... os.userInfo shim ... test/unit/**/*.test.ts test/api/**/*.test.ts"
NODE_ENV=test DATABASE_NAME=legit_hair_app_test EMAIL_PROVIDER=fake node -e "... os.userInfo shim ... test/integration/**/*.test.ts"
node -e "... JSON.parse Postman collection and environment ..."
node -e "... os.userInfo shim ... migrate('up')"
NODE_ENV=test DATABASE_NAME=legit_hair_app_test EMAIL_PROVIDER=fake node -e "... os.userInfo shim ... seedTestFixtures()"
```

The exact process-local shim and PowerShell environment syntax are recorded in [automated test evidence](evidence/B10/automated-tests.txt) and [database evidence](evidence/B10/local-database-and-fixtures.txt). Ordinary npm Mocha wrappers remain blocked before discovery by this Windows host's `uv_os_get_passwd`/`ENOMEM` issue; the same files passed through the established shim.

## Changed areas

- `migrations/013_*`: B10 review, moderation, banner, audit and support-role schema plus rollback.
- `src/reviews/`, `src/merchandising/`, `src/reporting/`: services and HTTP routes.
- `src/fulfilment/service.ts`: idempotent COD paid-unit popularity update.
- `src/auth/` and `src/app.ts`: support role, multi-role guard and route registration.
- `test/` and `scripts/seed-test.ts`: unit, API, MariaDB and guarded support-fixture coverage.
- `docs/api/`, `docs/decisions/`, `postman/`, `.env.example`, README, tracker and evidence: maintained contracts and handoff.

## Postman

Do not import a new file if the maintained collection is already open; refresh/reopen the repository collection and select the Local environment. Start MariaDB and the API, run migrations, and run the guarded seed against `legit_hair_app_test`. The review request uses `b08ReturnOrderItemId`, so first complete the existing synthetic paid/fulfilled B06-B08 flow or retain those variables from the accepted B08 manual run. Then run the B10 requests in their displayed order: customer review, other-customer rejection, admin publish/read/reject/hidden checks, related products, admin banner create/read, finance reports, support-forbidden report and CSV export. See [Postman evidence](evidence/B10/postman-contract.txt) for expected statuses and variable usage.

The collection and environment parse successfully and include assertions. Owner manual execution is not claimed and remains an acceptance gate.

## Open gates and limitations

- Owner manual Postman execution and explicit B10 acceptance are not complete.
- Verification used MariaDB 10.4.32, not production MySQL.
- Deployment-scale report performance, retention periods and final production staff-role assignments remain owner/release decisions.
- Reports are bounded operational views over current transactional records, not an analytics warehouse. Gross sales preserve settled pre-refund value; refunds and financial reversals are separate reports by design.
- B10 invokes no third-party provider and makes no live-money claim. Earlier Paystack, policy and production gates remain unchanged.

## Pull request description

Implement B10 purchase-linked reviews and moderation, category merchandising, audited banners, paid-unit popularity, role-separated financial reports and formula-safe CSV export. Add migration 013, OpenAPI/Postman contracts, guarded support fixtures and 104 passing automated checks. Main risks are destructive B10 rollback, unverified production MySQL/performance and pending owner Postman acceptance. No provider call or live money movement occurred.

## Complete next-milestone prompt

Use the following only after B10 is explicitly accepted. B11 must not start while B10 remains `READY_FOR_REVIEW`.

```text
## B11 Realtime support and notifications

Implement only B11 for the Legit Hair backend under the PRD. Confirm B10 is accepted and inspect its evidence before dependent work.

### Required scope
Implement persistent support threads and messages plus Socket.IO updates. Authenticate connections and room membership, acknowledge messages with client IDs, deduplicate retries and fetch missing history after reconnect. Persist first, emit through the outbox, and provide HTTP read fallback. Extend email delivery records and retries; marketing requires explicit opt in, suppression and unsubscribe. Split chat and marketing into reviewed substeps if needed.

### Acceptance evidence
Use socket.io-client integration tests for unauthorised joins, cross thread access, acknowledgements, retries and reconnect recovery; test disconnected clients and worker crashes; suppressed recipients never receive marketing; email retries do not duplicate logical events.

### Proposed Postman samples
GET /support/threads/:threadId/messages; POST /support/threads. Align the contract with actual implementation and explain any approved change. Include positive and negative requests, fixture IDs and response assertions.

## Scope and engineering rules
- Work on the backend only. Use Node.js supported LTS, Express, proposed TypeScript, Socket.IO and MySQL; record pinned versions in the lockfile and architecture decisions. Use Mocha for backend unit and integration tests and Supertest for HTTP tests. Jest remains the PRD frontend testing choice.
- Inspect the repository, its applicable AGENTS.md files and the PRD before editing. Preserve unrelated work. Never replace existing repository instructions wholesale. If the repository is empty, scaffold only the current milestone.
- Local XAMPP is tooling: standard distributions may use MariaDB. Use separately installed MySQL matching production and point phpMyAdmin to it; Node runs independently. Do not claim MariaDB-only tests prove MySQL compatibility.
- Use modular services, repositories and provider adapters, explicit validation, central errors, versioned API contracts and least privilege. Keep controllers thin. Prefer practical modular architecture; do not introduce microservices without a demonstrated need.
- Apply schema migrations rather than manual production changes. Integration tests use a dedicated disposable MySQL schema; prevent test commands from targeting production. Test transaction locks and races against real MySQL, not an in-memory substitute. Use synthetic fixtures and no live personal identity data.
- NGN is the base settlement currency. Store money as integer minor units, with safe numeric handling and explicit rounding; snapshot prices, delivery allocation and commission rules. USD is indicative display only. Never add real USD settlement, wallets, escrow, coupons, variants, nationwide delivery or other excluded scope.
- Enforce ownership and roles on every protected operation, including sockets and downloads. Protect guest access with unguessable credentials. Hash passwords, rate limit sensitive operations, redact secrets and identity values, and keep auditable financial decisions.
- Use short database transactions, unique constraints and idempotency keys. Keep external network calls outside long transactions. Persist jobs and events; make retries safe and reconcile uncertain payment and transfer outcomes. A browser callback is never proof of payment.
- Mock provider adapters for repeatable local tests. Label provider test mode and live evidence separately. Consult current official Paystack and Dojah documentation before implementing their contracts; never fabricate webhook authentication. Missing credentials block provider acceptance, not independent local work.
- Never mark tests passed unless executed. Do not invent coverage, deployment status or provider results. Implement only this milestone, update its status and stop after closeout. Do not start the next milestone without a new instruction.

## Required milestone closeout
1. Run appropriate lint, type checking, unit tests, API tests and real MySQL integration tests. Resolve failures caused by the change; explicitly report any baseline failure or blocked check. Test meaningful negative, authorisation, concurrency, idempotency and recovery cases relevant to this milestone.
2. Commit no secrets. Update .env.example, migrations, API documentation and an importable Postman collection and environment using placeholders. Include exact request bodies, authentication, expected statuses and assertions, and the seed commands that create IDs. Do not include secret values in exports.
3. Write docs/milestones/Bxx-summary.md: scope completed, changed files, migrations and rollback or recovery, exact commands executed, pass/fail/skipped counts, relevant report paths, Postman evidence, provider checks, unresolved decisions and limitations. Distinguish local verification from acceptance.
4. Write docs/milestones/Bxx-test-results.md with actual evidence. Save automated test output in docs/milestones/evidence/Bxx/. Never substitute a test plan for test results.
5. Update docs/backend-milestones.md and AGENTS.md current milestone status. Allowed states: NOT_STARTED, IN_PROGRESS, LOCAL_VERIFIED, BLOCKED, READY_FOR_REVIEW, ACCEPTED. LOCAL_VERIFIED means required local checks passed; READY_FOR_REVIEW requires documented scope completion and known integration gates. ACCEPTED requires explicit owner acceptance, never infer it from passing tests.
6. Return a concise milestone summary, test summary, Postman usage instructions, migration risks and open gates, and the complete copy-ready prompt for the next milestone. For B12 provide handover instead of inventing B13. Stop here.
```
Source: `docs/Codex_Backend_Milestone_Prompts.md`.
