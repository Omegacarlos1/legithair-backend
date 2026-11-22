CREATE TABLE staff_role_audit_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  target_user_id CHAR(36) NOT NULL,
  actor_user_id CHAR(36) NOT NULL,
  role ENUM('finance', 'support') NOT NULL,
  action ENUM('granted', 'revoked') NOT NULL,
  reason VARCHAR(500) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_staff_role_audit_target (target_user_id, created_at, id),
  KEY idx_staff_role_audit_created (created_at, id),
  CONSTRAINT fk_staff_role_audit_target FOREIGN KEY (target_user_id) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT fk_staff_role_audit_actor FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB;
