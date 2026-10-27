DELETE FROM payment_ledger_entries WHERE entry_type = 'refund_processed';

ALTER TABLE payment_ledger_entries
  DROP FOREIGN KEY fk_payment_ledger_refund,
  DROP INDEX uq_payment_ledger_logical_key,
  DROP COLUMN logical_key,
  DROP COLUMN refund_id,
  MODIFY COLUMN entry_type ENUM('payment_received', 'late_payment_received') NOT NULL,
  DROP INDEX idx_payment_ledger_payment,
  ADD UNIQUE KEY uq_payment_ledger_logical (payment_id, entry_type);

DROP TABLE IF EXISTS seller_refund_adjustments;
DROP TABLE IF EXISTS refunds;
DROP TABLE IF EXISTS return_request_items;
DROP TABLE IF EXISTS return_requests;
DROP TABLE IF EXISTS cod_collections;
DROP TABLE IF EXISTS fulfilment_events;

UPDATE order_status_events SET actor_type = 'admin' WHERE actor_type = 'seller';
ALTER TABLE order_status_events
  MODIFY COLUMN actor_type ENUM('system', 'customer', 'admin', 'provider') NOT NULL;

UPDATE seller_suborders SET status = 'processing' WHERE status = 'ready_for_pickup';
UPDATE seller_suborders SET status = 'delivered' WHERE status = 'picked_up';
ALTER TABLE seller_suborders
  DROP COLUMN stock_restored_at,
  DROP COLUMN fulfilled_at,
  MODIFY COLUMN status ENUM('pending', 'processing', 'shipped', 'delivered', 'cancelled', 'returned', 'refunded') NOT NULL DEFAULT 'pending';
