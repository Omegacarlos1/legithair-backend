# B05 test results

Date: 2026-10-25 (Africa/Lagos)

| Check | Result | Counts or evidence |
|---|---|---|
| ESLint | PASS | 0 errors |
| TypeScript | PASS | 0 errors |
| Build | PASS | exit 0 |
| Unit tests | PASS via host shim | 7 passed, 0 failed, 0 skipped |
| Supertest API tests | PASS via host shim | 11 passed, 0 failed, 0 skipped |
| MariaDB integration and migrations | PASS via host shim | 33 passed, 0 failed, 0 skipped; 6 B05 scenarios |
| Development migration | PASS via host shim | migrations 005 and 006 applied to `legit_hair_app` |
| Guarded synthetic fixture seed | PASS via host shim | 4 users, 2 approved sellers, 2 B05 products, 3 zones and 1 synthetic pickup |
| Non-test seed guard | PASS | rejected `NODE_ENV=development` / `legit_hair_app` |
| OpenAPI and Postman parse | PASS | OpenAPI YAML plus both Postman JSON exports |
| Manual Postman run | OWNER-REPORTED PASS | owner reported all B05 manual samples passed on 2026-10-25; no exported run artifact supplied |
| Production MySQL | NOT RUN | local server is MariaDB 10.4.32 |
| Production pickup/courier | NOT RUN | real street address and written courier quotation remain open |

The B05 database scenarios prove guest isolation, absolute quantities, unavailable-product rejection, admin zone/pickup management, unsupported-address rejection, concurrent merge replay without duplicated quantities, merged-quantity limits, customer isolation, deterministic per-seller delivery totals, integer USD rounding, address and quote ownership, idempotent quote replay/conflict, stale-price rejection, explicit price refresh, stock-loss rejection, pickup quoting and expiry.

The standard `npm run test:unit`, `npm run test:api` and `npm run test:integration` wrappers remain blocked before test discovery because this Windows execution host returns `uv_os_get_passwd`/`ENOMEM` while `tsx` starts. The recorded process-local shim changes only `os.userInfo` for the test process and runs the same repository test files. No application assertion or failing test was hidden.

Raw commands and output summaries are saved in [automated-tests.txt](evidence/B05/automated-tests.txt) and [local-database-and-fixtures.txt](evidence/B05/local-database-and-fixtures.txt). MariaDB results must not be described as production MySQL compatibility.

The owner-reported manual result is recorded in [owner-postman-report.txt](evidence/B05/owner-postman-report.txt). It closes the manual exercise gate but does not constitute explicit B05 milestone acceptance.
