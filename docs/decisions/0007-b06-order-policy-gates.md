# ADR 0007: B06 order policy gates

Date: 2026-10-25

Status: provisional implementation boundary; commercial decisions remain open

## Context

B06 needs immutable commission snapshots, expiring inventory reservations, and controlled COD. The owner has not yet approved the commission basis/rate, reservation lifetime, or COD eligibility and reconciliation policy. Those values cannot be silently invented.

## Decision

The schema and order service support line-item commission snapshots, a configurable reservation duration, and COD as `awaiting_collection`. Order creation fails closed until an explicit reservation duration, commission basis, and commission rate are configured. COD is disabled by default and requires an explicit enable flag. Guest tracking tokens are HMAC-derived from an environment secret and only their SHA-256 hashes are stored.

Local automated tests use synthetic policy values (`line_item_gross`, 1000 basis points, one-second reservations, COD enabled) only to exercise behavior. These are not approved production policy and must not be copied into a live environment.

## Consequences

Independent B06 locking, rollback, idempotency, access-control, and expiry work can be verified. Production order acceptance remains gated on owner approval and explicit configuration. If the approved commission basis is not line-item gross, a reviewed migration and implementation change are required before production use.
