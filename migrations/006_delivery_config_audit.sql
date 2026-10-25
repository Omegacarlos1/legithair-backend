CREATE TABLE delivery_config_audit_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  actor_user_id CHAR(36) NOT NULL,
  entity_type ENUM('delivery_zone', 'pickup_location', 'exchange_rate') NOT NULL,
  entity_id VARCHAR(50) NOT NULL,
  action VARCHAR(50) NOT NULL,
  previous_value JSON NULL,
  new_value JSON NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_delivery_config_audit_entity (entity_type, entity_id, created_at),
  KEY idx_delivery_config_audit_actor (actor_user_id, created_at),
  CONSTRAINT fk_delivery_config_audit_actor FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB;
