# B04 test results

Date: 2026-10-24 (Africa/Lagos)

| Check | Result | Counts or evidence |
|---|---|---|
| ESLint | PASS | 0 errors |
| TypeScript | PASS | 0 errors |
| Build | PASS | exit 0 |
| Unit tests | PASS | 5 passed, 0 failed, 0 skipped |
| Supertest API tests | PASS | 8 passed, 0 failed, 0 skipped |
| MariaDB integration and migrations | PASS | 27 passed, 0 failed, 0 skipped; 7 B04 scenarios |
| Development migration | PASS | migration 004 applied to `legit_hair_app` |
| Synthetic fixture seed | PASS via host shim | 4 users and 2 test-only approved sellers in `legit_hair_app_test` |
| Non-test seed guard | PASS | rejected `NODE_ENV=development` / `legit_hair_app` |
| OpenAPI and Postman parse | PASS | OpenAPI YAML plus both Postman JSON exports |
| Manual Postman run | NOT RUN | collection is importable; owner run artifact still required |
| Production MySQL | NOT RUN | local server is MariaDB 10.4.32 |
| Production image storage | NOT RUN | B04 uses a private local filesystem adapter |

The B04 database scenarios cover upload type/signature/size validation, hidden drafts and unpublished products, seller ownership, suspension, concurrent stock invariants, idempotent replay, search, price/brand/colour/size filters, deterministic sorting and pagination, related products, and the rule that admins cannot publish for an ineligible seller.

The standard `tsx` executable is blocked on this Codex Windows host by `uv_os_get_passwd` returning `ENOMEM`. Equivalent Mocha, migration, and seed invocations used the previously documented process-local `os.userInfo` shim. `npm run seed:test` therefore reports a host-startup failure here, while the exported seeder completed and its refusal guard was independently checked. No application failure was hidden.

Raw command summaries and outputs are saved in [automated-tests.txt](evidence/B04/automated-tests.txt) and [local-database-and-fixtures.txt](evidence/B04/local-database-and-fixtures.txt). Local MariaDB success must not be described as MySQL compatibility.
