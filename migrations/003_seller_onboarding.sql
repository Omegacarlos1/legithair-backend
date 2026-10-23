CREATE TABLE sellers (
  id CHAR(36) NOT NULL,
  user_id CHAR(36) NOT NULL,
  business_name VARCHAR(150) NOT NULL,
  phone VARCHAR(30) NOT NULL,
  identity_status ENUM('not_started', 'pending', 'verified', 'failed', 'manual_review') NOT NULL DEFAULT 'not_started',
  approval_status ENUM('pending', 'approved', 'suspended') NOT NULL DEFAULT 'pending',
  approval_reason VARCHAR(500) NULL,
  approved_by CHAR(36) NULL,
  approved_at DATETIME(3) NULL,
  suspended_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_sellers_user (user_id),
  KEY idx_sellers_approval_identity (approval_status, identity_status),
  CONSTRAINT fk_sellers_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_sellers_approved_by FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE seller_audit_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  seller_id CHAR(36) NOT NULL,
  actor_user_id CHAR(36) NOT NULL,
  action VARCHAR(100) NOT NULL,
  previous_status VARCHAR(30) NULL,
  new_status VARCHAR(30) NULL,
  reason VARCHAR(500) NULL,
  metadata JSON NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_seller_audit_seller_created (seller_id, created_at),
  KEY idx_seller_audit_actor_created (actor_user_id, created_at),
  CONSTRAINT fk_seller_audit_seller FOREIGN KEY (seller_id) REFERENCES sellers(id) ON DELETE CASCADE,
  CONSTRAINT fk_seller_audit_actor FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB;
