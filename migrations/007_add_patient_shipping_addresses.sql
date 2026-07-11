-- Multiple saved shipping addresses per patient.
-- is_default=true row is also synced to patients.shipping_address for FedEx compatibility.
CREATE TABLE IF NOT EXISTS patient_shipping_addresses (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id  uuid        NOT NULL REFERENCES patients(id),
  label       text        NOT NULL DEFAULT 'Home',
  street      text        NOT NULL,
  street2     text,
  city        text        NOT NULL,
  state       text        NOT NULL,   -- 2-letter US state code, stored uppercase
  zip         text        NOT NULL,
  country     text        NOT NULL DEFAULT 'US',
  is_default  boolean     NOT NULL DEFAULT false,
  created_at  timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS patient_shipping_addresses_patient_id_idx
  ON patient_shipping_addresses(patient_id);
