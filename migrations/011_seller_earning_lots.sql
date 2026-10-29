CREATE TABLE seller_earning_lots (
  id CHAR(36) NOT NULL,
  seller_id CHAR(36) NOT NULL,
  suborder_id CHAR(36) NOT NULL,
  original_amount_minor BIGINT UNSIGNED NOT NULL,
  held_remaining_minor BIGINT UNSIGNED NOT NULL,
  available_remaining_minor BIGINT UNSIGNED NOT NULL DEFAULT 0,
  reserved_remaining_minor BIGINT UNSIGNED NOT NULL DEFAULT 0,
  paid_minor BIGINT UNSIGNED NOT NULL DEFAULT 0,
  available_at DATETIME(3) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_earning_lot_suborder (suborder_id),
  KEY idx_earning_lot_available (seller_id, available_remaining_minor, available_at),
  CONSTRAINT fk_earning_lot_seller FOREIGN KEY (seller_id) REFERENCES sellers(id) ON DELETE RESTRICT,
  CONSTRAINT fk_earning_lot_suborder FOREIGN KEY (suborder_id) REFERENCES seller_suborders(id) ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE payout_allocations (
  payout_id CHAR(36) NOT NULL,
  earning_lot_id CHAR(36) NOT NULL,
  amount_minor BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (payout_id, earning_lot_id),
  CONSTRAINT fk_payout_allocation_payout FOREIGN KEY (payout_id) REFERENCES payouts(id) ON DELETE RESTRICT,
  CONSTRAINT fk_payout_allocation_lot FOREIGN KEY (earning_lot_id) REFERENCES seller_earning_lots(id) ON DELETE RESTRICT
) ENGINE=InnoDB;
