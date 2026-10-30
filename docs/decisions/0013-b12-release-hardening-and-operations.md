# ADR 0013: B12 release hardening and operations boundary

Date: 2026-10-30  
Status: Proposed for owner/deployment review

## Context

B12 must make the accepted backend operable without treating local MariaDB, fake providers, or a passing test suite as production approval. Hosting region, domain ownership, production MySQL, sender/provider accounts, business policies, retention, and live money movement remain unresolved or separately controlled.

## Decision

- The pilot topology is one Node.js API/Socket.IO process behind one controlled HTTPS reverse proxy, plus a separate email worker. Horizontal Socket.IO deployment is blocked until a shared adapter and coordinated outbox ownership are verified.
- TLS terminates at the controlled proxy. The application sets security headers, accepts only exact configured browser origins, and trusts only the configured number of proxy hops. Production startup rejects an empty database password, empty origin allowlist, fake email delivery, and insecure configured callback/unsubscribe URLs.
- Production targets a separately managed MySQL deployment. MariaDB evidence is local-only; an empty-schema migration, rollback/forward recovery, integration suite, collation, timezone, and transaction-lock verification must pass on the chosen MySQL version before release.
- Queue and recovery state is checked through `npm run ops:check`. A non-zero exit is an alert, not an automatic destructive repair. Existing idempotent commands perform reservation release and payment/refund/payout reconciliation.
- Daily encrypted database backups retained for at least seven days, an up-to-24-hour recovery point, and restoration within eight working hours remain proposed PRD targets pending owner/hosting approval. Restoration must be rehearsed into an isolated database.
- Live deployment, DNS changes, provider credentials, live payments, refunds, and transfers require explicit owner authorization. B12 local verification grants none of those permissions.

## Consequences

The repository can be staged and reviewed with clear fail-closed controls and recovery commands. It cannot be labelled production-ready until the open policy, provider, MySQL, infrastructure, retention, and ownership gates in the handover are closed.

