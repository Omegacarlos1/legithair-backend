# B01 test results

Date: 2026-10-11 (Africa/Lagos)

| Check | Result | Count/evidence |
|---|---|---|
| ESLint | PASS | 0 errors; `evidence/B01/lint.txt` |
| TypeScript | PASS | 0 errors; `evidence/B01/typecheck-and-build.txt` |
| Production build | PASS | exit 0; `evidence/B01/typecheck-and-build.txt` |
| Unit tests | PASS | 2 passed, 0 failed, 0 skipped |
| Supertest API tests | PASS | 4 passed, 0 failed, 0 skipped |
| MariaDB integration | PASS | 1 passed, 0 failed, 0 skipped |
| Migration rollback/reapply | PASS | both commands exit 0 |
| Guarded seed | PASS | safety guard accepted isolated test configuration |
| Missing-config boot | PASS | expected exit 1; no secret values output |
| Production MySQL compatibility | NOT RUN | MariaDB evidence does not prove MySQL compatibility |
| Hosted CI | NOT RUN | Workflow authored locally; no remote run was triggered |

The test schema and user were created locally as `legit_hair_test`; no domain fixture rows exist in B01. Database-unavailable behavior is exercised using a rejecting database adapter and returns HTTP 503 with a generic public error. Full captured summaries are under `docs/milestones/evidence/B01/`.
