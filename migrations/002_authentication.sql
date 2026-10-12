CREATE TABLE users (
  id CHAR(36) NOT NULL,
  email VARCHAR(320) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  display_name VARCHAR(100) NOT NULL,
  email_verified_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_email (email)
) ENGINE=InnoDB;

CREATE TABLE user_roles (
  user_id CHAR(36) NOT NULL,
  role ENUM('customer', 'seller', 'admin') NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (user_id, role),
  CONSTRAINT fk_user_roles_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE auth_tokens (
  id CHAR(36) NOT NULL,
  user_id CHAR(36) NOT NULL,
  token_hash CHAR(64) NOT NULL,
  token_type ENUM('email_verification', 'password_reset', 'access', 'refresh') NOT NULL,
  family_id CHAR(36) NULL,
  parent_id CHAR(36) NULL,
  expires_at DATETIME(3) NOT NULL,
  used_at DATETIME(3) NULL,
  revoked_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_auth_tokens_hash (token_hash),
  KEY idx_auth_tokens_user_type (user_id, token_type),
  KEY idx_auth_tokens_family (family_id),
  CONSTRAINT fk_auth_tokens_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_auth_tokens_parent FOREIGN KEY (parent_id) REFERENCES auth_tokens(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE addresses (
  id CHAR(36) NOT NULL,
  user_id CHAR(36) NOT NULL,
  label VARCHAR(50) NOT NULL,
  recipient_name VARCHAR(100) NOT NULL,
  phone VARCHAR(30) NOT NULL,
  line1 VARCHAR(200) NOT NULL,
  line2 VARCHAR(200) NULL,
  city VARCHAR(100) NOT NULL,
  state VARCHAR(100) NOT NULL,
  country_code CHAR(2) NOT NULL DEFAULT 'NG',
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_addresses_user (user_id),
  CONSTRAINT fk_addresses_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;
