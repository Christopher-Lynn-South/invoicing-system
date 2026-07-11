const express = require('express');
const { db } = require('../db');
const { products } = require('../db/schema');
const { eq, desc } = require('drizzle-orm');
const { requireLogin } = require('../middleware/auth');
const { validate, productSchema } = require('../middleware/validate');

const router = express.Router();

// GET /api/products
router.get('/', requireLogin, async (req, res) => {
  try {
    const rows = await db.select().from(products)
      .where(eq(products.active, true))
      .orderBy(products.name);
    return res.json(rows);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

// POST /api/products
router.post('/', requireLogin, validate(productSchema), async (req, res) => {
  try {
    const [row] = await db.insert(products).values(req.validated).returning();
    return res.status(201).json(row);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'DUPLICATE_SKU', message: 'SKU already exists.' });
    }
    console.error(err);
    return res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

// GET /api/products/:id
router.get('/:id', requireLogin, async (req, res) => {
  try {
    const [row] = await db.select().from(products).where(eq(products.id, req.params.id));
    if (!row) return res.status(404).json({ error: 'NOT_FOUND' });
    return res.json(row);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

// PUT /api/products/:id
router.put('/:id', requireLogin, validate(productSchema.partial()), async (req, res) => {
  try {
    const [row] = await db.update(products).set(req.validated)
      .where(eq(products.id, req.params.id))
      .returning();
    if (!row) return res.status(404).json({ error: 'NOT_FOUND' });
    return res.json(row);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

module.exports = router;
