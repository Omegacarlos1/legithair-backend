CREATE TABLE delivery_assignments (
  suborder_id CHAR(36) NOT NULL PRIMARY KEY,
  courier_name VARCHAR(120) NOT NULL,
  courier_reference VARCHAR(120) NOT NULL,
  assigned_by CHAR(36) NOT NULL,
  assigned_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_delivery_assignment_suborder FOREIGN KEY (suborder_id) REFERENCES seller_suborders(id) ON DELETE RESTRICT,
  CONSTRAINT fk_delivery_assignment_actor FOREIGN KEY (assigned_by) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE delivery_assignment_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  suborder_id CHAR(36) NOT NULL,
  courier_name VARCHAR(120) NOT NULL,
  courier_reference VARCHAR(120) NOT NULL,
  actor_user_id CHAR(36) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_delivery_assignment_events_suborder (suborder_id, id),
  CONSTRAINT fk_delivery_assignment_event_suborder FOREIGN KEY (suborder_id) REFERENCES seller_suborders(id) ON DELETE RESTRICT,
  CONSTRAINT fk_delivery_assignment_event_actor FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB;
