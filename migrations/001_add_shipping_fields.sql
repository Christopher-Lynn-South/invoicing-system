-- Migration 001: Add shipping quote to orders and shipping charge to invoices
-- Run once: psql $DATABASE_URL -f migrations/001_add_shipping_fields.sql

ALTER TABLE sales_orders
  ADD COLUMN IF NOT EXISTS shipping_quote jsonb;

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS shipping_charge numeric(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone DEFAULT now();
