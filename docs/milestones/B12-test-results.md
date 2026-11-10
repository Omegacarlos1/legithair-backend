# B12 test results

Date: 2026-10-30; updated 2026-11-10
Status: READY_FOR_REVIEW

## Final local results

| Check | Result | Evidence |
|---|---:|---|
| ESLint | PASS | Exit 0 |
| TypeScript type check | PASS | Exit 0 |
| Production build | PASS | Exit 0 |
| Unit tests | PASS | 25 passed, 0 failed, 0 skipped |
| Supertest API tests | PASS | 31 passed, 0 failed, 0 skipped |
| MariaDB integration tests | PASS | Final run: 65 passed, 0 failed, 0 skipped in 39 seconds |
| Socket.IO integration tests | PASS | Final isolated rerun: 2 passed, 0 failed, 0 skipped in 3 seconds; initial transient recorded below |
| Total deterministic checks | PASS | 123 passed, 0 failed, 0 skipped |
| Migration rollback/forward | PASS | Repeated complete down/up cycles on isolated MariaDB |
| Backup/restore rehearsal | PASS | Isolated restore, counts, rollback/up, final restore |
| Operations snapshot | PASS | No overdue/stale/recovery conditions before load |
| Provider-safe Postman smoke | PASS | Latest artifact: 47 requests, 76 assertions, zero failures |
| 50-VU browsing pilot | PASS | p95 82 ms, 0% errors/failures |
| 10-VU checkout pilot | PASS | p95 89 ms, 0% errors/failures after fix |
| OpenAPI syntax lint | PASS | OpenAPI 3.1, no issues |
| Five Postman JSON artifacts | PASS | Parsed locally |
| Postman cloud organization follow-up | PASS | Existing collection updated in place to 239 requests and 10 top-level folders; no duplicate collection or saved tokens |
| Frontend Postman handover folder | PASS | 47 requests, 47 test scripts, 76 assertions, zero failures; includes M03, M04, and M06 account/order workflows |
| Full Postman synthetic regression | PASS | 110 requests, 110 test scripts, 214 assertions, zero final failures |
| Captured fake-email verification | PASS | 1 request, 2 assertions; token not printed or persisted |
| Database-outage readiness request | NOT RUN | Requires intentionally stopping MariaDB; retained under `manual-regression` |
| Dependency audit | PASS | 0 known vulnerabilities reported |
| Production MySQL | NOT RUN | MariaDB 10.4.32 is not compatibility proof |
| Provider test-mode/dashboard | NOT RUN | No provider credentials or calls authorized |
| Hosted staging/production | NOT RUN | No deployment/DNS/TLS change authorized |
| Owner manual UAT/training | PENDING | Requires owner/staff execution and acceptance |

## Important execution notes

The normal tsx-based npm test wrappers remain blocked before discovery by the established Windows `uv_os_get_passwd`/ENOMEM host condition. The unchanged Mocha globs passed through the established process-local shim; this limitation is not hidden.

The first backup restore correctly failed because the application identity lacks database-create rights. Source dump access and the explicit isolated restore identity were separated, then the rehearsal passed without elevating the runtime user.

The first checkout performance run is rejected evidence: it exposed a bad collection assertion and retryable MariaDB deadlocks. After correcting the collection and adding bounded transaction retries, the full integration suite, a 10-iteration functional collection, and the final 10-VU profile all passed with zero failures. See [performance evidence](evidence/B12/performance.txt).

The first OpenAPI syntax lint exposed baseline flow-map defects. The final independent lint exited 0 with no issues.

## Post-review Postman organization (2026-11-02)

The maintained collection was reorganized without losing or duplicating requests: 112 before and 112 after. Migration to Postman v3 scanned 147 files with zero lint errors or warnings. The scoped cloud diff showed one update (`legit-hair`), zero creates, and zero workspace deletions; the push updated that one collection successfully. A second isolated diff showed one create (`Legit Hair Local`), zero updates, and zero deletions; the environment push succeeded. Remote verification returned the same collection ID, the seven requested top-level folders, 112 requests, and no saved bearer token or Gmail credential sample.

The first repository ESLint run found JavaScript utility rule/import issues. Those were corrected; final `npm run lint` and `npm run typecheck` both exited 0. See [Postman cloud sync evidence](evidence/B12/postman-cloud-sync.txt).

The frontend handover follow-up retained the existing B11/B12 domain samples and added a curated provider-safe folder with five role logins and representative protected/public reads. Its first imported run exposed four malformed v2.1 query URL objects; the organizer was corrected and the final folder run passed 15/15 requests and 21/21 assertions. No access or refresh token was saved. See [frontend handover evidence](evidence/B12/frontend-handover-postman.txt).

The complete Postman follow-up duplicated maintained requests into dependency order without removing their domain-organized originals. After correcting a synthetic payout recipient value and resetting only the disposable test schema, `full-regression` passed 110/110 requests and 214/214 assertions. The fake-email token boundary was exercised separately by the saved Postman request and passed 2/2 assertions without exposing the token. The database-off readiness case remains visible and correctly classified NOT RUN rather than falsely passed. See [full Postman evidence](evidence/B12/full-postman-regression.txt).

## Password-recovery Postman follow-up (2026-11-09)

The maintained collection now includes forgot-password, reset-password, and login-after-reset samples under `auth > password-recovery`, with controlled duplicates under `manual-regression`. Organization completed with 245 requests and JSON parsing, ESLint, and type checking passed. The saved forgot-password request called `POST /api/v1/auth/forgot-password` on the running local backend and passed 1/1 request, 1/1 test script, and 2/2 assertions with exit 0.

The ordinary focused MariaDB wrapper remained blocked before discovery by the established Windows `uv_os_get_passwd`/`ENOMEM` host condition. The documented shim executed the complete authentication file: both password-reset cases passed, followed later by an unrelated fake-email count failure (`11` passing, `1` failing) because six queued jobs had already been completed, consistent with another local email worker using the shared disposable schema. Process enumeration was denied by the host, so that inference was not promoted to a clean-suite claim. A grep-only rerun was rejected because the selected tests depend on customer setup performed by earlier tests in the same file. See [password-recovery Postman evidence](evidence/B12/password-recovery-postman.txt).

## M03 basket handover follow-up (2026-11-09)

The existing runtime routes were confirmed rather than reimplemented: `GET /api/v1/baskets/current` and `DELETE /api/v1/baskets/items/:productId`. API coverage now includes missing and ambiguous owner credentials. MariaDB coverage reads and removes guest and customer lines, rejects cross-owner removal, confirms empty-basket reads, and confirms repeated removal returns `404 BASKET_ITEM_NOT_FOUND`.

ESLint, type checking, build, 25 unit tests, 30 API tests, 65 MariaDB integration tests, and 2 Socket.IO tests passed with zero assertion failures or skips. The normal tsx npm wrappers again stopped before discovery on the known host `uv_os_get_passwd`/`ENOMEM` condition; the established process-local `os.userInfo` shim ran the unchanged test files. OpenAPI 3.1 syntax lint reported no issues, the maintained and smoke Postman JSON parsed, and both the standalone smoke and maintained `frontend-handover` folder passed 24/24 requests and 37/37 assertions. See [M03 handover evidence](evidence/B12/m03-basket-handover.txt).

## M04 saved-address and pickup-quote handover follow-up (2026-11-09)

The backend already exposed owned address list/create and accepted `{ "deliveryMethod": "pickup", "pickupLocationId": "..." }`; the frontend gap was partly contract discoverability and partly missing address mutation operations. This follow-up adds owner-scoped address update and atomic default selection. Address mutation serializes on the owning user, concurrent default selections leave exactly one default, and cross-owner/unknown mutation returns `404 ADDRESS_NOT_FOUND`. No schema migration or business-policy value changed.

The focused authentication integration file passed 12/12 against MariaDB, including creation/listing, nullable `line2`, update, concurrent selection, final deterministic selection, cross-owner denial, and unknown-ID denial. Final static/build checks passed; the complete deterministic suites finished at 25 unit, 30 API, 65 MariaDB integration, and 2 Socket.IO checks. The first Socket.IO attempt returned `false` once while recovering a stale outbox lease (1 pass, 1 fail); the immediate isolated rerun passed 2/2. The transient is recorded and was unrelated to the address/quote changes.

OpenAPI 3.1 syntax lint reported no issues. The maintained collection organized to 260 requests. Both the standalone provider-safe smoke and `frontend-handover` folder passed 30/30 requests, 30/30 test scripts, and 47/47 assertions against the disposable MariaDB schema. Postman reported an offline feature-flag `AggregateError`, but local execution completed with exit 0. See [M04 handover evidence](evidence/B12/m04-address-pickup-handover.txt).

## M06 account and order handover follow-up (2026-11-10)

Added customer-only `GET /api/v1/orders` with owner scoping, newest-first stable pagination, optional status filtering, and immutable item summaries. Added chronological `order_status` and `suborder_status` timeline entries to the existing customer/guest fulfilment read without exposing actor identifiers. Existing guest credential authorization, return item selection, and review pagination were verified rather than reimplemented. Return/review response schemas and examples are now explicit; return evidence upload remains unsupported pending the existing object-storage, authorization, and retention gates.

Final static/build checks passed. The documented host shim executed 25/25 unit, 31/31 API, 65/65 MariaDB integration, and 2/2 Socket.IO checks: 123 total, zero failures/skips. Focused runs separately passed 3 order API checks, 4 MariaDB order scenarios, and 7 MariaDB fulfilment/refund scenarios. The normal focused API wrapper was attempted and stopped before discovery on the established `uv_os_get_passwd`/`ENOMEM` host condition.

OpenAPI 3.1 syntax lint initially identified one unquoted comma in an inline response description; after correction, the final lint exited 0 with no issues. Both Postman JSON collections parsed, organized deterministically to 277 requests, and executed successfully. The standalone smoke and maintained `frontend-handover` folder each passed 47/47 requests, 47/47 test scripts, and 76/76 assertions against the disposable MariaDB schema. Postman again reported only the offline feature-flag `AggregateError`; runs exited 0. `postman collection lint` exited 0 but scanned zero entities because these maintained exports are v2.1 rather than git-native v3. `postman status` is unavailable in the installed CLI and returned `unknown command`. See [M06 handover evidence](evidence/B12/m06-orders-account-handover.txt).

## What the evidence establishes

It establishes local regression behavior, guarded MariaDB recovery, a provider-safe smoke, exact-origin/security/error hardening, operations-state checks, and the two specified same-host synthetic pilot profiles. It does not establish production MySQL compatibility, hosted capacity, provider readiness, business-policy approval, deployment, staff training, or live-money safety.

Evidence: [automated tests](evidence/B12/automated-tests.txt), [database recovery](evidence/B12/database-recovery.txt), [performance](evidence/B12/performance.txt), [Postman/contract/security](evidence/B12/postman-contract-security.txt), [Postman cloud sync](evidence/B12/postman-cloud-sync.txt), [frontend Postman handover](evidence/B12/frontend-handover-postman.txt), [full Postman regression](evidence/B12/full-postman-regression.txt), [password-recovery Postman follow-up](evidence/B12/password-recovery-postman.txt), [M03 basket handover](evidence/B12/m03-basket-handover.txt), and [M04 address/pickup handover](evidence/B12/m04-address-pickup-handover.txt).

