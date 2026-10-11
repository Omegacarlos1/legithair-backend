CREATE TABLE durable_jobs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  queue_name VARCHAR(100) NOT NULL,
  job_type VARCHAR(100) NOT NULL,
  payload JSON NOT NULL,
  status ENUM('pending', 'processing', 'completed', 'failed') NOT NULL DEFAULT 'pending',
  attempts INT UNSIGNED NOT NULL DEFAULT 0,
  available_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  locked_at DATETIME(3) NULL,
  locked_by VARCHAR(128) NULL,
  last_error VARCHAR(1000) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_jobs_claim (queue_name, status, available_at)
) ENGINE=InnoDB;

CREATE TABLE outbox_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  aggregate_type VARCHAR(100) NOT NULL,
  aggregate_id VARCHAR(128) NOT NULL,
  event_type VARCHAR(150) NOT NULL,
  payload JSON NOT NULL,
  occurred_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  published_at DATETIME(3) NULL,
  attempts INT UNSIGNED NOT NULL DEFAULT 0,
  last_error VARCHAR(1000) NULL,
  PRIMARY KEY (id),
  KEY idx_outbox_publish (published_at, occurred_at),
  KEY idx_outbox_aggregate (aggregate_type, aggregate_id)
) ENGINE=InnoDB;
