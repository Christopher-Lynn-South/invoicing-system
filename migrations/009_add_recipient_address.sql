-- Migration 009: add recipient_address to sales_orders
-- Stores the staff-selected shipping address for a sales order so it
-- persists across sessions and pre-fills the FedEx label modal.
ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS recipient_address jsonb;
