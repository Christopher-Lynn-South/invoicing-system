const { z } = require('zod');

function validate(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({
        error: 'VALIDATION_ERROR',
        details: result.error.flatten(),
      });
    }
    req.validated = result.data;
    next();
  };
}

// ─── Schemas ──────────────────────────────────────────────────────────────────

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const patientSchema = z.object({
  name: z.string().min(1),
  email: z.string().email().optional(),
  date_of_birth: z.string().optional(),
  phone: z.string().optional(),
  billing_address: z.object({
    street: z.string().optional(),
    city: z.string().optional(),
    state: z.string().optional(),
    zip: z.string().optional(),
    country: z.string().optional(),
  }).optional(),
  usdc_wallet: z.string().optional(),
  requires_prescription: z.boolean().optional(),
});

const productSchema = z.object({
  sku: z.string().min(1),
  name: z.string().min(1),
  unit_price: z.number().positive(),
  unit: z.string().optional(),
  active: z.boolean().optional(),
});

const orderItemSchema = z.object({
  product_id: z.string().uuid(),
  quantity: z.number().int().positive(),
});

const orderSchema = z.object({
  patient_id: z.string().uuid(),
  items: z.array(orderItemSchema).min(1),
  notes: z.string().optional(),
});

const payIntentSchema = z.object({
  method: z.enum(['stripe_cc', 'ach', 'usdc']),
});

const usdcConfirmSchema = z.object({
  tx_hash: z.string().min(1),
});

const shipSchema = z.object({
  service: z.string().min(1),
  box_type: z.enum(['FEDEX_LARGE_BOX', 'FEDEX_EXTRA_LARGE_BOX']),
  weight_lbs: z.number().positive(),
  recipient_name: z.string().optional(),
  recipient_street: z.string().optional(),
  recipient_city: z.string().optional(),
  recipient_state: z.string().optional(),
  recipient_zip: z.string().optional(),
  recipient_country: z.string().optional(),
});

const reminderSchema = z.object({
  patient_id: z.string().uuid(),
  product_id: z.string().uuid(),
  interval_days: z.number().int().positive(),
});

const prescriptionSchema = z.object({
  prescribing_doctor: z.string().min(1),
  doctor_phone: z.string().optional(),
  doctor_npi: z.string().optional(),
  issue_date: z.string().min(1),
  expiry_date: z.string().optional(),
  notes: z.string().optional(),
});

const contactSchema = z.object({
  relationship: z.enum(['parent', 'guardian', 'emergency', 'caregiver', 'authorized_rep', 'spouse', 'other']),
  first_name: z.string().min(1),
  last_name: z.string().min(1),
  phone: z.string().optional(),
  email: z.string().email().optional().or(z.literal('')),
  is_primary: z.boolean().optional(),
  receives_notifications: z.boolean().optional(),
  notes: z.string().optional(),
});

module.exports = {
  validate,
  loginSchema,
  patientSchema,
  productSchema,
  orderSchema,
  payIntentSchema,
  usdcConfirmSchema,
  shipSchema,
  reminderSchema,
  prescriptionSchema,
  contactSchema,
};
