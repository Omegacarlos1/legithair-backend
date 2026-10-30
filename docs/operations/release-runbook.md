# Release and operations runbook

This runbook prepares staging and production deployment; it does not authorize deployment, DNS changes, provider calls, or money movement.

## Intended topology

1. A client-owned domain points to a controlled reverse proxy/load balancer.
2. The proxy terminates TLS, redirects HTTP to HTTPS, forwards WebSocket upgrades, adds a trusted forwarding chain, and sends API traffic to one Node.js process for the pilot.
3. The API connects over a private network and TLS where supported to the selected MySQL service. The database is not internet-public.
4. A separate process runs the durable email worker. Scheduled recovery commands use the same release artifact and least-privilege database identity.
5. Logs, health probes, alerts, backups, and provider dashboards are accessible only to assigned staff.

Do not add a second Socket.IO application instance until a shared Socket.IO adapter and single/leased outbox publication behavior have been tested. HTTP can later scale independently only after session-free routing and worker ownership are reviewed.

## DNS and HTTPS

- Keep domain registration and DNS in a client-owned account with MFA and at least two recovery contacts.
- Create a staging API hostname first. Use a short DNS TTL during the approved cutover window, then restore the normal TTL.
- Issue a trusted certificate for the exact API hostname and enable automated renewal. Test renewal and alert before expiry.
- Proxy `Upgrade` and `Connection` headers for `/socket.io/`; enforce modern TLS; redirect port 80 to 443; set an upstream body limit no lower than the application's 1 MiB JSON and configured image limit.
- Set `TRUST_PROXY_HOPS` to the exact controlled proxy count, normally `1` for one reverse proxy. Never copy this value without tracing the real path.
- Set `CORS_ALLOWED_ORIGINS` to exact HTTPS frontend origins. Wildcards and paths are rejected.
- Confirm `/health` returns 200 without checking dependencies and `/ready` returns 200 only when MySQL responds.

## Release preparation

1. Obtain explicit deployment approval and record the release commit, environment, change window, rollback owner, database owner, and incident contacts.
2. Build from the reviewed commit with the lockfile: `npm ci`, `npm run lint`, `npm run typecheck`, `npm test`, and `npm run build`.
3. Run the full integration and Socket.IO suites against an isolated instance of the selected production MySQL version. Local MariaDB results are insufficient.
4. Run `npm audit --audit-level=low`, review every finding, and record any accepted exception with owner and expiry.
5. Create and verify a pre-release backup. Confirm storage encryption, retention, restore credentials, and an off-host copy.
6. Provision a least-privilege runtime database user and a separate migration/restore identity. The runtime user must not create or drop databases.
7. Supply secrets through the hosting secret manager or protected environment, never the repository, image, logs, process arguments, or Postman exports.

## Required configuration review

- Core: `NODE_ENV=production`, host/port, log level, exact proxy hops and CORS origins.
- MySQL: private host, port, runtime user, strong password, database, bounded connection pool, and readiness timeout.
- Email: approved production provider/sender credentials, authenticated sender domain, unsubscribe public URL, and worker timing.
- Images: approved durable object storage adapter and limits. The current local filesystem adapter is not suitable for replaceable/multi-instance production hosts.
- Orders and finance: owner-approved reservation, commission, COD, return, refund, earnings-hold, and payout settings. Missing values intentionally keep dependent operations disabled.
- Paystack: server-only credential, official HTTPS base URL for live keys, HTTPS callback, verified public webhook route, and explicit live-money authorization.
- Guest tracking: unique high-entropy `ORDER_GUEST_TOKEN_SECRET` stored only in the secret manager.

Run a production-config parse before deployment without printing values. Do not paste secrets into tickets or evidence.

## Deployment sequence

1. Put the reviewed build artifact on staging and start with production-like, non-live provider credentials.
2. Run `npm run migrate` with the migration identity. Migrations contain DDL; assume implicit commits and take the backup before applying them.
3. Start the API, then verify `/health`, `/ready`, security headers, exact CORS behavior, Socket.IO connection/reconnect, and log/request-ID correlation.
4. Start the email worker with `npm run email:worker` under a supervisor with restart limits.
5. Run the maintained Postman smoke workflow against staging using synthetic accounts. Never run refund/payout requests against live provider accounts without explicit authorization.
6. Run `npm run ops:check`; investigate every non-zero result.
7. After owner acceptance and a separate cutover approval, update DNS and monitor error rate, p95 latency, database connections/locks, queue ages, WebSocket disconnects, and provider reconciliation.

## Scheduled operations

The scheduler must prevent overlapping runs and alert on non-zero exit:

- Every minute: `npm run orders:release-expired`.
- Every five minutes: `npm run ops:check`, `npm run payments:reconcile`, `npm run refunds:reconcile`, and `npm run payouts:reconcile` when the relevant provider/policy is authorized.
- At least daily after the approved hold policy: `npm run earnings:sync`.
- Continuously under a supervisor: `npm run email:worker`.
- Daily: encrypted database backup, off-host copy verification, and retention enforcement.

These are initial operational intervals, not business-policy approval. Tune them from measured queue age, provider limits, and incident response capacity.

## Alerts and first response

- Page/urgent: `/ready` unavailable, repeated process restarts, database saturation, suspected credential exposure, forged/invalid webhook surge, reconciliation uncertainty, or backup failure.
- Action during staffed hours: overdue email/outbox work, stale leases, expired active reservations, refund `needs_attention`, payout `initiation_uncertain`, elevated 4xx/5xx, certificate/backup expiry.
- Preserve request IDs and relevant audit/event IDs. Do not log or copy tokens, passwords, identity values, provider keys, raw webhook secrets, or full customer payloads.
- Freeze live money movement if payment/refund/payout state is uncertain. Reconcile original provider references; do not blindly retry external creates.

## Rollback and forward recovery

Application rollback is allowed only when the earlier code is compatible with the current schema. The SQL down migrations are destructive and are not a routine production rollback. Prefer a reviewed forward-fix migration. If data recovery is required, stop writes, preserve logs, restore the verified backup into an isolated database, reconcile provider events after the recovery point, and obtain owner approval before replacing production.

