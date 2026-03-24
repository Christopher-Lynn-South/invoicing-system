-- OrderFlow initial schema
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS "patients" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "name" text NOT NULL,
  "email" text UNIQUE,
  "date_of_birth" date,
  "phone" text,
  "billing_address" jsonb,
  "usdc_wallet" text,
  "stripe_customer_id" text,
  "requires_prescription" boolean DEFAULT false,
  "active_prescription_id" uuid,
  "password_hash" text,
  "portal_enabled" boolean NOT NULL DEFAULT false,
  "created_at" timestamptz DEFAULT now(),
  "updated_at" timestamptz DEFAULT now()
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "admin_users" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "email" text UNIQUE NOT NULL,
  "password_hash" text NOT NULL,
  "name" text NOT NULL,
  "role" text NOT NULL DEFAULT 'worker',
  "created_at" timestamptz DEFAULT now()
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "products" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "sku" text UNIQUE NOT NULL,
  "name" text NOT NULL,
  "unit_price" numeric(10,2) NOT NULL,
  "unit" text,
  "active" boolean DEFAULT true,
  "created_at" timestamptz DEFAULT now()
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "sales_orders" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "order_number" text UNIQUE NOT NULL,
  "patient_id" uuid NOT NULL REFERENCES patients(id),
  "status" text NOT NULL DEFAULT 'draft',
  "notes" text,
  "created_at" timestamptz DEFAULT now(),
  "updated_at" timestamptz DEFAULT now()
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "order_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "order_id" uuid NOT NULL REFERENCES sales_orders(id),
  "product_id" uuid NOT NULL REFERENCES products(id),
  "quantity" integer NOT NULL,
  "unit_price" numeric(10,2) NOT NULL,
  "line_total" numeric(10,2) NOT NULL
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "invoices" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "invoice_number" text UNIQUE NOT NULL,
  "order_id" uuid UNIQUE NOT NULL REFERENCES sales_orders(id),
  "subtotal" numeric(10,2) NOT NULL,
  "processing_fee" numeric(10,2) DEFAULT '0',
  "total" numeric(10,2) NOT NULL,
  "pay_method" text,
  "pay_status" text NOT NULL DEFAULT 'pending',
  "stripe_payment_intent_id" text,
  "usdc_tx_hash" text,
  "paid_at" timestamptz,
  "due_date" date,
  "pdf_url" text,
  "sent_at" timestamptz,
  "created_at" timestamptz DEFAULT now()
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "shipments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "order_id" uuid UNIQUE NOT NULL REFERENCES sales_orders(id),
  "fedex_tracking_number" text,
  "service_type" text,
  "weight_lbs" numeric(6,2),
  "dimensions_json" jsonb,
  "label_pdf_url" text,
  "ship_date" date,
  "estimated_delivery" date,
  "status" text DEFAULT 'label_created',
  "last_polled_at" timestamptz,
  "polling_active" boolean DEFAULT true,
  "latest_status" text,
  "exception_flag" boolean DEFAULT false,
  "raw_import_id" text,
  "created_at" timestamptz DEFAULT now()
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "shipment_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "shipment_id" uuid NOT NULL REFERENCES shipments(id),
  "event_code" text,
  "event_description" text,
  "event_timestamp" timestamptz,
  "location_city" text,
  "location_state" text,
  "location_country" text,
  "raw_json" jsonb,
  "created_at" timestamptz DEFAULT now()
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "reminder_rules" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "patient_id" uuid NOT NULL REFERENCES patients(id),
  "product_id" uuid NOT NULL REFERENCES products(id),
  "interval_days" integer NOT NULL,
  "last_reminded_at" timestamptz,
  "last_order_id" uuid REFERENCES sales_orders(id),
  "active" boolean DEFAULT true,
  "created_at" timestamptz DEFAULT now()
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "reminder_logs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "rule_id" uuid NOT NULL REFERENCES reminder_rules(id),
  "sent_at" timestamptz DEFAULT now(),
  "triggered_order_id" uuid REFERENCES sales_orders(id),
  "channel" text DEFAULT 'email'
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "prescriptions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "patient_id" uuid NOT NULL REFERENCES patients(id),
  "prescribing_doctor" text NOT NULL,
  "doctor_phone" text,
  "doctor_npi" text,
  "issue_date" date NOT NULL,
  "expiry_date" date,
  "file_path" text NOT NULL,
  "file_name" text NOT NULL,
  "file_mime" text NOT NULL,
  "file_size_bytes" integer,
  "notes" text,
  "status" text NOT NULL DEFAULT 'active',
  "uploaded_by" uuid REFERENCES admin_users(id),
  "created_at" timestamptz DEFAULT now()
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "app_settings" (
  "key" text PRIMARY KEY,
  "value" text,
  "updated_at" timestamptz DEFAULT now()
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "patient_contacts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "patient_id" uuid NOT NULL REFERENCES patients(id),
  "relationship" text NOT NULL,
  "first_name" text NOT NULL,
  "last_name" text NOT NULL,
  "phone" text,
  "email" text,
  "is_primary" boolean DEFAULT false,
  "receives_notifications" boolean DEFAULT false,
  "notes" text,
  "created_at" timestamptz DEFAULT now()
);
