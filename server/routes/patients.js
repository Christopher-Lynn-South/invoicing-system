const express = require('express');
const { db } = require('../db');
const { patients, sales_orders, prescriptions, patient_contacts, patient_shipping_addresses } = require('../db/schema');
const { eq, desc, and, isNull, inArray } = require('drizzle-orm');
const { requireLogin } = require('../middleware/auth');
const { validate, patientSchema, prescriptionSchema, contactSchema } = require('../middleware/validate');
const { z } = require('zod');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const router = express.Router();

const COUNTRY_MAP = {
  'united states': 'US', 'united states of america': 'US', 'usa': 'US', 'u.s.a.': 'US', 'u.s.': 'US',
  'mexico': 'MX', 'méxico': 'MX', 'mex': 'MX',
  'canada': 'CA', 'united kingdom': 'GB', 'uk': 'GB',
  'spain': 'ES', 'españa': 'ES', 'germany': 'DE', 'france': 'FR',
};

function normalizeAddress(addr) {
  if (!addr) return addr;
  const country = addr.country?.trim();
  if (!country) return addr;
  const normalized = COUNTRY_MAP[country.toLowerCase()];
  return normalized ? { ...addr, country: normalized } : addr;
}

function normalizePatient(data) {
  const result = { ...data };
  if (result.billing_address)  result.billing_address  = normalizeAddress(result.billing_address);
  if (result.shipping_address) result.shipping_address = normalizeAddress(result.shipping_address);
  return result;
}

const ALLOWED_MIME = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/tiff'];
const RX_BASE = process.env.RX_STORAGE_PATH || '/var/orderflow/prescriptions';

const rxStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(RX_BASE, req.params.id);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${uuidv4()}${ext}`);
  },
});

const upload = multer({
  storage: rxStorage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    cb(null, ALLOWED_MIME.includes(file.mimetype));
  },
});

// ─── Patients CRUD ────────────────────────────────────────────────────────────

// GET /api/patients
router.get('/', requireLogin, async (req, res) => {
  try {
    const rows = await db.select().from(patients)
      .where(isNull(patients.deleted_at))
      .orderBy(desc(patients.created_at));
    return res.json(rows);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

// DELETE /api/patients/:id  (soft delete)
router.delete('/:id', requireLogin, async (req, res) => {
  try {
    const [row] = await db.select({ id: patients.id }).from(patients)
      .where(and(eq(patients.id, req.params.id), isNull(patients.deleted_at))).limit(1);
    if (!row) return res.status(404).json({ error: 'NOT_FOUND' });
    await db.update(patients).set({ deleted_at: new Date() }).where(eq(patients.id, req.params.id));
    return res.json({ ok: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

// POST /api/patients/bulk-delete  (soft delete multiple)
router.post('/bulk-delete', requireLogin, async (req, res) => {
  try {
    const ids = req.body.ids;
    if (!Array.isArray(ids) || ids.length === 0)
      return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'ids must be a non-empty array' });
    await db.update(patients).set({ deleted_at: new Date() })
      .where(and(inArray(patients.id, ids), isNull(patients.deleted_at)));
    return res.json({ ok: true, deleted: ids.length });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

// POST /api/patients
router.post('/', requireLogin, validate(patientSchema), async (req, res) => {
  try {
    const [row] = await db.insert(patients).values(normalizePatient(req.validated)).returning();
    return res.status(201).json(row);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'DUPLICATE_EMAIL', message: 'Email already exists.' });
    }
    console.error(err);
    return res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

// GET /api/patients/:id
router.get('/:id', requireLogin, async (req, res) => {
  try {
    const [patient] = await db.select().from(patients).where(eq(patients.id, req.params.id));
    if (!patient) return res.status(404).json({ error: 'NOT_FOUND' });

    const orders = await db.select().from(sales_orders)
      .where(eq(sales_orders.patient_id, req.params.id))
      .orderBy(desc(sales_orders.created_at));

    const contacts = await db.select().from(patient_contacts)
      .where(eq(patient_contacts.patient_id, req.params.id));

    return res.json({ ...patient, orders, contacts });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

// PUT /api/patients/:id
router.put('/:id', requireLogin, validate(patientSchema.partial()), async (req, res) => {
  try {
    const [row] = await db.update(patients)
      .set({ ...normalizePatient(req.validated), updated_at: new Date() })
      .where(eq(patients.id, req.params.id))
      .returning();
    if (!row) return res.status(404).json({ error: 'NOT_FOUND' });
    return res.json(row);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

// ─── Prescriptions ────────────────────────────────────────────────────────────

// GET /api/patients/:id/prescriptions
router.get('/:id/prescriptions', requireLogin, async (req, res) => {
  try {
    const rows = await db.select().from(prescriptions)
      .where(eq(prescriptions.patient_id, req.params.id))
      .orderBy(desc(prescriptions.created_at));
    return res.json(rows);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

// POST /api/patients/:id/prescriptions
router.post('/:id/prescriptions', requireLogin, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'FILE_REQUIRED' });
    const body = {
      prescribing_doctor: req.body.prescribing_doctor,
      doctor_phone: req.body.doctor_phone,
      doctor_npi: req.body.doctor_npi,
      issue_date: req.body.issue_date,
      expiry_date: req.body.expiry_date || null,
      notes: req.body.notes,
    };
    const parsed = prescriptionSchema.safeParse(body);
    if (!parsed.success) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: 'VALIDATION_ERROR', details: parsed.error.flatten() });
    }
    const [row] = await db.insert(prescriptions).values({
      patient_id: req.params.id,
      ...parsed.data,
      file_path: req.file.path,
      file_name: req.file.originalname,
      file_mime: req.file.mimetype,
      file_size_bytes: req.file.size,
      uploaded_by: req.session.adminId,
    }).returning();
    return res.status(201).json(row);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

// GET /api/patients/:id/prescriptions/:rxId
router.get('/:id/prescriptions/:rxId', requireLogin, async (req, res) => {
  try {
    const [row] = await db.select().from(prescriptions)
      .where(eq(prescriptions.id, req.params.rxId));
    if (!row || row.patient_id !== req.params.id) return res.status(404).json({ error: 'NOT_FOUND' });
    return res.json(row);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

// GET /api/patients/:id/prescriptions/:rxId/file
router.get('/:id/prescriptions/:rxId/file', requireLogin, async (req, res) => {
  try {
    const [row] = await db.select().from(prescriptions)
      .where(eq(prescriptions.id, req.params.rxId));
    if (!row || row.patient_id !== req.params.id) return res.status(404).json({ error: 'NOT_FOUND' });
    if (!fs.existsSync(row.file_path)) return res.status(404).json({ error: 'FILE_NOT_FOUND' });

    const disposition = req.query.download === '1' ? 'attachment' : 'inline';
    res.setHeader('Content-Type', row.file_mime);
    res.setHeader('Content-Disposition', `${disposition}; filename="${row.file_name}"`);
    fs.createReadStream(row.file_path).pipe(res);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

// PUT /api/patients/:id/prescriptions/:rxId
router.put('/:id/prescriptions/:rxId', requireLogin, async (req, res) => {
  try {
    const allowed = ['prescribing_doctor', 'doctor_phone', 'doctor_npi', 'notes', 'status', 'expiry_date'];
    const update = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) update[key] = req.body[key];
    }
    // Ownership check: prescription must belong to this patient.
    const [row] = await db.update(prescriptions).set(update)
      .where(and(
        eq(prescriptions.id, req.params.rxId),
        eq(prescriptions.patient_id, req.params.id),
      ))
      .returning();
    if (!row) return res.status(404).json({ error: 'NOT_FOUND' });
    return res.json(row);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

// DELETE /api/patients/:id/prescriptions/:rxId (soft delete)
router.delete('/:id/prescriptions/:rxId', requireLogin, async (req, res) => {
  try {
    const [row] = await db.update(prescriptions).set({ status: 'superseded' })
      .where(and(
        eq(prescriptions.id, req.params.rxId),
        eq(prescriptions.patient_id, req.params.id),
      ))
      .returning();
    if (!row) return res.status(404).json({ error: 'NOT_FOUND' });
    return res.json({ ok: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

// ─── Contacts ─────────────────────────────────────────────────────────────────

// GET /api/patients/:id/contacts
router.get('/:id/contacts', requireLogin, async (req, res) => {
  try {
    const rows = await db.select().from(patient_contacts)
      .where(eq(patient_contacts.patient_id, req.params.id));
    return res.json(rows);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

// POST /api/patients/:id/contacts
router.post('/:id/contacts', requireLogin, validate(contactSchema), async (req, res) => {
  try {
    const data = { patient_id: req.params.id, ...req.validated };
    // enforce only one primary per patient
    if (data.is_primary) {
      await db.update(patient_contacts)
        .set({ is_primary: false })
        .where(eq(patient_contacts.patient_id, req.params.id));
    }
    const [row] = await db.insert(patient_contacts).values(data).returning();
    return res.status(201).json(row);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

// PUT /api/patients/:id/contacts/:contactId
router.put('/:id/contacts/:contactId', requireLogin, validate(contactSchema.partial()), async (req, res) => {
  try {
    // Verify contact belongs to this patient before doing anything else.
    const [existing] = await db.select({ id: patient_contacts.id }).from(patient_contacts)
      .where(and(
        eq(patient_contacts.id, req.params.contactId),
        eq(patient_contacts.patient_id, req.params.id),
      )).limit(1);
    if (!existing) return res.status(404).json({ error: 'NOT_FOUND' });

    if (req.validated.is_primary) {
      await db.update(patient_contacts)
        .set({ is_primary: false })
        .where(eq(patient_contacts.patient_id, req.params.id));
    }
    const [row] = await db.update(patient_contacts).set(req.validated)
      .where(and(
        eq(patient_contacts.id, req.params.contactId),
        eq(patient_contacts.patient_id, req.params.id),
      ))
      .returning();
    if (!row) return res.status(404).json({ error: 'NOT_FOUND' });
    return res.json(row);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

// DELETE /api/patients/:id/contacts/:contactId
router.delete('/:id/contacts/:contactId', requireLogin, async (req, res) => {
  try {
    const result = await db.delete(patient_contacts)
      .where(and(
        eq(patient_contacts.id, req.params.contactId),
        eq(patient_contacts.patient_id, req.params.id),
      ))
      .returning({ id: patient_contacts.id });
    if (!result.length) return res.status(404).json({ error: 'NOT_FOUND' });
    return res.json({ ok: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

// ─── Shipping Addresses (admin) ───────────────────────────────────────────────

// GET /api/patients/:id/shipping-addresses
router.get('/:id/shipping-addresses', requireLogin, async (req, res) => {
  try {
    const rows = await db.select()
      .from(patient_shipping_addresses)
      .where(eq(patient_shipping_addresses.patient_id, req.params.id))
      .orderBy(desc(patient_shipping_addresses.is_default), patient_shipping_addresses.created_at);
    return res.json(rows);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

const adminShippingAddrSchema = z.object({
  label:   z.string().min(1).max(50).default('Home'),
  street:  z.string().min(1).max(200),
  street2: z.string().max(200).optional(),
  city:    z.string().min(1).max(100),
  state:   z.string().min(1).max(2),
  zip:     z.string().min(1).max(20),
}).strict();

const adminShippingAddrUpdateSchema = z.object({
  label:   z.string().min(1).max(50).optional(),
  street:  z.string().min(1).max(200).optional(),
  street2: z.string().max(200).optional().nullable(),
  city:    z.string().min(1).max(100).optional(),
  state:   z.string().min(1).max(2).optional(),
  zip:     z.string().min(1).max(20).optional(),
}).strict();

// PATCH /api/patients/:id/shipping-addresses/:addrId
router.patch('/:id/shipping-addresses/:addrId', requireLogin, async (req, res) => {
  try {
    const parsed = adminShippingAddrUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'VALIDATION_ERROR', message: parsed.error.errors[0].message });
    }

    const [addr] = await db.select().from(patient_shipping_addresses)
      .where(and(
        eq(patient_shipping_addresses.id, req.params.addrId),
        eq(patient_shipping_addresses.patient_id, req.params.id),
      )).limit(1);
    if (!addr) return res.status(404).json({ error: 'NOT_FOUND' });

    const body = parsed.data;
    const updates = {};
    if (body.label   !== undefined) updates.label   = body.label.trim();
    if (body.street  !== undefined) updates.street  = body.street.trim();
    if (body.street2 !== undefined) updates.street2 = body.street2?.trim() || null;
    if (body.city    !== undefined) updates.city    = body.city.trim();
    if (body.state   !== undefined) updates.state   = body.state.trim().toUpperCase();
    if (body.zip     !== undefined) updates.zip     = body.zip.trim();

    const [updated] = await db.update(patient_shipping_addresses)
      .set(updates)
      .where(eq(patient_shipping_addresses.id, addr.id))
      .returning();

    // If default, sync to patients.shipping_address
    if (updated.is_default) {
      await db.update(patients).set({
        shipping_address: { street: updated.street, street2: updated.street2 || undefined, city: updated.city, state: updated.state, zip: updated.zip, country: updated.country },
        updated_at: new Date(),
      }).where(eq(patients.id, req.params.id));
    }

    return res.json(updated);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

// DELETE /api/patients/:id/shipping-addresses/:addrId
router.delete('/:id/shipping-addresses/:addrId', requireLogin, async (req, res) => {
  try {
    const [addr] = await db.select().from(patient_shipping_addresses)
      .where(and(
        eq(patient_shipping_addresses.id, req.params.addrId),
        eq(patient_shipping_addresses.patient_id, req.params.id),
      )).limit(1);
    if (!addr) return res.status(404).json({ error: 'NOT_FOUND' });

    const all = await db.select().from(patient_shipping_addresses)
      .where(eq(patient_shipping_addresses.patient_id, req.params.id));
    const remaining = all.filter(a => a.id !== addr.id);

    await db.delete(patient_shipping_addresses)
      .where(eq(patient_shipping_addresses.id, addr.id));

    // If deleted was default, promote oldest remaining to default
    if (addr.is_default && remaining.length > 0) {
      const oldest = remaining.sort((a, b) => new Date(a.created_at) - new Date(b.created_at))[0];
      await db.update(patient_shipping_addresses)
        .set({ is_default: true })
        .where(eq(patient_shipping_addresses.id, oldest.id));
      await db.update(patients).set({
        shipping_address: { street: oldest.street, street2: oldest.street2 || undefined, city: oldest.city, state: oldest.state, zip: oldest.zip, country: oldest.country },
        updated_at: new Date(),
      }).where(eq(patients.id, req.params.id));
    } else if (remaining.length === 0) {
      // No addresses left — clear the JSONB field
      await db.update(patients).set({ shipping_address: null, updated_at: new Date() })
        .where(eq(patients.id, req.params.id));
    }

    return res.json({ ok: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

// POST /api/patients/:id/shipping-addresses/:addrId/set-default
router.post('/:id/shipping-addresses/:addrId/set-default', requireLogin, async (req, res) => {
  try {
    const [addr] = await db.select().from(patient_shipping_addresses)
      .where(and(
        eq(patient_shipping_addresses.id, req.params.addrId),
        eq(patient_shipping_addresses.patient_id, req.params.id),
      )).limit(1);
    if (!addr) return res.status(404).json({ error: 'NOT_FOUND' });

    // Clear all defaults, set this one
    await db.update(patient_shipping_addresses)
      .set({ is_default: false })
      .where(eq(patient_shipping_addresses.patient_id, req.params.id));
    const [updated] = await db.update(patient_shipping_addresses)
      .set({ is_default: true })
      .where(eq(patient_shipping_addresses.id, addr.id))
      .returning();

    // Sync to patients.shipping_address
    await db.update(patients).set({
      shipping_address: { street: updated.street, street2: updated.street2 || undefined, city: updated.city, state: updated.state, zip: updated.zip, country: updated.country },
      updated_at: new Date(),
    }).where(eq(patients.id, req.params.id));

    return res.json(updated);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

// POST /api/patients/:id/shipping-addresses
router.post('/:id/shipping-addresses', requireLogin, async (req, res) => {
  try {
    const parsed = adminShippingAddrSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'VALIDATION_ERROR', message: parsed.error.errors[0].message });
    }

    const [patient] = await db.select({ id: patients.id }).from(patients).where(eq(patients.id, req.params.id)).limit(1);
    if (!patient) return res.status(404).json({ error: 'NOT_FOUND' });

    const existing = await db.select({ id: patient_shipping_addresses.id })
      .from(patient_shipping_addresses)
      .where(eq(patient_shipping_addresses.patient_id, req.params.id));
    const isFirst = existing.length === 0;

    const { label, street, street2, city, state, zip } = parsed.data;
    const [row] = await db.insert(patient_shipping_addresses).values({
      patient_id: req.params.id,
      label:      label.trim(),
      street:     street.trim(),
      street2:    street2 ? street2.trim() : null,
      city:       city.trim(),
      state:      state.trim().toUpperCase(),
      zip:        zip.trim(),
      country:    'US',
      is_default: isFirst,
    }).returning();

    // If first address, sync to patients.shipping_address for FedEx compatibility
    if (isFirst) {
      await db.update(patients).set({
        shipping_address: { street: row.street, street2: row.street2 || undefined, city: row.city, state: row.state, zip: row.zip, country: row.country },
        updated_at: new Date(),
      }).where(eq(patients.id, req.params.id));
    }

    return res.status(201).json(row);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

module.exports = router;
