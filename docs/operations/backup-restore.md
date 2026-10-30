# Database backup and restore procedure

The PRD proposes daily backups retained for at least seven days, recovery of at most 24 hours of data, and restoration within eight working hours. These targets require owner and hosting approval; the local B12 rehearsal measures correctness, not a hosted recovery SLA.

## Backup requirements

- Use the selected MySQL service's encrypted automated backups plus an independently restorable off-host copy.
- Encrypt in transit and at rest. Restrict backup/restore identities, enable MFA where supported, and test access without sharing credentials.
- Capture schema, data, triggers, routines/events if used, server version, UTC timestamp, application commit, migration list, size, and SHA-256 checksum.
- Monitor completion and retention. A backup job exit code alone is insufficient: verify object size/checksum and perform scheduled restores.
- Never restore into production as the first validation step.

## Repository rehearsal

`npm run backup:verify` is guarded to a source database ending `_test`. It:

1. creates a single-transaction logical dump without table locks;
2. recreates only the fixed isolated target `legit_hair_b12_restore_test`;
3. restores and compares representative table counts;
4. exercises the complete down/up migration cycle on the restored copy;
5. restores the original dump again and rechecks counts;
6. prints only database names, dump size/checksum, representative counts, and verdicts; and
7. removes the temporary dump.

The source/application identity needs only dump/read access. A separate `BACKUP_RESTORE_DATABASE_USER` (and, when non-empty, `BACKUP_RESTORE_DATABASE_PASSWORD`) may create/drop the isolated restore database and run the migration cycle. Never grant those rights to the production runtime user. `MYSQL_DUMP_BIN` and `MYSQL_CLIENT_BIN` may point to the chosen MySQL client binaries. The default paths target local XAMPP tooling and do not establish MySQL compatibility.

## Hosted restore rehearsal

1. Open an approved maintenance/rehearsal record with backup identifier, restore target, responsible engineer, start time, and success criteria.
2. Provision a new isolated private database with the same engine version, settings, character set/collation, and timezone as production.
3. Verify the backup checksum, scan storage/audit logs for unexpected access, and restore with the dedicated restore identity.
4. Run migrations to the application commit when restoring an older backup. Prefer forward recovery; do not run destructive down migrations on the only copy.
5. Validate migration history, row counts and invariants for users, orders, reservations, payments/ledger, refunds, earnings/payouts, support messages, and email delivery records.
6. Start a staging API against the restored database with outbound providers disabled. Run `/ready`, the full automated suite where safe, and the maintained smoke workflow.
7. Record elapsed restore time, backup age, data exceptions, and any provider events that would need reconciliation after the recovery point.
8. Destroy the isolated restored database through the hosting provider's approved process after evidence retention requirements are satisfied.

## Production recovery decision

Declare an incident, stop or restrict writes, preserve evidence, and identify the last consistent point before recovery. Finance must review payments, refunds, COD collections, seller earnings, and payouts that may exist at providers after the restored database point. Resume traffic only after database, application, security, finance, and owner sign-off. Never infer provider state from browser callbacks or replay create operations without idempotency/reconciliation review.

