const {
  pgTable,
  uuid,
  text,
  numeric,
  integer,
  boolean,
  timestamp,
  date,
  jsonb,
  uniqueIndex,
  index,
} = require('drizzle-orm/pg-core');
const { sql } = require('drizzle-orm');

// ─── patients ────────────────────────────────────────────────────────────────
const patients = pgTable('patients', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  name: text('name').notNull(),
  email: text('email').unique(),
  date_of_birth: date('date_of_birth'),
  phone: text('phone'),
  billing_address: jsonb('billing_address'),
  shipping_address: jsonb('shipping_address'),
  usdc_wallet: text('usdc_wallet'),
  stripe_customer_id: text('stripe_customer_id'),
  requires_prescription: boolean('requires_prescription').default(false),
  active_prescription_id: uuid('active_prescription_id'),
  password_hash: text('password_hash'),
  portal_enabled: boolean('portal_enabled').notNull().default(false),
  created_at: timestamp('created_at', { withTimezone: true }).default(sql`now()`),
  updated_at: timestamp('updated_at', { withTimezone: true }).default(sql`now()`),
});

// ─── admin_users ──────────────────────────────────────────────────────────────
const admin_users = pgTable('admin_users', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  email: text('email').unique().notNull(),
  password_hash: text('password_hash').notNull(),
  name: text('name').notNull(),
  role: text('role').notNull().default('worker'), // 'admin' | 'worker'
  created_at: timestamp('created_at', { withTimezone: true }).default(sql`now()`),
});

// ─── products ─────────────────────────────────────────────────────────────────
const products = pgTable('products', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  sku: text('sku').unique().notNull(),
  name: text('name').notNull(),
  unit_price: numeric('unit_price', { precision: 10, scale: 2 }).notNull(),
  unit: text('unit'),
  active: boolean('active').default(true),
  created_at: timestamp('created_at', { withTimezone: true }).default(sql`now()`),
});

// ─── sales_orders ─────────────────────────────────────────────────────────────
const sales_orders = pgTable('sales_orders', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  order_number: text('order_number').unique().notNull(),
  patient_id: uuid('patient_id').notNull().references(() => patients.id),
  status: text('status').notNull().default('draft'),
  notes: text('notes'),
  // Saved FedEx rate quote — included in invoice when present
  // { service_type, package_type, weight_lbs, length_in, width_in, height_in,
  //   net_charge, currency, transit_days, delivery_date, quoted_at }
  shipping_quote: jsonb('shipping_quote'),
  created_at: timestamp('created_at', { withTimezone: true }).default(sql`now()`),
  updated_at: timestamp('updated_at', { withTimezone: true }).default(sql`now()`),
});

// ─── order_items ──────────────────────────────────────────────────────────────
const order_items = pgTable('order_items', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  order_id: uuid('order_id').notNull().references(() => sales_orders.id),
  product_id: uuid('product_id').notNull().references(() => products.id),
  quantity: integer('quantity').notNull(),
  unit_price: numeric('unit_price', { precision: 10, scale: 2 }).notNull(),
  line_total: numeric('line_total', { precision: 10, scale: 2 }).notNull(),
});

// ─── invoices ─────────────────────────────────────────────────────────────────
const invoices = pgTable('invoices', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  invoice_number: text('invoice_number').unique().notNull(),
  order_id: uuid('order_id').unique().notNull().references(() => sales_orders.id),
  subtotal: numeric('subtotal', { precision: 10, scale: 2 }).notNull(),
  shipping_charge: numeric('shipping_charge', { precision: 10, scale: 2 }).default('0'),
  processing_fee: numeric('processing_fee', { precision: 10, scale: 2 }).default('0'),
  total: numeric('total', { precision: 10, scale: 2 }).notNull(),
  pay_method: text('pay_method'),
  pay_status: text('pay_status').notNull().default('pending'),
  stripe_payment_intent_id: text('stripe_payment_intent_id'),
  usdc_tx_hash: text('usdc_tx_hash'),
  paid_at: timestamp('paid_at', { withTimezone: true }),
  due_date: date('due_date'),
  pdf_url: text('pdf_url'),
  sent_at: timestamp('sent_at', { withTimezone: true }),
  pay_token: text('pay_token').unique(),
  pay_token_expires_at: timestamp('pay_token_expires_at', { withTimezone: true }),
  created_at: timestamp('created_at', { withTimezone: true }).default(sql`now()`),
});

// ─── shipments ────────────────────────────────────────────────────────────────
const shipments = pgTable('shipments', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  order_id: uuid('order_id').unique().notNull().references(() => sales_orders.id),
  fedex_tracking_number: text('fedex_tracking_number'),
  service_type: text('service_type'),
  weight_lbs: numeric('weight_lbs', { precision: 6, scale: 2 }),
  dimensions_json: jsonb('dimensions_json'),
  label_pdf_url: text('label_pdf_url'),
  ship_date: date('ship_date'),
  estimated_delivery: date('estimated_delivery'),
  status: text('status').default('label_created'),
  last_polled_at: timestamp('last_polled_at', { withTimezone: true }),
  polling_active: boolean('polling_active').default(true),
  latest_status: text('latest_status'),
  exception_flag: boolean('exception_flag').default(false),
  raw_import_id: text('raw_import_id'),
  created_at: timestamp('created_at', { withTimezone: true }).default(sql`now()`),
});

// ─── shipment_events ──────────────────────────────────────────────────────────
const shipment_events = pgTable('shipment_events', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  shipment_id: uuid('shipment_id').notNull().references(() => shipments.id),
  event_code: text('event_code'),
  event_description: text('event_description'),
  event_timestamp: timestamp('event_timestamp', { withTimezone: true }),
  location_city: text('location_city'),
  location_state: text('location_state'),
  location_country: text('location_country'),
  raw_json: jsonb('raw_json'),
  created_at: timestamp('created_at', { withTimezone: true }).default(sql`now()`),
});

// ─── reminder_rules ───────────────────────────────────────────────────────────
const reminder_rules = pgTable('reminder_rules', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  patient_id: uuid('patient_id').notNull().references(() => patients.id),
  product_id: uuid('product_id').notNull().references(() => products.id),
  interval_days: integer('interval_days').notNull(),
  // Dosage fields — used to calculate days supply and next refill date
  dosage_mg: numeric('dosage_mg', { precision: 8, scale: 2 }),          // mg per dose
  dosage_freq: text('dosage_freq'),                                      // 'daily' | 'weekly'
  doses_per_freq: numeric('doses_per_freq', { precision: 4, scale: 2 }).default('1'), // doses per day/week
  last_fill_qty_mg: numeric('last_fill_qty_mg', { precision: 10, scale: 2 }), // total mg last filled
  last_fill_date: date('last_fill_date'),                                // date of last fill
  last_reminded_at: timestamp('last_reminded_at', { withTimezone: true }),
  last_order_id: uuid('last_order_id').references(() => sales_orders.id),
  active: boolean('active').default(true),
  created_at: timestamp('created_at', { withTimezone: true }).default(sql`now()`),
});

// ─── reminder_logs ────────────────────────────────────────────────────────────
const reminder_logs = pgTable('reminder_logs', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  rule_id: uuid('rule_id').notNull().references(() => reminder_rules.id),
  sent_at: timestamp('sent_at', { withTimezone: true }).default(sql`now()`),
  triggered_order_id: uuid('triggered_order_id').references(() => sales_orders.id),
  channel: text('channel').default('email'),
});

// ─── prescriptions ────────────────────────────────────────────────────────────
const prescriptions = pgTable('prescriptions', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  patient_id: uuid('patient_id').notNull().references(() => patients.id),
  prescribing_doctor: text('prescribing_doctor').notNull(),
  doctor_phone: text('doctor_phone'),
  doctor_npi: text('doctor_npi'),
  issue_date: date('issue_date').notNull(),
  expiry_date: date('expiry_date'),
  file_path: text('file_path').notNull(),
  file_name: text('file_name').notNull(),
  file_mime: text('file_mime').notNull(),
  file_size_bytes: integer('file_size_bytes'),
  notes: text('notes'),
  status: text('status').notNull().default('active'),
  uploaded_by: uuid('uploaded_by').references(() => admin_users.id),
  created_at: timestamp('created_at', { withTimezone: true }).default(sql`now()`),
});

// ─── patient_contacts ─────────────────────────────────────────────────────────
const patient_contacts = pgTable('patient_contacts', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  patient_id: uuid('patient_id').notNull().references(() => patients.id),
  relationship: text('relationship').notNull(),
  first_name: text('first_name').notNull(),
  last_name: text('last_name').notNull(),
  phone: text('phone'),
  email: text('email'),
  is_primary: boolean('is_primary').default(false),
  receives_notifications: boolean('receives_notifications').default(false),
  notes: text('notes'),
  created_at: timestamp('created_at', { withTimezone: true }).default(sql`now()`),
});

// ─── app_settings ─────────────────────────────────────────────────────────────
const app_settings = pgTable('app_settings', {
  key: text('key').primaryKey(),
  value: text('value'),
  updated_at: timestamp('updated_at', { withTimezone: true }).default(sql`now()`),
});

module.exports = {
  app_settings,
  patients,
  admin_users,
  products,
  sales_orders,
  order_items,
  invoices,
  shipments,
  shipment_events,
  reminder_rules,
  reminder_logs,
  prescriptions,
  patient_contacts,
};
