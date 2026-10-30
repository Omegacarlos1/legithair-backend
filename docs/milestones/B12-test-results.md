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

## What the evidence establishes

It establishes local regression behavior, guarded MariaDB recovery, a provider-safe smoke, exact-origin/security/error hardening, operations-state checks, and the two specified same-host synthetic pilot profiles. It does not establish production MySQL compatibility, hosted capacity, provider readiness, business-policy approval, deployment, staff training, or live-money safety.

Evidence: [automated tests](evidence/B12/automated-tests.txt), [database recovery](evidence/B12/database-recovery.txt), [performance](evidence/B12/performance.txt), and [Postman/contract/security](evidence/B12/postman-contract-security.txt).

