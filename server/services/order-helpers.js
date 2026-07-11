// Shared helpers for creating simple one-product orders (reorders, autopay,
// SMS-confirmed refills).
const { db } = require('../db');
const { sales_orders, order_items } = require('../db/schema');
const { sql } = require('drizzle-orm');

async function generateOrderNumber() {
  const year = new Date().getFullYear();
  const prefix = `SO-${year}-`;
  const result = await db.execute(sql`
    SELECT order_number FROM sales_orders
    WHERE order_number LIKE ${prefix + '%'}
    ORDER BY (regexp_replace(order_number, '.*-', '')::bigint) DESC
    LIMIT 1
  `);
  const rows = result.rows || result;
  if (!rows.length) return `${prefix}001`;
  return `${prefix}${String(parseInt(rows[0].order_number.split('-').pop(), 10) + 1).padStart(3, '0')}`;
}

/**
 * Create a draft order with a single line item (qty 1).
 * Transactional; retries on order_number collision. Returns the order row.
 */
async function createSimpleOrder({ patient_id, product, notes, shipping_quote }) {
  const unit_price = parseFloat(product.unit_price);
  let order;
  for (let attempt = 0; attempt < 5; attempt++) {
    const order_number = await generateOrderNumber();
    try {
      await db.transaction(async (tx) => {
        [order] = await tx.insert(sales_orders).values({
          order_number,
          patient_id,
          status: 'draft',
          notes: notes || null,
          shipping_quote: shipping_quote || undefined,
        }).returning();
        await tx.insert(order_items).values({
          order_id: order.id,
          product_id: product.id,
          quantity: 1,
          unit_price: unit_price.toFixed(2),
          line_total: unit_price.toFixed(2),
        });
      });
      return order;
    } catch (err) {
      if (err.code !== '23505' || attempt === 4) throw err;
      await new Promise(r => setTimeout(r, 10 + Math.random() * 40));
    }
  }
  return order;
}

module.exports = { generateOrderNumber, createSimpleOrder };
