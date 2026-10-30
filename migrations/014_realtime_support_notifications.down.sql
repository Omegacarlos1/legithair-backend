DROP TABLE IF EXISTS email_delivery_attempts;
DROP TABLE IF EXISTS email_deliveries;
DROP TABLE IF EXISTS marketing_unsubscribe_tokens;
DROP TABLE IF EXISTS marketing_campaigns;
DROP TABLE IF EXISTS email_suppressions;
DROP TABLE IF EXISTS marketing_preferences;
DROP TABLE IF EXISTS support_messages;
DROP TABLE IF EXISTS support_threads;

ALTER TABLE outbox_events
  DROP INDEX idx_outbox_claim,
  DROP COLUMN locked_by,
  DROP COLUMN locked_at,
  DROP COLUMN available_at;

ALTER TABLE durable_jobs
  DROP COLUMN completed_at,
  DROP COLUMN max_attempts;
