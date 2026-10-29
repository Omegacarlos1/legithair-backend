DROP TABLE IF EXISTS banner_audit_events;
DROP TABLE IF EXISTS homepage_banners;
DROP TABLE IF EXISTS review_moderation_events;
DROP TABLE IF EXISTS product_reviews;

DELETE FROM user_roles WHERE role = 'support';
ALTER TABLE user_roles
  MODIFY COLUMN role ENUM('customer', 'seller', 'admin', 'finance') NOT NULL;
