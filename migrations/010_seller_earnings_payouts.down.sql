DROP TABLE IF EXISTS payout_webhook_events;
DROP TABLE IF EXISTS seller_ledger_entries;
DROP TABLE IF EXISTS payouts;
DROP TABLE IF EXISTS seller_payout_recipients;
DELETE FROM user_roles WHERE role = 'finance';
ALTER TABLE user_roles
  MODIFY COLUMN role ENUM('customer', 'seller', 'admin') NOT NULL;
