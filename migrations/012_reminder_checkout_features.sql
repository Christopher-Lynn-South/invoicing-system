-- Feature pack: reminder engine v2, saved payments, credits, installments, autopay

-- Reminder engine: snooze, channel preference, autopay, escalation flag
ALTER TABLE reminder_rules ADD COLUMN IF NOT EXISTS snooze_until date;
ALTER TABLE reminder_rules ADD COLUMN IF NOT EXISTS channel_pref text NOT NULL DEFAULT 'email';
ALTER TABLE reminder_rules ADD COLUMN IF NOT EXISTS autopay boolean NOT NULL DEFAULT false;
ALTER TABLE reminder_rules ADD COLUMN IF NOT EXISTS escalated_at timestamptz;
ALTER TABLE reminder_rules ADD COLUMN IF NOT EXISTS autopay_notice_sent_at timestamptz;

-- Patients: default saved card + store credit
ALTER TABLE patients ADD COLUMN IF NOT EXISTS stripe_default_pm text;
ALTER TABLE patients ADD COLUMN IF NOT EXISTS credit_balance numeric(10,2) NOT NULL DEFAULT 0;

-- Invoices: abandoned-checkout tracking, credits, partial payments
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS viewed_at timestamptz;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS nudge_sent_at timestamptz;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS credit_applied numeric(10,2) NOT NULL DEFAULT 0;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS amount_paid numeric(10,2) NOT NULL DEFAULT 0;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS installments_allowed boolean NOT NULL DEFAULT false;

-- Shipments: actual delivery date (refill countdown starts here when known)
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS delivered_at date;

-- Prescriptions: expiry notification tracking
ALTER TABLE prescriptions ADD COLUMN IF NOT EXISTS expiry_notified_at timestamptz;

-- Partial-payment ledger (one row per installment / partial charge)
CREATE TABLE IF NOT EXISTS invoice_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES invoices(id),
  amount numeric(10,2) NOT NULL,
  method text,
  stripe_payment_intent_id text,
  status text NOT NULL DEFAULT 'pending',
  paid_at timestamptz,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_invoice_payments_invoice ON invoice_payments(invoice_id);
CREATE INDEX IF NOT EXISTS idx_invoice_payments_intent ON invoice_payments(stripe_payment_intent_id);

-- Store-credit ledger (positive = granted, negative = spent)
CREATE TABLE IF NOT EXISTS credit_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL REFERENCES patients(id),
  amount numeric(10,2) NOT NULL,
  reason text,
  invoice_id uuid REFERENCES invoices(id),
  created_by uuid,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_credit_ledger_patient ON credit_ledger(patient_id);
