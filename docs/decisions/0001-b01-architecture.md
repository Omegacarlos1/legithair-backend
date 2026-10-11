# ADR 0001: B01 application foundation

Status: accepted for local development, 2026-10-11

Use a modular monolith on Node.js 24 LTS, Express 5 and strict TypeScript. Configuration is validated before logger, database pool or listener creation. Pino emits structured logs, `pino-http` attaches request IDs, and public errors use a stable envelope without internal exception text.

The owner has selected XAMPP MariaDB for local development. The `mysql2` protocol driver and SQL migrations target the common MariaDB/MySQL surface, but MariaDB-only evidence must not be represented as production MySQL compatibility evidence. CI currently verifies MariaDB. A production-version MySQL gate must be added and passed before production acceptance if production remains MySQL.

The process liveness endpoint does not depend on the database. Readiness executes `SELECT 1` with a bounded application timeout. Durable job and transactional outbox tables are introduced as primitives only; no worker behavior belongs to B01.

Migration rollback scripts are explicit. DDL transaction semantics vary across MariaDB/MySQL, so a failed migration may require inspection and recovery rather than assuming the transaction reverted every statement.
