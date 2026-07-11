ALTER TABLE patients ADD COLUMN IF NOT EXISTS reset_token text;
ALTER TABLE patients ADD COLUMN IF NOT EXISTS reset_token_expires_at timestamptz;
