# Backend development instructions for Legit Hair

Place this file at the root of a dedicated backend repository. For a monorepo, place it in the backend directory and merge it with inherited instructions. Retain existing repository rules and replace only conflicting project-specific planning sections after reviewing them.

## Authority and project boundary
The existing PRD is the source of agreed product scope. Backend_Milestone_Plan.docx is the proposed implementation sequence. API routes and policy defaults in this pack are proposed contracts, not already implemented features. Owner-approved scope and decisions take precedence over these proposals. Do not copy this instruction file into the frontend as frontend guidance.

## Current milestone
CURRENT_MILESTONE: B01
STATUS: NOT_STARTED
All B02–B12 milestones are NOT_STARTED. No implementation or tests were performed when this planning pack was created.

## Decisions before dependent implementation
Record choices in docs/decisions/: Dojah identity check and consent text; seller approval policy; commission basis and rate; return window and earnings hold duration; delivery zone charges and mixed seller allocation; COD eligibility and collection reconciliation; provider accounts and email sender; hosting region, budget and domain ownership. Do independent local work while these are unresolved; do not silently invent business policy or label dependent behaviour accepted.

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

## Milestone order
- B01: Foundation and test infrastructure
- B02: Authentication and customer accounts
- B03: Seller onboarding and identity checks
- B04: Catalogue and stock management
- B05: Baskets and delivery quotations
- B06: Orders and inventory reservations
- B07: Paystack payments and paid receipts
- B08: Fulfilment returns and refunds
- B09: Seller earnings and payouts
- B10: Reviews merchandising and reporting
- B11: Realtime support and notifications
- B12: Release hardening and backend handover

## Operating commands
Define and document npm run lint, npm run typecheck, npm run test:unit, npm run test:integration, npm run test:api, npm run test:socket when needed, npm run migrate and npm run seed:test. Introduce these scripts with working implementations as relevant; do not leave dummy success commands. npm test must run the applicable deterministic suite. Provide a separate explicit provider acceptance script and an isolated test database configuration. Record exact commands in each report.

## Initial deliverable locations
- docs/backend-milestones.md: milestone tracker and acceptance gates.
- docs/decisions/: dated architecture and policy decisions.
- docs/api/: actual API contracts and OpenAPI specification as routes are built.
- postman/Legit_Hair_Backend.postman_collection.json and postman/Local.postman_environment.json: actual maintained collection and placeholder environment.
- docs/milestones/: closeout reports and evidence.
