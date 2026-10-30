# B11 test results

Date: 2026-10-30  
Status: READY_FOR_REVIEW

## Final results

| Check | Result | Evidence |
|---|---:|---|
| ESLint | PASS | Exit 0 |
| TypeScript type check | PASS | Exit 0 |
| Production build | PASS | Exit 0 |
| Unit tests | PASS | 21 passed, 0 failed, 0 skipped |
| Supertest API tests | PASS | 25 passed, 0 failed, 0 skipped |
| MariaDB integration tests | PASS | 64 passed, 0 failed, 0 skipped in 55 seconds |
| Socket.IO integration tests | PASS | 2 passed, 0 failed, 0 skipped in 5 seconds |
| Total automated checks | PASS | 112 passed, 0 failed, 0 skipped |
| Migration 014 on development MariaDB | PASS | Applied to `legit_hair_app` |
| Disposable rollback/up | PASS | Repeated against guarded `legit_hair_app_test` |
| Guarded fixture seed | PASS | 6 users, including support; 2 synthetic sellers; 2 products |
| Postman JSON and OpenAPI YAML parse | PASS | Parsed locally |
| Dependency audit | PASS | 0 known vulnerabilities reported |
| Owner Postman run | PENDING | Not claimed |
| Production MySQL | NOT RUN | MariaDB is not compatibility proof |
| Production email/provider checks | NOT RUN | No real email or provider call authorised |

## B11 behavior established

- Unauthenticated sockets are rejected and inaccessible customer threads return 404.
- Customers and support staff can join only authorized rooms; socket messages require prior room membership and current authentication.
- Message acknowledgement follows database commit. Sequential and concurrent retries with the same sender/client UUID persist one message; changed reuse conflicts.
- Disconnected clients retrieve messages after their last bigint offset, and stale outbox leases are reclaimed and published.
- Email provider failures retain one durable logical job and delivery, add numbered attempts and recover abandoned worker leases.
- Marketing defaults to not opted in. Campaign selection excludes suppressed recipients, and a recipient suppressed after queueing is not passed to the provider.
- Unsubscribe GET/POST is opaque-token based and idempotent. Complaint/manual suppression survives customer opt-out and later opt-in.
- B11 HTTP routes reject unauthenticated users and keep campaign/suppression operations admin-only.

## Execution notes

The ordinary `npm test`, `npm run test:integration` and direct `tsx`-based wrappers encounter this Windows execution host's existing `uv_os_get_passwd`/`ENOMEM` error before discovering tests. The established process-local `os.userInfo` shim executed the unchanged Mocha globs and produced the passing results above.

The first final integration run was affected by an already-running local API connected to the disposable test schema and produced one 40-second timeout. After stopping that local process, the affected payment file passed 7/7 and the full suite passed 64/64. A Socket.IO rerun then revealed a test that listened to the first valid queued event instead of the intended client ID; the assertion was made event-ID aware and the final socket suite passed 2/2. These were environment/test-harness issues, not hidden application assertions.

See [automated tests](evidence/B11/automated-tests.txt), [database and fixtures](evidence/B11/local-database-and-fixtures.txt), [Postman contract](evidence/B11/postman-contract.txt), and [dependency/provider checks](evidence/B11/dependency-and-provider-checks.txt).
