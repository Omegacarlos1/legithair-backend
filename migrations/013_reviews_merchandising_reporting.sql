ALTER TABLE user_roles
  MODIFY COLUMN role ENUM('customer', 'seller', 'admin', 'finance', 'support') NOT NULL;

CREATE TABLE product_reviews (
  id CHAR(36) NOT NULL,
  product_id CHAR(36) NOT NULL,
  order_item_id CHAR(36) NOT NULL,
  user_id CHAR(36) NOT NULL,
  idempotency_key VARCHAR(128) NOT NULL,
  request_hash CHAR(64) NOT NULL,
  rating TINYINT UNSIGNED NOT NULL,
  title VARCHAR(160) NOT NULL,
  body TEXT NOT NULL,
  status ENUM('pending', 'published', 'rejected') NOT NULL DEFAULT 'pending',
  moderation_reason VARCHAR(500) NULL,
  moderated_by CHAR(36) NULL,
  moderated_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_product_reviews_user_product (user_id, product_id),
  UNIQUE KEY uq_product_reviews_order_item (order_item_id),
  UNIQUE KEY uq_product_reviews_user_key (user_id, idempotency_key),
  KEY idx_product_reviews_public (product_id, status, created_at, id),
  KEY idx_product_reviews_moderation (status, created_at, id),
  CONSTRAINT fk_product_reviews_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT,
  CONSTRAINT fk_product_reviews_order_item FOREIGN KEY (order_item_id) REFERENCES order_items(id) ON DELETE RESTRICT,
  CONSTRAINT fk_product_reviews_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT fk_product_reviews_moderator FOREIGN KEY (moderated_by) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT chk_product_reviews_rating CHECK (rating BETWEEN 1 AND 5)
) ENGINE=InnoDB;

CREATE TABLE review_moderation_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  review_id CHAR(36) NOT NULL,
  from_status ENUM('pending', 'published', 'rejected') NOT NULL,
  to_status ENUM('published', 'rejected') NOT NULL,
  reason VARCHAR(500) NOT NULL,
  actor_user_id CHAR(36) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_review_moderation_review (review_id, id),
  CONSTRAINT fk_review_moderation_review FOREIGN KEY (review_id) REFERENCES product_reviews(id) ON DELETE RESTRICT,
  CONSTRAINT fk_review_moderation_actor FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE homepage_banners (
  id CHAR(36) NOT NULL,
  title VARCHAR(160) NOT NULL,
  subtitle VARCHAR(300) NULL,
  image_url VARCHAR(500) NOT NULL,
  target_url VARCHAR(500) NULL,
  position SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  status ENUM('draft', 'active', 'inactive') NOT NULL DEFAULT 'draft',
  starts_at DATETIME(3) NULL,
  ends_at DATETIME(3) NULL,
  created_by CHAR(36) NOT NULL,
  updated_by CHAR(36) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_homepage_banners_public (status, starts_at, ends_at, position, id),
  CONSTRAINT fk_homepage_banners_creator FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT fk_homepage_banners_updater FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT chk_homepage_banners_window CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at)
) ENGINE=InnoDB;

CREATE TABLE banner_audit_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  banner_id CHAR(36) NOT NULL,
  action VARCHAR(50) NOT NULL,
  actor_user_id CHAR(36) NOT NULL,
  metadata JSON NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_banner_audit_banner (banner_id, id),
  CONSTRAINT fk_banner_audit_banner FOREIGN KEY (banner_id) REFERENCES homepage_banners(id) ON DELETE RESTRICT,
  CONSTRAINT fk_banner_audit_actor FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB;
