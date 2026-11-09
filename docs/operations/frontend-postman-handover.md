# Frontend Postman handover

## Runnable handover set

Use the existing Postman collection and environment:

- collection: `legit-hair`
- folder: `frontend-handover`
- environment: `Legit Hair Local`
- target: a backend using the disposable `legit_hair_app_test` schema and synthetic fixtures

The folder contains 30 provider-safe requests grouped under `health-and-security`, `customer`, `m03-baskets`, `m04-checkout`, `public-catalogue-and-delivery`, `seller`, `admin`, `finance`, and `support`. Every request has assertions. Login requests capture access tokens into runtime-only collection variables so the following role-protected request can run; no token value is committed or saved in Postman. The nine-request M03 workflow creates, reads, and removes guest and customer lines. The six-request M04 workflow lists, updates, and selects a seeded owned address, then submits an explicit pickup quote and removes its temporary basket line. Both workflows finish with the customer basket empty; the immutable synthetic quote remains in the disposable test schema until its normal cleanup/reset.

## Synthetic logins

These accounts are test fixtures only. Never reuse the password or accounts in staging or production.

| Role | Email | Password |
|---|---|---|
| Customer | `customer.fixture@example.test` | `FixturePass123!` |
| Seller | `seller.fixture@example.test` | `FixturePass123!` |
| Administrator | `admin.fixture@example.test` | `FixturePass123!` |
| Finance | `finance.fixture@example.test` | `FixturePass123!` |
| Support | `support.fixture@example.test` | `FixturePass123!` |

## Verification procedure

1. Backend owner: point configuration only to a database whose name ends in `_test`, migrate it, and run `npm run seed:test`.
2. Start the backend locally with `npm run dev`; confirm `http://127.0.0.1:3000/ready` returns database availability.
3. In Postman, select `Legit Hair Local`, open `legit-hair`, and run the complete `frontend-handover` folder from top to bottom.
4. Accept the run only when it reports 30 requests, 30 test scripts, 47 assertions, and zero failures.
5. Clear runtime variables after testing if Postman retained any local current value. Never share or commit access/refresh tokens.

CLI equivalent:

```text
postman collection run postman/Legit_Hair_Backend.postman_collection.json -e postman/Local.postman_environment.json -i frontend-handover --no-report-events --timeout-request 5000
```

## Verified local result on 2026-11-09

| Group | Request | Expected and observed result | Assertions |
|---|---|---:|---|
| Health/security | Health and security headers | 200 | health; security headers |
| Health/security | Database readiness | 200 | ready; database available |
| Health/security | Disallowed browser origin | 403 | rejected origin; safe error code |
| Customer | Login customer fixture | 200 | customer login |
| Customer | Read current customer | 200 | profile; customer role |
| M03 baskets | Create guest basket | 201 | opaque credential returned |
| M03 baskets | Set then read guest line | 201, 200 | absolute quantity; guest ownership; server expiry |
| M03 baskets | Remove then re-read guest line | 204, 200 | no response body; empty basket |
| M03 baskets | Set then read customer line | 201, 200 | absolute quantity; customer ownership; no expiry |
| M03 baskets | Remove then re-read customer line | 204, 200 | no response body; empty basket |
| M04 checkout | List saved addresses | 200 | seeded owned address is selectable |
| M04 checkout | Update saved address | 200 | owned address returned |
| M04 checkout | Select default address | 200 | selected address is marked default |
| M04 checkout | Set pickup basket item | 201 | item available for quoting |
| M04 checkout | Create pickup quote | 201 | pickup method and location snapshot returned |
| M04 checkout | Remove pickup basket item | 204 | temporary customer line removed |
| Public | Browse published catalogue | 200 | status; success envelope |
| Public | Read delivery options | 200 | delivery options |
| Seller | Login seller fixture | 200 | seller login |
| Seller | Read seller catalogue | 200 | seller catalogue |
| Admin | Login admin fixture | 200 | admin login |
| Admin | Read moderation queue | 200 | moderation queue |
| Finance | Login finance fixture | 200 | finance login |
| Finance | Read sales reconciliation report | 200 | status; sales report identity |
| Support | Login support fixture | 200 | support login |
| Support | Read support queue | 200 | support queue |

Final result: 30/30 requests and 47/47 assertions passed in 3.3 seconds; average response time was 24 ms (minimum 5 ms, maximum 90 ms). This proves the local synthetic handover flow only. It does not prove production MySQL compatibility, hosted capacity, provider readiness, frontend rendering, or live-money safety.

The original 15-request run is preserved in `docs/milestones/evidence/B12/frontend-handover-postman.txt`; the M03 extension is recorded in `docs/milestones/evidence/B12/m03-basket-handover.txt`, and the M04 address/pickup extension plus final 30-request run are recorded in `docs/milestones/evidence/B12/m04-address-pickup-handover.txt`.

## Complete backend regression

For backend or frontend integration handover, use `full-regression` after the disposable test database is migrated and seeded. This folder runs 110 requests in dependency order, including fixture logins before protected requests and creation steps before reads, fulfilment, refunds, payouts, reviews, reports and support actions. It uses only synthetic accounts and a local Paystack simulation.

Set `productImagePath` to an absolute path for a small valid PNG. Start the local Paystack simulation in a separate terminal:

```text
postman simulation run postman/simulations/paystack-local/paystack-local.sim.yaml --port 4010 --no-history --output ndjson
```

Then run:

```text
postman collection run postman/Legit_Hair_Backend.postman_collection.json -e postman/Local.postman_environment.json -i full-regression --env-var productImagePath=<absolute-synthetic-png-path> --no-report-events --timeout-request 10000
```

The verified clean result on 2026-11-02 was 110/110 requests and 214/214 assertions passed. Then run the captured fake-email token check against only `legit_hair_app_test`:

```text
$env:NODE_ENV='test'; $env:DATABASE_NAME='legit_hair_app_test'; npm run postman:verify-email
```

That additional request passed 2/2 assertions. The remaining request under `manual-regression` verifies `/ready` returns 503 while MariaDB is deliberately stopped. It was not run because stopping the shared local database is disruptive; do not label it passed until it is executed during an approved outage test. See [full Postman evidence](../milestones/evidence/B12/full-postman-regression.txt).
