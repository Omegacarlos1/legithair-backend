ALTER TABLE durable_jobs
  ADD COLUMN max_attempts INT UNSIGNED NOT NULL DEFAULT 5 AFTER attempts,
  ADD COLUMN completed_at DATETIME(3) NULL AFTER last_error;

ALTER TABLE outbox_events
  ADD COLUMN available_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) AFTER payload,
  ADD COLUMN locked_at DATETIME(3) NULL AFTER attempts,
  ADD COLUMN locked_by VARCHAR(128) NULL AFTER locked_at,
  ADD KEY idx_outbox_claim (published_at, available_at, locked_at, occurred_at);

CREATE TABLE support_threads (
  id CHAR(36) NOT NULL,
  customer_user_id CHAR(36) NOT NULL,
  subject VARCHAR(160) NOT NULL,
  status ENUM('open', 'closed') NOT NULL DEFAULT 'open',
  assigned_support_user_id CHAR(36) NULL,
  last_message_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_support_threads_customer (customer_user_id, last_message_at, id),
  KEY idx_support_threads_queue (status, assigned_support_user_id, last_message_at, id),
  CONSTRAINT fk_support_threads_customer FOREIGN KEY (customer_user_id) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT fk_support_threads_assignee FOREIGN KEY (assigned_support_user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE support_messages (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  thread_id CHAR(36) NOT NULL,
  sender_user_id CHAR(36) NOT NULL,
  client_id CHAR(36) NOT NULL,
  request_hash CHAR(64) NOT NULL,
  body TEXT NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_support_messages_sender_client (sender_user_id, client_id),
  KEY idx_support_messages_thread_offset (thread_id, id),
  CONSTRAINT fk_support_messages_thread FOREIGN KEY (thread_id) REFERENCES support_threads(id) ON DELETE RESTRICT,
  CONSTRAINT fk_support_messages_sender FOREIGN KEY (sender_user_id) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE marketing_preferences (
  user_id CHAR(36) NOT NULL,
  opted_in_at DATETIME(3) NULL,
  opted_out_at DATETIME(3) NULL,
  source VARCHAR(100) NOT NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (user_id),
  CONSTRAINT fk_marketing_preferences_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE email_suppressions (
  email VARCHAR(320) NOT NULL,
  reason ENUM('unsubscribe', 'bounce', 'complaint', 'manual') NOT NULL,
  actor_user_id CHAR(36) NULL,
  suppressed_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  lifted_at DATETIME(3) NULL,
  PRIMARY KEY (email),
  KEY idx_email_suppressions_active (lifted_at, reason, email),
  CONSTRAINT fk_email_suppressions_actor FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE marketing_campaigns (
  id CHAR(36) NOT NULL,
  subject VARCHAR(200) NOT NULL,
  body TEXT NOT NULL,
  status ENUM('queued', 'completed') NOT NULL DEFAULT 'queued',
  recipient_count INT UNSIGNED NOT NULL DEFAULT 0,
  created_by CHAR(36) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  completed_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  KEY idx_marketing_campaigns_created (created_at, id),
  CONSTRAINT fk_marketing_campaigns_creator FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE marketing_unsubscribe_tokens (
  id CHAR(36) NOT NULL,
  token_hash CHAR(64) NOT NULL,
  user_id CHAR(36) NOT NULL,
  campaign_id CHAR(36) NOT NULL,
  used_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_marketing_unsubscribe_hash (token_hash),
  KEY idx_marketing_unsubscribe_user (user_id, created_at),
  CONSTRAINT fk_marketing_unsubscribe_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_marketing_unsubscribe_campaign FOREIGN KEY (campaign_id) REFERENCES marketing_campaigns(id) ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE email_deliveries (
  id CHAR(36) NOT NULL,
  durable_job_id BIGINT UNSIGNED NOT NULL,
  user_id CHAR(36) NULL,
  category ENUM('transactional', 'marketing') NOT NULL,
  template VARCHAR(100) NOT NULL,
  recipient_email VARCHAR(320) NOT NULL,
  logical_key VARCHAR(190) NOT NULL,
  status ENUM('queued', 'processing', 'retry_scheduled', 'sent', 'failed', 'suppressed') NOT NULL DEFAULT 'queued',
  attempts INT UNSIGNED NOT NULL DEFAULT 0,
  last_error VARCHAR(1000) NULL,
  sent_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_email_deliveries_job (durable_job_id),
  UNIQUE KEY uq_email_deliveries_logical (logical_key),
  KEY idx_email_deliveries_recipient (recipient_email, created_at),
  KEY idx_email_deliveries_status (status, updated_at),
  CONSTRAINT fk_email_deliveries_job FOREIGN KEY (durable_job_id) REFERENCES durable_jobs(id) ON DELETE RESTRICT,
  CONSTRAINT fk_email_deliveries_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE email_delivery_attempts (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  delivery_id CHAR(36) NOT NULL,
  attempt_number INT UNSIGNED NOT NULL,
  outcome ENUM('sent', 'failed', 'suppressed') NOT NULL,
  error_message VARCHAR(1000) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_email_delivery_attempt (delivery_id, attempt_number),
  KEY idx_email_delivery_attempts_delivery (delivery_id, id),
  CONSTRAINT fk_email_delivery_attempts_delivery FOREIGN KEY (delivery_id) REFERENCES email_deliveries(id) ON DELETE RESTRICT
) ENGINE=InnoDB;
