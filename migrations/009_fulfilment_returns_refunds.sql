ALTER TABLE seller_suborders
  MODIFY COLUMN status ENUM('pending', 'processing', 'ready_for_pickup', 'shipped', 'delivered', 'picked_up', 'cancelled', 'returned', 'refunded') NOT NULL DEFAULT 'pending',
  ADD COLUMN fulfilled_at DATETIME(3) NULL AFTER seller_net_minor,
  ADD COLUMN stock_restored_at DATETIME(3) NULL AFTER fulfilled_at;

ALTER TABLE order_status_events
  MODIFY COLUMN actor_type ENUM('system', 'customer', 'seller', 'admin', 'provider') NOT NULL;

CREATE TABLE fulfilment_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  order_id CHAR(36) NOT NULL,
  suborder_id CHAR(36) NOT NULL,
  from_status VARCHAR(40) NOT NULL,
  to_status VARCHAR(40) NOT NULL,
  reason VARCHAR(500) NULL,
  actor_user_id CHAR(36) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_fulfilment_events_suborder (suborder_id, id),
  KEY idx_fulfilment_events_order (order_id, id),
  CONSTRAINT fk_fulfilment_events_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE RESTRICT,
  CONSTRAINT fk_fulfilment_events_suborder FOREIGN KEY (suborder_id) REFERENCES seller_suborders(id) ON DELETE RESTRICT,
  CONSTRAINT fk_fulfilment_events_actor FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE cod_collections (
  id CHAR(36) NOT NULL,
  order_id CHAR(36) NOT NULL,
  idempotency_key VARCHAR(128) NOT NULL,
  request_hash CHAR(64) NOT NULL,
  amount_minor BIGINT UNSIGNED NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'NGN',
  collection_reference VARCHAR(190) NOT NULL,
  status ENUM('recorded', 'confirmed', 'rejected') NOT NULL DEFAULT 'recorded',
  collected_at DATETIME(3) NOT NULL,
  recorded_by CHAR(36) NOT NULL,
  reconciled_by CHAR(36) NULL,
  reconciliation_note VARCHAR(500) NULL,
  reconciled_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_cod_collections_order (order_id),
  UNIQUE KEY uq_cod_collections_reference (collection_reference),
  CONSTRAINT fk_cod_collections_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE RESTRICT,
  CONSTRAINT fk_cod_collections_recorded_by FOREIGN KEY (recorded_by) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT fk_cod_collections_reconciled_by FOREIGN KEY (reconciled_by) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE return_requests (
  id CHAR(36) NOT NULL,
  order_id CHAR(36) NOT NULL,
  idempotency_key VARCHAR(128) NOT NULL,
  request_hash CHAR(64) NOT NULL,
  reason VARCHAR(500) NOT NULL,
  status ENUM('requested', 'approved', 'rejected', 'refund_pending', 'refunded', 'refund_failed') NOT NULL DEFAULT 'requested',
  requested_by_user_id CHAR(36) NULL,
  reviewed_by CHAR(36) NULL,
  admin_note VARCHAR(500) NULL,
  reviewed_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_return_order_key (order_id, idempotency_key),
  KEY idx_return_requests_status (status, created_at),
  CONSTRAINT fk_return_requests_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE RESTRICT,
  CONSTRAINT fk_return_requests_requester FOREIGN KEY (requested_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_return_requests_reviewer FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE return_request_items (
  id CHAR(36) NOT NULL,
  return_request_id CHAR(36) NOT NULL,
  order_item_id CHAR(36) NOT NULL,
  quantity SMALLINT UNSIGNED NOT NULL,
  item_refund_minor BIGINT UNSIGNED NOT NULL,
  commission_reversal_minor BIGINT UNSIGNED NOT NULL,
  seller_reversal_minor BIGINT UNSIGNED NOT NULL,
  stock_disposition ENUM('pending', 'restock', 'no_restock') NOT NULL DEFAULT 'pending',
  restocked_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_return_request_item (return_request_id, order_item_id),
  KEY idx_return_items_order_item (order_item_id),
  CONSTRAINT fk_return_items_request FOREIGN KEY (return_request_id) REFERENCES return_requests(id) ON DELETE RESTRICT,
  CONSTRAINT fk_return_items_order_item FOREIGN KEY (order_item_id) REFERENCES order_items(id) ON DELETE RESTRICT,
  CONSTRAINT chk_return_item_quantity CHECK (quantity BETWEEN 1 AND 20)
) ENGINE=InnoDB;

CREATE TABLE refunds (
  id CHAR(36) NOT NULL,
  return_request_id CHAR(36) NULL,
  payment_review_case_id CHAR(36) NULL,
  payment_id CHAR(36) NOT NULL,
  provider ENUM('paystack') NOT NULL DEFAULT 'paystack',
  provider_refund_id VARCHAR(32) NULL,
  amount_minor BIGINT UNSIGNED NOT NULL,
  delivery_refund_minor BIGINT UNSIGNED NOT NULL DEFAULT 0,
  currency CHAR(3) NOT NULL DEFAULT 'NGN',
  status ENUM('initiation_pending', 'initiation_uncertain', 'pending', 'processing', 'needs_attention', 'processed', 'failed') NOT NULL DEFAULT 'initiation_pending',
  last_error VARCHAR(1000) NULL,
  initiated_by CHAR(36) NOT NULL,
  processed_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_refunds_return_request (return_request_id),
  UNIQUE KEY uq_refunds_review_case (payment_review_case_id),
  UNIQUE KEY uq_refunds_provider_id (provider_refund_id),
  KEY idx_refunds_reconcile (status, updated_at),
  CONSTRAINT fk_refunds_return_request FOREIGN KEY (return_request_id) REFERENCES return_requests(id) ON DELETE RESTRICT,
  CONSTRAINT fk_refunds_review_case FOREIGN KEY (payment_review_case_id) REFERENCES payment_review_cases(id) ON DELETE RESTRICT,
  CONSTRAINT fk_refunds_payment FOREIGN KEY (payment_id) REFERENCES payments(id) ON DELETE RESTRICT,
  CONSTRAINT fk_refunds_initiator FOREIGN KEY (initiated_by) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT chk_refund_source CHECK ((return_request_id IS NOT NULL AND payment_review_case_id IS NULL) OR (return_request_id IS NULL AND payment_review_case_id IS NOT NULL))
) ENGINE=InnoDB;

CREATE TABLE seller_refund_adjustments (
  id CHAR(36) NOT NULL,
  refund_id CHAR(36) NOT NULL,
  seller_id CHAR(36) NOT NULL,
  suborder_id CHAR(36) NOT NULL,
  item_gross_reversal_minor BIGINT UNSIGNED NOT NULL,
  commission_reversal_minor BIGINT UNSIGNED NOT NULL,
  seller_reversal_minor BIGINT UNSIGNED NOT NULL,
  classification ENUM('pending_b09_classification', 'earnings_reversal', 'recoverable_balance') NOT NULL DEFAULT 'pending_b09_classification',
  classified_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_seller_refund_adjustment (refund_id, seller_id),
  KEY idx_seller_refund_adjustments_seller (seller_id, created_at),
  CONSTRAINT fk_seller_refund_adjustments_refund FOREIGN KEY (refund_id) REFERENCES refunds(id) ON DELETE RESTRICT,
  CONSTRAINT fk_seller_refund_adjustments_seller FOREIGN KEY (seller_id) REFERENCES sellers(id) ON DELETE RESTRICT,
  CONSTRAINT fk_seller_refund_adjustments_suborder FOREIGN KEY (suborder_id) REFERENCES seller_suborders(id) ON DELETE RESTRICT
) ENGINE=InnoDB;

ALTER TABLE payment_ledger_entries
  MODIFY COLUMN entry_type ENUM('payment_received', 'late_payment_received', 'refund_processed') NOT NULL,
  ADD COLUMN refund_id CHAR(36) NULL AFTER payment_id,
  ADD COLUMN logical_key VARCHAR(190) NULL AFTER refund_id;

UPDATE payment_ledger_entries SET logical_key = CONCAT(payment_id, ':', entry_type);

ALTER TABLE payment_ledger_entries
  MODIFY COLUMN logical_key VARCHAR(190) NOT NULL,
  ADD KEY idx_payment_ledger_payment (payment_id),
  DROP INDEX uq_payment_ledger_logical,
  ADD UNIQUE KEY uq_payment_ledger_logical_key (logical_key),
  ADD CONSTRAINT fk_payment_ledger_refund FOREIGN KEY (refund_id) REFERENCES refunds(id) ON DELETE RESTRICT;
