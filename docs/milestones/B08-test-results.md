# B08 test results

Date: 2026-10-27 (Africa/Lagos)

Verification outcome: all required independent local checks passed. Milestone tracker state: ACCEPTED by explicit owner instruction on 2026-10-27. Acceptance does not convert skipped provider, Postman, policy or production checks into passes.

| Check | Actual result |
|---|---|
| `npm run lint` | PASS, 0 errors |
| `npm run typecheck` | PASS, 0 errors |
| `npm run build` | PASS |
| Unit suite through documented host shim | PASS, 16 passing, 0 failing, 0 skipped |
| Supertest API suite through documented host shim | PASS, 18 passing, 0 failing, 0 skipped |
| Full MariaDB integration suite through documented host shim | PASS, 51 passing, 0 failing, 0 skipped |
| Development migration up | PASS on `legit_hair_app` |
| Disposable migration rollback/up | PASS repeatedly on `legit_hair_app_test` |
| Guarded seed | PASS, four users/two synthetic sellers/two checkout products |
| Seed refusal outside `_test` | PASS |
| Postman collection/environment JSON parse | PASS |
| OpenAPI YAML parse | PASS |
| Paystack refund test-mode acceptance | SKIPPED, credentials and completed test transaction unavailable |
| Owner Postman execution | SKIPPED, no owner run reported |
| Production MySQL | SKIPPED, unavailable; local server is MariaDB 10.4.32 |

Totals across executed Mocha assertions: 85 passing, 0 failing, 0 skipped. Seven integration scenarios are B08-specific.

The ordinary `npm test` and `npm run test:integration` wrappers remain blocked before discovery because this Windows host returns `uv_os_get_passwd`/`ENOMEM` while `tsx` starts. The recorded process-local shim changes only `os.userInfo` for the test process and runs the same repository files. Exact evidence is in `docs/milestones/evidence/B08/automated-tests.txt`.

No live key, provider refund, real COD cash, production MySQL result, owner Postman result, or owner acceptance is claimed.
