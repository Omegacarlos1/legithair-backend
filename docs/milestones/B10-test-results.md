# B10 test results

Date: 2026-10-29

| Check | Result |
|---|---|
| ESLint | PASS |
| TypeScript | PASS |
| Build | PASS |
| Unit suite through host shim | PASS: 20 |
| Supertest API suite through host shim | PASS: 23 |
| MariaDB integration suite through host shim | PASS: 61 |
| B10-focused MariaDB rerun | PASS: 5 |
| Postman collection/environment JSON parse | PASS |
| OpenAPI YAML parse | PASS |
| Development migration through 013 | PASS |
| Guarded synthetic seed including support | PASS |
| Third-party provider checks | NOT APPLICABLE: B10 has no provider integration |
| Production MySQL | NOT RUN |
| Owner Postman execution | PARTIAL: login/review requests exercised; full request set not separately reported |

Total automated assertions: 104 passing, 0 failing, 0 skipped. The five B10 integration scenarios establish purchase eligibility and idempotency, moderation visibility, one-time COD popularity, category ordering, banner access, finance/support separation, accounting reconciliation and CSV formula neutralisation.

The normal npm Mocha wrappers remain blocked before discovery by this Windows host's `uv_os_get_passwd`/`ENOMEM` error. The established process-local shim ran the same TypeScript test files. This is a host startup limitation, not an application assertion failure.

One interrupted final-suite process left only the disposable `legit_hair_app_test` schema partially rolled back. The exact `_test` schema was validated, dropped, recreated and migrated; the B10-focused suite then passed 5/5 and the full integration suite passed 61/61. No development or production schema was reset, and no failed assertion was hidden.

The owner manually exercised login and review requests and explicitly accepted B10 on 2026-10-30. A complete item-by-item Postman run was not separately reported. Local database evidence is MariaDB 10.4.32 and does not establish production MySQL compatibility.
