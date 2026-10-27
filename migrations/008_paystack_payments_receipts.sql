ALTER TABLE durable_jobs
  ADD COLUMN deduplication_key VARCHAR(190) NULL AFTER job_type,
  ADD UNIQUE KEY uq_durable_jobs_deduplication (deduplication_key);

CREATE TABLE payments (
  id CHAR(36) NOT NULL,
  order_id CHAR(36) NOT NULL,
  provider ENUM('paystack') NOT NULL DEFAULT 'paystack',
  provider_reference VARCHAR(100) NOT NULL,
  provider_transaction_id VARCHAR(32) NULL,
  customer_email VARCHAR(320) NOT NULL,
  expected_amount_minor BIGINT UNSIGNED NOT NULL,
  currency CHAR(3) NOT NULL,
  status ENUM('initialization_pending', 'pending', 'succeeded', 'mismatch', 'late_success', 'failed') NOT NULL DEFAULT 'initialization_pending',
  authorization_url VARCHAR(500) NULL,
  access_code VARCHAR(100) NULL,
  paid_at DATETIME(3) NULL,
  verified_at DATETIME(3) NULL,
  last_error VARCHAR(1000) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_payments_order (order_id),
  UNIQUE KEY uq_payments_reference (provider_reference),
  UNIQUE KEY uq_payments_provider_transaction (provider_transaction_id),
  KEY idx_payments_reconcile (status, updated_at),
  CONSTRAINT fk_payments_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE payment_webhook_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  provider ENUM('paystack') NOT NULL DEFAULT 'paystack',
  event_key VARCHAR(190) NOT NULL,
  event_type VARCHAR(100) NOT NULL,
  payment_id CHAR(36) NULL,
  payload_sha256 CHAR(64) NOT NULL,
  status ENUM('received', 'processed', 'rejected') NOT NULL DEFAULT 'received',
  result_code VARCHAR(100) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  processed_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_payment_webhook_event (provider, event_key),
  KEY idx_payment_webhook_status (status, created_at),
  CONSTRAINT fk_payment_webhook_payment FOREIGN KEY (payment_id) REFERENCES payments(id) ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE payment_ledger_entries (
  id CHAR(36) NOT NULL,
  order_id CHAR(36) NOT NULL,
  payment_id CHAR(36) NOT NULL,
  entry_type ENUM('payment_received', 'late_payment_received') NOT NULL,
  direction ENUM('credit', 'debit') NOT NULL,
  amount_minor BIGINT UNSIGNED NOT NULL,
  currency CHAR(3) NOT NULL,
  description VARCHAR(255) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_payment_ledger_logical (payment_id, entry_type),
  KEY idx_payment_ledger_order (order_id, created_at),
  CONSTRAINT fk_payment_ledger_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE RESTRICT,
  CONSTRAINT fk_payment_ledger_payment FOREIGN KEY (payment_id) REFERENCES payments(id) ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE payment_review_cases (
  id CHAR(36) NOT NULL,
  order_id CHAR(36) NOT NULL,
  payment_id CHAR(36) NOT NULL,
  case_type ENUM('amount_mismatch', 'currency_mismatch', 'reference_mismatch', 'order_association_mismatch', 'late_payment') NOT NULL,
  status ENUM('open', 'refund_pending', 'resolved') NOT NULL DEFAULT 'open',
  details JSON NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  resolved_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_payment_review_type (payment_id, case_type),
  KEY idx_payment_review_status (status, created_at),
  CONSTRAINT fk_payment_review_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE RESTRICT,
  CONSTRAINT fk_payment_review_payment FOREIGN KEY (payment_id) REFERENCES payments(id) ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE paid_receipts (
  id CHAR(36) NOT NULL,
  receipt_number VARCHAR(64) NOT NULL,
  order_id CHAR(36) NOT NULL,
  payment_id CHAR(36) NOT NULL,
  snapshot JSON NOT NULL,
  issued_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_paid_receipts_number (receipt_number),
  UNIQUE KEY uq_paid_receipts_order (order_id),
  UNIQUE KEY uq_paid_receipts_payment (payment_id),
  CONSTRAINT fk_paid_receipts_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE RESTRICT,
  CONSTRAINT fk_paid_receipts_payment FOREIGN KEY (payment_id) REFERENCES payments(id) ON DELETE RESTRICT
) ENGINE=InnoDB;
