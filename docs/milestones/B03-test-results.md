# B03 test results

Date: 2026-10-23 (Africa/Lagos)

| Check | Result | Counts |
|---|---|---|
| ESLint | PASS | 0 errors |
| TypeScript | PASS | 0 errors |
| Build | PASS | exit 0 |
| Unit and Supertest API | PASS | 11 passed, 0 failed, 0 skipped |
| MariaDB integration and migrations | PASS | 20 passed, 0 failed, 0 skipped |
| Development migration | PASS | migration 003 applied to `legit_hair_app` |
| Synthetic fixture seed | PASS | 2 users in `legit_hair_app_test` |
| Postman JSON parse | PASS | collection and environment parsed |
| Manual Postman exercise | OWNER-REPORTED COMPLETE | no exported run artifact supplied; reduced scope explicitly accepted |
| Dojah contract tests | NOT RUN | owner deferred provider/check choice |
| Dojah test-mode acceptance | NOT RUN | no selected workflow or credentials |
| Production MySQL | NOT RUN | MariaDB-only local evidence |

The first full integration attempt produced 13 passing B01-B02/migration checks and then timed out in the B03 `before` hook because three Argon2-backed account fixtures exceeded Mocha's default two-second timeout. No seller assertion failed. The suite now declares a 15-second integration timeout; the complete rerun passed all 20 checks.

The Codex Windows host continues to fail in `tsx` startup with `uv_os_get_passwd`/`ENOMEM`. Equivalent Mocha and migration invocations used the previously documented process-local host shim. Application behavior was not changed to conceal the host problem.

The owner explicitly accepted the reduced B03 scope on 2026-10-23. This acceptance does not convert the NOT RUN provider or production checks into passing evidence, and real seller approval remains disabled until identity verification is implemented.
