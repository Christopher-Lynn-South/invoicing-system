-- Prevent USDC transaction replay: enforce that each on-chain transfer can only
-- pay ONE invoice. Uses a partial unique index so unpaid invoices with NULL
-- tx_hash are ignored.
CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_usdc_tx_hash_unique
  ON invoices (usdc_tx_hash)
  WHERE usdc_tx_hash IS NOT NULL;
