// Aggregate dashboard statistics — avoids loading full order/invoice tables
// into the client just to count rows.
const express = require('express');
const { db } = require('../db');
const { sales_orders, invoices, reminder_rules, patients } = require('../db/schema');
const { eq, and, sql, isNull } = require('drizzle-orm');
const { requireLogin } = require('../middleware/auth');

const router = express.Router();

// GET /api/dashboard/stats
router.get('/stats', requireLogin, async (req, res) => {
  try {
    // Recent orders — for the widget on the dashboard page
    const recentRows = await db.select({
      order: sales_orders,
      patient_name: patients.name,
    })
      .from(sales_orders)
      .leftJoin(patients, eq(sales_orders.patient_id, patients.id))
      .orderBy(sql`${sales_orders.created_at} DESC`)
      .limit(8);
    const recentOrders = recentRows.map(r => ({ ...r.order, patient_name: r.patient_name }));

    // Revenue: sum of paid invoices (not soft-deleted)
    const [revenueRow] = await db.select({
      total: sql`COALESCE(SUM(total::numeric), 0)::text`,
    }).from(invoices)
      .where(and(eq(invoices.pay_status, 'paid'), isNull(invoices.deleted_at)));

    // Pending invoices
    const [pendingRow] = await db.select({
      cnt: sql`COUNT(*)::int`,
    }).from(invoices)
      .where(and(eq(invoices.pay_status, 'pending'), isNull(invoices.deleted_at)));

    // Shipped orders
    const [shippedRow] = await db.select({
      cnt: sql`COUNT(*)::int`,
    }).from(sales_orders).where(eq(sales_orders.status, 'shipped'));

    // Total orders (all statuses)
    const [totalOrdersRow] = await db.select({
      cnt: sql`COUNT(*)::int`,
    }).from(sales_orders);

    // Overdue reminders = active rules whose (last_fill_date + interval_days)
    // is in the past. Cheap enough to compute inline.
    let overdue = 0;
    try {
      const remRes = await db.execute(sql`
        SELECT COUNT(*)::int AS c FROM reminder_rules
        WHERE active = TRUE
          AND last_fill_date IS NOT NULL
          AND interval_days IS NOT NULL
          AND (last_fill_date + (interval_days * INTERVAL '1 day')) < CURRENT_DATE
      `);
      const remRows = remRes.rows || remRes;
      overdue = Number(remRows[0]?.c || 0);
    } catch (e) { console.error('dashboard overdue calc failed:', e.message); }

    return res.json({
      revenue: parseFloat(revenueRow?.total || '0'),
      pending: pendingRow?.cnt || 0,
      shipped: shippedRow?.cnt || 0,
      overdue,
      total_orders: totalOrdersRow?.cnt || 0,
      recent_orders: recentOrders,
    });
  } catch (err) {
    console.error('Dashboard stats error:', err);
    return res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

module.exports = router;
