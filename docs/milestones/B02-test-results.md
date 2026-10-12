# B02 test results

Date: 2026-10-12 (Africa/Lagos)

| Check | Result | Counts |
|---|---|---|
| ESLint | PASS | 0 errors |
| TypeScript | PASS | 0 errors |
| Build | PASS | exit 0 |
| Unit | PASS | 3 passed, 0 failed, 0 skipped |
| Supertest API | PASS | 4 passed, 0 failed, 0 skipped |
| MariaDB integration | PASS | 12 passed, 0 failed, 0 skipped |
| Development migration | PASS | B02 applied to `legit_hair_app` |
| Synthetic fixture seed | PASS | 2 users |
| Hosted CI | NOT RUN | Workflow updated implicitly through existing command matrix; no remote run yet |
| Production MySQL | NOT RUN | MariaDB-only results do not prove MySQL compatibility |

One initial integration run failed because the XAMPP MariaDB version rejected the `SKIP LOCKED` query syntax. The worker was changed to a short compatible `FOR UPDATE` claim transaction and the complete suite then passed. Evidence is in `evidence/B02/`.
