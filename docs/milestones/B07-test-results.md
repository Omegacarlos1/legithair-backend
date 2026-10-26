# B07 test results

Date: 2026-10-26 (Africa/Lagos)

Verification outcome: all required local checks passed. Milestone tracker state: READY_FOR_REVIEW. No owner acceptance is claimed.

## Executed checks

| Check | Actual result |
|---|---|
| `npm run lint` | PASS, 0 errors |
| `npm run typecheck` | PASS, 0 errors |
| `npm run build` | PASS |
| Unit suite through established host shim | PASS, 13 passing, 0 failing, 0 skipped |
| Supertest API suite through established host shim | PASS, 15 passing, 0 failing, 0 skipped |
| Full MariaDB integration suite through established host shim | PASS, 44 passing, 0 failing, 0 skipped |
| Development migration up | PASS on `legit_hair_app` |
| Disposable migration rollback/up | PASS repeatedly on `legit_hair_app_test` |
| Guarded seed | PASS, four users/two synthetic sellers/two checkout products |
| Seed refusal outside `_test` | PASS |
| Postman collection/environment JSON parse | PASS |
| OpenAPI YAML parse | PASS |
| Paystack test-mode provider acceptance | SKIPPED, credentials not configured |
| Production MySQL | SKIPPED, unavailable; local server is MariaDB 10.4.32 |

Totals across executed Mocha assertions: 72 passing, 0 failing, 0 skipped. Static/build checks also passed.

## B07 acceptance evidence exercised

- Mock success validated amount, currency, reference, order association and atomic paid settlement.
- Wrong amount remained undelivered and created an auditable mismatch review case.
- Forged signature was rejected before any database query.
- Duplicate webhook and repeat verification created no duplicate financial or notification artifacts.
- Callback reference tampering was rejected before the fake provider was invoked.
- Synthetic provider timeout persisted one attempt and reused its reference.
- Injected ledger crash rolled back the complete webhook transaction; replay recovered once.
- Late payment after release did not consume or alter the replacement order's active reservation and stock.
- Registered-customer and guest credentials enforced payment and receipt ownership.

## Host-wrapper limitation

`npm run test:unit`, `npm run test:api`, and `npm run test:integration` invoke `tsx/cjs`, which cannot initialize directly on this Codex Windows host because `uv_os_get_passwd` returns ENOMEM. This happens before test discovery. The same source tests were executed with the repository's established process-local `os.userInfo` shim and `tsx/cjs`; those are the counts reported above. See `docs/milestones/evidence/B07/automated-tests.txt`.

## Evidence paths

- `docs/milestones/evidence/B07/automated-tests.txt`
- `docs/milestones/evidence/B07/local-database-and-fixtures.txt`
- `docs/milestones/evidence/B07/postman-contract.txt`
- `docs/milestones/evidence/B07/provider-acceptance.txt`
