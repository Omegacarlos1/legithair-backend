# B06 test results

Date: 2026-10-25 (Africa/Lagos). Status: READY_FOR_REVIEW; owner acceptance has not been given.

| Check | Result | Counts or evidence |
|---|---|---|
| ESLint | PASS | 0 errors |
| TypeScript | PASS | 0 errors |
| Build | PASS | exit 0 |
| Unit tests | PASS via host shim | 8 passed, 0 failed, 0 skipped |
| Supertest API tests | PASS via host shim | 13 passed, 0 failed, 0 skipped |
| MariaDB integration and migrations | PASS via host shim | 37 passed, 0 failed, 0 skipped; 4 B06 scenarios |
| Development migration | PASS via host shim | migration 007 applied to `legit_hair_app` |
| Guarded synthetic fixture seed | PASS via host shim | 4 users, 2 synthetic approved sellers, 2 B05/B06 checkout products |
| Non-test seed guard | PASS | rejected development database |
| Expiry worker smoke check | PASS via host shim | 0 due reservations; clean exit |
| OpenAPI and Postman parse | PASS | OpenAPI YAML and both Postman JSON exports |
| Manual Postman run | NOT RUN | collection is importable; owner execution remains open |
| Production MySQL | NOT RUN | local server is MariaDB 10.4.32 |
| Paystack/provider acceptance | NOT APPLICABLE TO B06 | no provider network call implemented or made |

The B06 database scenarios directly establish the required final-item race, idempotent replay, rollback without orphan suborders, one-time expiry release, guest credential protection and invalid-transition rejection. They also cover controlled synthetic COD and immutable commission/price snapshots.

The standard npm test wrappers remain blocked before discovery because this Windows execution host returns `uv_os_get_passwd`/`ENOMEM` while `tsx` starts. The recorded process-local shim changes only `os.userInfo` for the test process and runs the unchanged repository test files. No failing application assertion was hidden.

Raw command summaries are saved in [automated-tests.txt](evidence/B06/automated-tests.txt), [local-database-and-fixtures.txt](evidence/B06/local-database-and-fixtures.txt), and [postman-contract.txt](evidence/B06/postman-contract.txt). MariaDB results must not be described as production MySQL compatibility.
