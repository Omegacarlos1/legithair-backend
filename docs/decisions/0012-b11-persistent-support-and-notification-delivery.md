# ADR 0012: Persistent support and notification delivery

Date: 2026-10-30

## Decision

Use one Socket.IO server attached to the existing Node HTTP server, authenticated with the same short-lived opaque access tokens as HTTP. Customers own threads; support/admin staff may access the queue. Authorization is checked before a room join and again before each message. Socket IDs are never used as identity.

Support messages use database bigint offsets and client-generated UUIDs. The unique sender/client-ID key and request hash make retries idempotent and reject conflicting reuse. Message and outbox rows commit in one transaction. A leased outbox publisher emits the persistent record to the authorized thread room and records publication. A crash may cause a duplicate event, so clients deduplicate and recover missed history from the database after an offset.

Extend durable email jobs with retry limits, completion time and stale-lock recovery. Track one delivery record per job and an immutable row per attempt. Marketing is a separate category, is admin-created, and requires explicit customer opt-in, no active suppression and an opaque unsubscribe token. Consent and suppression are rechecked immediately before sending.

## Consequences

This design provides durable history and recovery without Redis or another broker for the current single-node backend. Horizontal Socket.IO scale will require a compatible shared adapter and coordinated outbox workers during B12 deployment design. Outbox emission is at least once, not exactly once. SMTP provider acceptance can be uncertain after a timeout, so delivery records distinguish logical-event deduplication from provider-level exactly-once delivery.

Migration 014 adds chat, consent, suppression, campaign, unsubscribe and email-delivery records and adds lease/retry columns to foundation tables. Rolling it down permanently deletes B11 history and audit evidence and removes the new delivery controls; production rollback requires export, worker shutdown and a reviewed recovery plan.
