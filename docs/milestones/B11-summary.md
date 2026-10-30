# B11 realtime support and notifications summary

Status: ACCEPTED on 2026-10-30

## Completed scope

- Added persistent customer support threads and messages with customer ownership, staff queue access, assignment, close/reopen operations and ascending bigint history offsets.
- Added authenticated Socket.IO support rooms, per-event token revalidation, acknowledgements, client-generated UUID deduplication, concurrent retry handling and offset-based reconnect recovery.
- Persisted messages and outbox events in one transaction. The publisher recovers stale leases, emits persisted events at least once and leaves clients to deduplicate by event or message ID.
- Added HTTP history and message-write fallbacks for disconnected clients.
- Added one durable delivery record and numbered attempts per logical email job, bounded retries, retry scheduling, terminal failure and stale-worker recovery.
- Added explicit customer marketing opt-in, admin suppression, opaque unsubscribe tokens, pre-delivery consent rechecks and separate transactional/marketing delivery categories.
- Added admin campaign creation and delivery inspection. Campaign creation fails closed until an unsubscribe base URL is configured.
- Updated OpenAPI, focused API documentation, Postman requests/environment, guarded support fixtures, configuration, architecture decision and automated coverage.

## Migration and recovery

Migration `014_realtime_support_notifications.sql` extends `durable_jobs` and `outbox_events`, then adds support threads/messages, marketing preferences and suppressions, campaigns and unsubscribe tokens, plus email delivery/attempt records. Migration 014 applied to local development MariaDB and repeatedly rolled down/up on the isolated `legit_hair_app_test` schema.

The down migration drops all B11 support history, consent/suppression records, campaigns, unsubscribe tokens and email delivery evidence before removing the new job/outbox columns. That rollback is destructive. Export and retain these records before production rollback; prefer a reviewed forward-recovery migration once B11 data exists. MariaDB 10.4.32 evidence does not prove production MySQL compatibility.

## Verification

The final verified matrix is 112 passing checks: 21 unit, 25 API, 64 MariaDB integration and 2 Socket.IO integration; zero final failures and zero skipped. ESLint, type checking, build, OpenAPI/Postman parsing and dependency audit also passed. See [B11 test results](B11-test-results.md) and [automated evidence](evidence/B11/automated-tests.txt).

Exact checks executed:

```text
npm run lint
npm run typecheck
npm run build
npm test
node -e "... os.userInfo host shim ... test/unit/**/*.test.ts"
node -e "... os.userInfo host shim ... test/api/**/*.test.ts"
NODE_ENV=test DATABASE_NAME=legit_hair_app_test EMAIL_PROVIDER=fake node -e "... os.userInfo host shim ... test/integration/**/*.test.ts"
NODE_ENV=test DATABASE_NAME=legit_hair_app_test EMAIL_PROVIDER=fake node -e "... os.userInfo host shim ... test/socket/**/*.test.ts"
npm audit --audit-level=low
node -e "... parse Postman JSON and OpenAPI YAML ..."
node -e "... os.userInfo host shim ... migrate('up')"
NODE_ENV=test DATABASE_NAME=legit_hair_app_test EMAIL_PROVIDER=fake node -e "... os.userInfo host shim ... seedTestFixtures()"
```

The ordinary npm Mocha wrappers still fail before test discovery on this Windows host because `tsx` calls `uv_os_get_passwd`, which returns host-level `ENOMEM`. The established process-local `os.userInfo` shim loads the same Mocha files; all 112 checks passed through it. A first full integration attempt timed out while a previously started API process held connections to the disposable test schema. The local test server was stopped, the affected payment suite passed 7/7, and the clean full integration rerun passed 64/64. A Socket.IO rerun also exposed an assertion that consumed an older valid outbox event; the test was corrected to match the intended client ID, then passed 2/2. No application failure was omitted from the final result.

## Changed areas

- `migrations/014_*`: durable job/outbox leases, persistent support, consent/suppression, campaign/unsubscribe and email delivery schema plus destructive rollback.
- `src/support/`: HTTP service/router, Socket.IO authorization and persistent outbox publisher.
- `src/marketing/`: explicit preference, suppression, campaign, unsubscribe and delivery inspection services/routes.
- `src/email/`: marketing rendering/headers and recoverable delivery-attempt processing.
- `src/server.ts`, `src/app.ts`, `src/config.ts` and worker scripts: HTTP/Socket.IO lifecycle, routing and B11 configuration.
- `test/`: negative API, real MariaDB, email and socket.io-client authorization, retry, reconnect, suppression and crash-recovery coverage.
- `docs/api/`, `docs/decisions/`, `postman/`, `.env.example`, README, tracker and evidence: maintained contracts and handoff.

## Manual Postman review without importing a file

Keep the repository collection already open in Postman; refresh or reopen it rather than importing another file. Select the existing Local environment.

1. Start MariaDB. In PowerShell set `NODE_ENV=test`, `DATABASE_NAME=legit_hair_app_test`, `EMAIL_PROVIDER=fake`, and `MARKETING_UNSUBSCRIBE_BASE_URL=http://127.0.0.1:3000/api/v1/marketing/unsubscribe`.
2. Run migrations and the guarded test seed, then start the API. The seed login password is `FixturePass123!`.
3. Send `B02 Login seeded customer`, `B03 Login seeded admin`, `B04 Login synthetic other seller`, and `B10 Support login` so all four access-token variables are current.
4. Send the B11 requests in displayed order: customer opt-in, create support thread, read history, cross-thread negative, support HTTP reply, create campaign, support campaign negative, and customer opt-out.
5. Expect statuses `200, 201, 200, 404, 201, 201, 403, 200`. The request tests save the B11 IDs and assert the important body fields.
6. Optionally run `npm run email:work-once` while still using the fake provider, then inspect the campaign delivery endpoint documented in OpenAPI. No real email is sent.

The collection/environment and OpenAPI parse successfully. The owner explicitly accepted B11 on 2026-10-30. Manual Postman execution was not separately reported, so that evidence remains open rather than being inferred from acceptance. Detailed expected results are in [Postman evidence](evidence/B11/postman-contract.txt).

## Open gates and limitations

- B11 owner acceptance is complete. Owner manual Postman evidence remains open.
- Verification used MariaDB 10.4.32, not production MySQL.
- Socket.IO delivery is verified for one application instance. Horizontal deployment needs a reviewed shared adapter and coordinated outbox ownership; database history remains authoritative.
- Production email sender credentials, SPF/DKIM/DMARC, provider selection, bounce/complaint webhook ingestion and delivery monitoring remain release gates. Local provider evidence used only the fake adapter and a no-network Gmail renderer test.
- A provider timeout after accepting an SMTP message can still create uncertain external delivery; retries retain one internal logical event but the SMTP provider has no application idempotency key.
- There is an unavoidable narrow interval between the worker's final consent check and external provider acceptance. Production campaigns require operational suppression controls and provider feedback handling.
- Support staffing/hours, retention periods, deployment performance and production monitoring remain owner/release decisions. Earlier policy, Paystack, Dojah and live-money gates are unchanged.

## Pull request description

Implement B11 persistent support and notifications: customer-owned threads, authenticated Socket.IO rooms, idempotent acknowledgements, reconnect history, transactional outbox publication, durable email retry records, explicit marketing consent, suppression and unsubscribe. Add migration 014, OpenAPI/Postman contracts, guarded fixtures and 112 passing automated checks. Main risks are destructive rollback, unverified production MySQL/multi-instance behavior, incomplete production email/provider controls and unreported owner Postman execution. No live email, deployment or money movement occurred. B11 was explicitly accepted on 2026-10-30.

## Complete next-milestone prompt

The B12 entry gate is now satisfied by explicit B11 acceptance. B12 remains `NOT_STARTED` and requires a separate owner instruction. Use this complete copy-ready prompt when instructed:

```text
## B12 Release hardening and backend handover

Implement only B12 for the Legit Hair backend under the PRD. Confirm B11 is accepted and inspect its evidence before dependent work.

### Required scope
Run end to end order, payment, delivery, refund and payout scenarios; review dependencies, validation, rate limits, secrets, upload security, permissions and audit trails. Prepare staging deployment, domain DNS and HTTPS instructions, production MySQL, worker monitoring and backup restoration. Measure the proposed pilot workload and document bottlenecks. Obtain separate authorisation for live deployment and live money movement.

### Acceptance evidence
Restore a backup into an isolated database; verify migrations and rollback or forward recovery; measure 50 browsing users and 10 concurrent checkouts with proposed internal read API p95 below 1 second, excluding provider time; document actual results and pending provider gates.

### Proposed Postman samples
GET /health; GET /ready; run complete Postman smoke workflow. Align the contract with actual implementation and explain any approved change. Include positive and negative requests, fixture IDs and response assertions.

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
