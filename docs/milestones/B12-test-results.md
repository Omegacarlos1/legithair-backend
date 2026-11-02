# B12 test results

Date: 2026-10-30  
Status: READY_FOR_REVIEW

## Final local results

| Check | Result | Evidence |
|---|---:|---|
| ESLint | PASS | Exit 0 |
| TypeScript type check | PASS | Exit 0 |
| Production build | PASS | Exit 0 |
| Unit tests | PASS | 25 passed, 0 failed, 0 skipped |
| Supertest API tests | PASS | 28 passed, 0 failed, 0 skipped |
| MariaDB integration tests | PASS | 64 passed, 0 failed, 0 skipped in 53 seconds |
| Socket.IO integration tests | PASS | 2 passed, 0 failed, 0 skipped in 4 seconds |
| Total deterministic checks | PASS | 119 passed, 0 failed, 0 skipped |
| Migration rollback/forward | PASS | Repeated complete down/up cycles on isolated MariaDB |
| Backup/restore rehearsal | PASS | Isolated restore, counts, rollback/up, final restore |
| Operations snapshot | PASS | No overdue/stale/recovery conditions before load |
| Provider-safe Postman smoke | PASS | 15 requests, 21 assertions, zero failures |
| 50-VU browsing pilot | PASS | p95 82 ms, 0% errors/failures |
| 10-VU checkout pilot | PASS | p95 89 ms, 0% errors/failures after fix |
| OpenAPI syntax lint | PASS | OpenAPI 3.1, no issues |
| Five Postman JSON artifacts | PASS | Parsed locally |
| Postman cloud organization follow-up | PASS | Existing collection updated in place to 239 requests and 10 top-level folders; no duplicate collection or saved tokens |
| Frontend Postman handover folder | PASS | 15 requests, 15 test scripts, 21 assertions, zero final failures |
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

## What the evidence establishes

It establishes local regression behavior, guarded MariaDB recovery, a provider-safe smoke, exact-origin/security/error hardening, operations-state checks, and the two specified same-host synthetic pilot profiles. It does not establish production MySQL compatibility, hosted capacity, provider readiness, business-policy approval, deployment, staff training, or live-money safety.

Evidence: [automated tests](evidence/B12/automated-tests.txt), [database recovery](evidence/B12/database-recovery.txt), [performance](evidence/B12/performance.txt), [Postman/contract/security](evidence/B12/postman-contract-security.txt), [Postman cloud sync](evidence/B12/postman-cloud-sync.txt), [frontend Postman handover](evidence/B12/frontend-handover-postman.txt), and [full Postman regression](evidence/B12/full-postman-regression.txt).

