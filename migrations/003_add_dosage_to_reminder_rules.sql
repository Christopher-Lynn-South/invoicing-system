-- Add dosage tracking fields to reminder_rules
-- Allows calculating days supply from mg/dose × doses per day and total mg purchased.
-- Reminder fires 7 days before the calculated run-out date.

ALTER TABLE reminder_rules ADD COLUMN IF NOT EXISTS dosage_mg        numeric(8,2);   -- mg per dose
ALTER TABLE reminder_rules ADD COLUMN IF NOT EXISTS dosage_freq      text;           -- 'daily' | 'weekly'
ALTER TABLE reminder_rules ADD COLUMN IF NOT EXISTS doses_per_freq   numeric(4,2)    DEFAULT 1; -- how many doses per day/week
ALTER TABLE reminder_rules ADD COLUMN IF NOT EXISTS last_fill_qty_mg numeric(10,2);  -- total mg last dispensed
ALTER TABLE reminder_rules ADD COLUMN IF NOT EXISTS last_fill_date   date;           -- date of last fill
