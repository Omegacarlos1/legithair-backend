# Backend handover

## Delivered repository assets

- TypeScript/Express API and Socket.IO server, durable workers, migrations 001-014, guarded synthetic seed, and pinned dependency lockfile.
- Versioned OpenAPI and focused API documentation under `docs/api/`.
- Maintained Postman collection/environment plus isolated B12 performance collections.
- Architecture/policy records under `docs/decisions/` and milestone evidence under `docs/milestones/`.
- Release, monitoring, backup/restore, and incident guidance in `docs/operations/`.

## Staff operating map

- Product owner: scope, policy, release acceptance, domain/hosting/provider ownership, and live authorization.
- Backend/deployment owner: reviewed releases, migrations, configuration, health, performance, logs, and incident coordination.
- Database owner: MySQL compatibility, access, backups, restore rehearsals, capacity, and recovery.
- Finance role: commission/refund/earnings/payout review and reconciliation; support/admin roles must not substitute for finance.
- Support role: customer support threads and assigned operational communication, without financial-report or payout authority.
- Security/account owner: MFA, invitations, credential rotation, DNS/certificate recovery, and access reviews.

Named people and escalation contacts remain an owner decision and must be recorded outside the repository without secrets.

## Routine checklist

- Review `/health`, `/ready`, error rate/latency, database capacity, certificate expiry, backup status, and `npm run ops:check`.
- Work reconciliation queues by original durable references. Do not retry uncertain provider creates blindly.
- Review least-privilege access, dormant staff accounts, provider/DNS/hosting invitations, dependency findings, and secret rotation on an agreed schedule.
- Restore a recent backup into an isolated database at least quarterly and after material migration/hosting changes.
- Retain application, audit, support, marketing, identity-reference, and finance data only under an owner/legal-approved schedule. No retention period is approved by this codebase.

## Training and acceptance

Two remote staff training sessions are proposed by the PRD and remain to be scheduled:

1. release/health/worker/backup/incident operations for deployment and database staff;
2. seller approval, fulfilment, returns/refunds, reconciliation, reporting, support, and marketing controls for admin/finance/support staff.

Record attendees, environment, scenarios completed, questions, actions, and owner sign-off. Training does not authorize live money movement.

## Release-blocking handover gates

- Owner-approved seller identity/consent/approval workflow and real Dojah integration evidence.
- Owner-approved commission, reservation, COD, return, delivery-refund, earnings-hold, payout, recovery, retention, staff-role, support-hours, and delivery/pickup policies.
- Production MySQL version selected and full migration/integration/lock/recovery suite passed there.
- Client-owned hosting, domain, DNS, TLS, monitoring, backup, object storage, email, Paystack, and Dojah accounts with named owners and MFA.
- Production object storage, email sender/DNS, bounce/complaint ingestion, public webhooks, provider test-mode/dashboard evidence, and provider reconciliation playbooks.
- Multi-instance Socket.IO design if more than one API process is required.
- Production-like load result on the selected capacity, complete staging UAT, no unresolved critical/high defects, explicit deployment approval, and separate live-money authorization.

