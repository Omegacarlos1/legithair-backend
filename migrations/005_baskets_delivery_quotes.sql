CREATE TABLE delivery_zones (
  id CHAR(36) NOT NULL,
  code VARCHAR(50) NOT NULL,
  name VARCHAR(100) NOT NULL,
  coverage JSON NOT NULL,
  fee_minor BIGINT UNSIGNED NOT NULL,
  min_business_days SMALLINT UNSIGNED NOT NULL,
  max_business_days SMALLINT UNSIGNED NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by CHAR(36) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_delivery_zones_code (code),
  KEY idx_delivery_zones_active_name (is_active, name),
  CONSTRAINT fk_delivery_zones_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE pickup_locations (
  id CHAR(36) NOT NULL,
  name VARCHAR(100) NOT NULL,
  address_line VARCHAR(250) NOT NULL,
  city VARCHAR(100) NOT NULL,
  state VARCHAR(100) NOT NULL,
  fee_minor BIGINT UNSIGNED NOT NULL DEFAULT 0,
  min_business_days SMALLINT UNSIGNED NOT NULL,
  max_business_days SMALLINT UNSIGNED NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT FALSE,
  is_synthetic BOOLEAN NOT NULL DEFAULT FALSE,
  created_by CHAR(36) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_pickup_locations_active_name (is_active, name),
  CONSTRAINT fk_pickup_locations_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE indicative_exchange_rates (
  currency CHAR(3) NOT NULL,
  ngn_minor_per_currency_minor BIGINT UNSIGNED NOT NULL,
  updated_by CHAR(36) NOT NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (currency),
  CONSTRAINT fk_exchange_rates_updated_by FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE baskets (
  id CHAR(36) NOT NULL,
  user_id CHAR(36) NULL,
  guest_token_hash CHAR(64) NULL,
  status ENUM('active', 'merged') NOT NULL DEFAULT 'active',
  expires_at DATETIME(3) NULL,
  merged_into_basket_id CHAR(36) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_baskets_user (user_id),
  UNIQUE KEY uq_baskets_guest_token (guest_token_hash),
  KEY idx_baskets_expiry (status, expires_at),
  CONSTRAINT fk_baskets_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_baskets_merged_into FOREIGN KEY (merged_into_basket_id) REFERENCES baskets(id) ON DELETE RESTRICT,
  CONSTRAINT chk_basket_owner CHECK ((user_id IS NOT NULL AND guest_token_hash IS NULL AND expires_at IS NULL) OR (user_id IS NULL AND guest_token_hash IS NOT NULL AND expires_at IS NOT NULL))
) ENGINE=InnoDB;

CREATE TABLE basket_items (
  basket_id CHAR(36) NOT NULL,
  product_id CHAR(36) NOT NULL,
  quantity SMALLINT UNSIGNED NOT NULL,
  observed_price_minor BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (basket_id, product_id),
  KEY idx_basket_items_product (product_id),
  CONSTRAINT fk_basket_items_basket FOREIGN KEY (basket_id) REFERENCES baskets(id) ON DELETE CASCADE,
  CONSTRAINT fk_basket_items_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT,
  CONSTRAINT chk_basket_item_quantity CHECK (quantity BETWEEN 1 AND 20)
) ENGINE=InnoDB;

CREATE TABLE checkout_quotes (
  id CHAR(36) NOT NULL,
  basket_id CHAR(36) NOT NULL,
  idempotency_key VARCHAR(128) NOT NULL,
  request_hash CHAR(64) NOT NULL,
  delivery_method ENUM('delivery', 'pickup') NOT NULL,
  delivery_zone_id CHAR(36) NULL,
  pickup_location_id CHAR(36) NULL,
  destination_snapshot JSON NULL,
  items_subtotal_minor BIGINT UNSIGNED NOT NULL,
  delivery_total_minor BIGINT UNSIGNED NOT NULL,
  grand_total_minor BIGINT UNSIGNED NOT NULL,
  usd_rate_minor BIGINT UNSIGNED NULL,
  usd_grand_total_minor BIGINT UNSIGNED NULL,
  usd_rate_updated_at DATETIME(3) NULL,
  expires_at DATETIME(3) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_checkout_quotes_basket_key (basket_id, idempotency_key),
  KEY idx_checkout_quotes_expiry (expires_at),
  CONSTRAINT fk_checkout_quotes_basket FOREIGN KEY (basket_id) REFERENCES baskets(id) ON DELETE RESTRICT,
  CONSTRAINT fk_checkout_quotes_zone FOREIGN KEY (delivery_zone_id) REFERENCES delivery_zones(id) ON DELETE RESTRICT,
  CONSTRAINT fk_checkout_quotes_pickup FOREIGN KEY (pickup_location_id) REFERENCES pickup_locations(id) ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE checkout_quote_items (
  quote_id CHAR(36) NOT NULL,
  product_id CHAR(36) NOT NULL,
  seller_id CHAR(36) NOT NULL,
  product_name VARCHAR(180) NOT NULL,
  quantity SMALLINT UNSIGNED NOT NULL,
  unit_price_minor BIGINT UNSIGNED NOT NULL,
  line_total_minor BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (quote_id, product_id),
  KEY idx_quote_items_seller (quote_id, seller_id),
  CONSTRAINT fk_quote_items_quote FOREIGN KEY (quote_id) REFERENCES checkout_quotes(id) ON DELETE CASCADE,
  CONSTRAINT fk_quote_items_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT,
  CONSTRAINT fk_quote_items_seller FOREIGN KEY (seller_id) REFERENCES sellers(id) ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE checkout_quote_delivery_allocations (
  quote_id CHAR(36) NOT NULL,
  seller_id CHAR(36) NOT NULL,
  fee_minor BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (quote_id, seller_id),
  CONSTRAINT fk_quote_allocations_quote FOREIGN KEY (quote_id) REFERENCES checkout_quotes(id) ON DELETE CASCADE,
  CONSTRAINT fk_quote_allocations_seller FOREIGN KEY (seller_id) REFERENCES sellers(id) ON DELETE RESTRICT
) ENGINE=InnoDB;

INSERT INTO delivery_zones (id, code, name, coverage, fee_minor, min_business_days, max_business_days)
VALUES
  ('50000000-0000-4000-8000-000000000001', 'lagos-central', 'Zone 1 — Central Lagos', '["agege","anthony","gbagada","ifako-ijaiye","ikeja","ilupeju","ketu","kosofe","lagos mainland","maryland","mushin","ogba","ojota","omole","oshodi","oshodi-isolo","shomolu","surulere","yaba"]', 450000, 1, 2),
  ('50000000-0000-4000-8000-000000000002', 'lagos-extended', 'Zone 2 — Extended Lagos', '["ajah","ajeromi-ifelodun","alimosho","amuwo-odofin","apapa","eti-osa","festac","ikoyi","lagos island","lekki phase 1","oniru","victoria island"]', 600000, 2, 3),
  ('50000000-0000-4000-8000-000000000003', 'lagos-outer', 'Zone 3 — Outer Lagos', '["awoyaya","badagry","epe","ibeju-lekki","ikorodu","ojo","sangotedo"]', 800000, 2, 4);
