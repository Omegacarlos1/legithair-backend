DROP TABLE IF EXISTS paid_receipts;
DROP TABLE IF EXISTS payment_review_cases;
DROP TABLE IF EXISTS payment_ledger_entries;
DROP TABLE IF EXISTS payment_webhook_events;
DROP TABLE IF EXISTS payments;
ALTER TABLE durable_jobs DROP INDEX uq_durable_jobs_deduplication, DROP COLUMN deduplication_key;
