ALTER TABLE patients ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_patients_deleted_at ON patients (deleted_at) WHERE deleted_at IS NULL;
