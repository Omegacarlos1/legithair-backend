ALTER TABLE user_roles
  MODIFY COLUMN role ENUM('customer', 'seller', 'admin', 'finance') NOT NULL;

CREATE TABLE seller_payout_recipients (
  id CHAR(36) NOT NULL,
  seller_id CHAR(36) NOT NULL,
  provider ENUM('paystack') NOT NULL DEFAULT 'paystack',
  provider_recipient_code VARCHAR(100) NOT NULL,
  account_name VARCHAR(160) NOT NULL,
  bank_name VARCHAR(120) NOT NULL,
  account_last4 CHAR(4) NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'NGN',
  configured_by CHAR(36) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_seller_payout_recipient (seller_id),
  UNIQUE KEY uq_provider_recipient_code (provider, provider_recipient_code),
  CONSTRAINT fk_payout_recipient_seller FOREIGN KEY (seller_id) REFERENCES sellers(id) ON DELETE RESTRICT,
  CONSTRAINT fk_payout_recipient_configurer FOREIGN KEY (configured_by) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE payouts (
  id CHAR(36) NOT NULL,
  seller_id CHAR(36) NOT NULL,
  payout_recipient_id CHAR(36) NOT NULL,
  requested_by CHAR(36) NOT NULL,
  idempotency_key VARCHAR(128) NOT NULL,
  request_hash CHAR(64) NOT NULL,
  provider_reference VARCHAR(50) NOT NULL,
  provider_transfer_code VARCHAR(100) NULL,
  provider_transfer_id VARCHAR(32) NULL,
  amount_minor BIGINT UNSIGNED NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'NGN',
  status ENUM('initiation_pending', 'initiation_uncertain', 'pending', 'success', 'failed', 'reversed') NOT NULL DEFAULT 'initiation_pending',
  last_error VARCHAR(1000) NULL,
  initiated_at DATETIME(3) NULL,
  concluded_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_payout_request (requested_by, idempotency_key),
  UNIQUE KEY uq_payout_provider_reference (provider_reference),
  UNIQUE KEY uq_payout_provider_transfer_code (provider_transfer_code),
  KEY idx_payout_reconcile (status, updated_at),
  KEY idx_payout_seller (seller_id, created_at),
  CONSTRAINT fk_payout_seller FOREIGN KEY (seller_id) REFERENCES sellers(id) ON DELETE RESTRICT,
  CONSTRAINT fk_payout_recipient FOREIGN KEY (payout_recipient_id) REFERENCES seller_payout_recipients(id) ON DELETE RESTRICT,
  CONSTRAINT fk_payout_requester FOREIGN KEY (requested_by) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE seller_ledger_entries (
  id CHAR(36) NOT NULL,
  seller_id CHAR(36) NOT NULL,
  suborder_id CHAR(36) NULL,
  refund_adjustment_id CHAR(36) NULL,
  payout_id CHAR(36) NULL,
  logical_key VARCHAR(190) NOT NULL,
  entry_type ENUM('earning_held', 'hold_released', 'refund_reversal', 'refund_recoverable', 'payout_reserved', 'payout_paid', 'payout_restored') NOT NULL,
  bucket ENUM('held', 'available', 'reserved', 'paid', 'recoverable') NOT NULL,
  direction ENUM('credit', 'debit') NOT NULL,
  amount_minor BIGINT UNSIGNED NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'NGN',
  description VARCHAR(255) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_seller_ledger_logical (logical_key),
  KEY idx_seller_ledger_balance (seller_id, bucket, created_at),
  CONSTRAINT fk_seller_ledger_seller FOREIGN KEY (seller_id) REFERENCES sellers(id) ON DELETE RESTRICT,
  CONSTRAINT fk_seller_ledger_suborder FOREIGN KEY (suborder_id) REFERENCES seller_suborders(id) ON DELETE RESTRICT,
  CONSTRAINT fk_seller_ledger_refund_adjustment FOREIGN KEY (refund_adjustment_id) REFERENCES seller_refund_adjustments(id) ON DELETE RESTRICT,
  CONSTRAINT fk_seller_ledger_payout FOREIGN KEY (payout_id) REFERENCES payouts(id) ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE payout_webhook_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  event_key VARCHAR(190) NOT NULL,
  event_type VARCHAR(100) NOT NULL,
  payout_id CHAR(36) NULL,
  payload_sha256 CHAR(64) NOT NULL,
  status ENUM('received', 'processed', 'rejected') NOT NULL DEFAULT 'received',
  result_code VARCHAR(100) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  processed_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_payout_webhook_event (event_key),
  CONSTRAINT fk_payout_webhook_payout FOREIGN KEY (payout_id) REFERENCES payouts(id) ON DELETE RESTRICT
) ENGINE=InnoDB;
