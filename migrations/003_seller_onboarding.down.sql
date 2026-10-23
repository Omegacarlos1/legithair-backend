DELETE FROM user_roles WHERE role = 'seller' AND user_id IN (SELECT user_id FROM sellers);
DROP TABLE IF EXISTS seller_audit_events;
DROP TABLE IF EXISTS sellers;
