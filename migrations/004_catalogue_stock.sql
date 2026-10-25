CREATE TABLE categories (
  id CHAR(36) NOT NULL,
  name VARCHAR(100) NOT NULL,
  slug VARCHAR(120) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by CHAR(36) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_categories_name (name),
  UNIQUE KEY uq_categories_slug (slug),
  KEY idx_categories_active_name (is_active, name),
  CONSTRAINT fk_categories_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE products (
  id CHAR(36) NOT NULL,
  seller_id CHAR(36) NOT NULL,
  category_id CHAR(36) NOT NULL,
  name VARCHAR(180) NOT NULL,
  slug VARCHAR(220) NOT NULL,
  description TEXT NOT NULL,
  price_minor BIGINT UNSIGNED NOT NULL,
  brand VARCHAR(100) NULL,
  colour VARCHAR(100) NULL,
  size_label VARCHAR(100) NULL,
  publication_status ENUM('draft', 'published', 'unpublished') NOT NULL DEFAULT 'draft',
  stock_quantity INT UNSIGNED NOT NULL DEFAULT 0,
  low_stock_threshold INT UNSIGNED NOT NULL DEFAULT 0,
  paid_units_sold BIGINT UNSIGNED NOT NULL DEFAULT 0,
  published_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_products_slug (slug),
  KEY idx_products_public_category (publication_status, category_id, published_at, id),
  KEY idx_products_public_price (publication_status, price_minor, id),
  KEY idx_products_public_popularity (publication_status, paid_units_sold, id),
  KEY idx_products_seller_updated (seller_id, updated_at, id),
  KEY idx_products_brand (brand),
  KEY idx_products_colour (colour),
  KEY idx_products_size (size_label),
  CONSTRAINT fk_products_seller FOREIGN KEY (seller_id) REFERENCES sellers(id) ON DELETE RESTRICT,
  CONSTRAINT fk_products_category FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE product_images (
  id CHAR(36) NOT NULL,
  product_id CHAR(36) NOT NULL,
  storage_key VARCHAR(255) NOT NULL,
  mime_type ENUM('image/jpeg', 'image/png', 'image/webp') NOT NULL,
  size_bytes INT UNSIGNED NOT NULL,
  alt_text VARCHAR(200) NOT NULL,
  sort_order SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_product_images_storage_key (storage_key),
  KEY idx_product_images_product_order (product_id, sort_order, id),
  CONSTRAINT fk_product_images_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE stock_adjustments (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  product_id CHAR(36) NOT NULL,
  actor_user_id CHAR(36) NOT NULL,
  idempotency_key VARCHAR(128) NOT NULL,
  delta INT NOT NULL,
  previous_quantity INT UNSIGNED NOT NULL,
  new_quantity INT UNSIGNED NOT NULL,
  reason VARCHAR(500) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_stock_adjustments_product_key (product_id, idempotency_key),
  KEY idx_stock_adjustments_product_created (product_id, created_at, id),
  KEY idx_stock_adjustments_actor_created (actor_user_id, created_at, id),
  CONSTRAINT fk_stock_adjustments_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT,
  CONSTRAINT fk_stock_adjustments_actor FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE product_audit_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  product_id CHAR(36) NOT NULL,
  actor_user_id CHAR(36) NOT NULL,
  action VARCHAR(100) NOT NULL,
  metadata JSON NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_product_audit_product_created (product_id, created_at, id),
  KEY idx_product_audit_actor_created (actor_user_id, created_at, id),
  CONSTRAINT fk_product_audit_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
  CONSTRAINT fk_product_audit_actor FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB;
