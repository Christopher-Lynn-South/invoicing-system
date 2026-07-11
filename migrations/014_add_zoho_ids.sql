-- Zoho API sync: store Zoho's own record IDs so re-syncs upsert exactly
-- instead of guessing by name/email. (Numbered 014 to avoid clashing with a
-- server-local 013 migration.)
ALTER TABLE patients     ADD COLUMN IF NOT EXISTS zoho_id text;
ALTER TABLE products     ADD COLUMN IF NOT EXISTS zoho_id text;
ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS zoho_id text;
ALTER TABLE invoices     ADD COLUMN IF NOT EXISTS zoho_id text;

CREATE UNIQUE INDEX IF NOT EXISTS idx_patients_zoho_id     ON patients (zoho_id)     WHERE zoho_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_products_zoho_id     ON products (zoho_id)     WHERE zoho_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_orders_zoho_id ON sales_orders (zoho_id) WHERE zoho_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_zoho_id     ON invoices (zoho_id)     WHERE zoho_id IS NOT NULL;
