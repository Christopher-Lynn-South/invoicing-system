CREATE TABLE IF NOT EXISTS refill_requests (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id          uuid NOT NULL REFERENCES reminder_rules(id),
  patient_id       uuid NOT NULL REFERENCES patients(id),
  product_id       uuid NOT NULL REFERENCES products(id),
  token            text UNIQUE NOT NULL,
  token_expires_at timestamptz NOT NULL,
  status           text NOT NULL DEFAULT 'pending', -- pending | confirmed | declined | expired
  proposed_ship_date date,
  ship_address     jsonb,          -- address pulled from last shipment / billing
  ship_service     text DEFAULT 'PRIORITY_OVERNIGHT',
  channel          text DEFAULT 'email', -- email | sms | both
  order_id         uuid REFERENCES sales_orders(id),
  sent_at          timestamptz DEFAULT now(),
  responded_at     timestamptz,
  created_at       timestamptz DEFAULT now()
);
