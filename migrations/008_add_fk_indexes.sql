-- Migration 008: Add missing indexes on foreign key columns
-- Uses CONCURRENTLY to avoid locking tables during index creation.
-- Run outside a transaction block (psql directly, not within BEGIN/COMMIT).

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_order_items_order_id
  ON order_items(order_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_order_items_product_id
  ON order_items(product_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_shipment_events_shipment_id
  ON shipment_events(shipment_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_reminder_rules_patient_id
  ON reminder_rules(patient_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_reminder_rules_product_id
  ON reminder_rules(product_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_reminder_logs_rule_id
  ON reminder_logs(rule_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_prescriptions_patient_id
  ON prescriptions(patient_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_patient_contacts_patient_id
  ON patient_contacts(patient_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_refill_requests_patient_id
  ON refill_requests(patient_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_refill_requests_rule_id
  ON refill_requests(rule_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_invoices_order_id
  ON invoices(order_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_shipments_order_id
  ON shipments(order_id);
