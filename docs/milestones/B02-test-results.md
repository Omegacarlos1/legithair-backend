# B02 test results

Date: 2026-10-12, with Gmail extension reverification on 2026-10-23 (Africa/Lagos)

| Check | Result | Counts |
|---|---|---|
| ESLint | PASS | 0 errors |
| TypeScript | PASS | 0 errors |
| Build | PASS | exit 0 |
| Unit | PASS | 5 passed, 0 failed, 0 skipped |
| Supertest API | PASS | 4 passed, 0 failed, 0 skipped |
| MariaDB integration | PASS | 13 passed, 0 failed, 0 skipped |
| Postman JSON parse | PASS | collection and environment parsed |
| Gmail SMTP authentication | NOT RUN | blocked only by absent local Gmail address/App Password |
| Gmail inbox delivery | NOT RUN | no live credential or recipient used |
| Development migration | PASS | B02 applied to `legit_hair_app` |
| Synthetic fixture seed | PASS | 2 users |
| Hosted CI | NOT RUN | Workflow updated implicitly through existing command matrix; no remote run yet |
| Production MySQL | NOT RUN | MariaDB-only results do not prove MySQL compatibility |

One initial integration run failed because the XAMPP MariaDB version rejected the `SKIP LOCKED` query syntax. The worker was changed to a short compatible `FOR UPDATE` claim transaction and the complete suite then passed. Evidence is in `evidence/B02/`.

For the 2026-10-23 run, the normal Mocha `tsx/cjs` wrapper failed before test discovery on the Codex Windows host because Node's `uv_os_get_passwd` returned `ENOMEM`. This was an execution-host issue, not an assertion failure. The same unit, API, and integration suites were executed with an in-process `os.userInfo` host shim: 22 passed, 0 failed, 0 skipped. The integration suite used the disposable `legit_hair_app_test` MariaDB schema and explicitly forced `EMAIL_PROVIDER=fake`; no provider network call occurred. See `evidence/B02/gmail-email-extension.txt`.
