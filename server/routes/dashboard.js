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

// GET /api/dashboard/analytics — deeper business metrics
router.get('/analytics', requireLogin, async (req, res) => {
  try {
    // Monthly revenue, last 12 months (paid invoices)
    const revRes = await db.execute(sql`
      SELECT to_char(date_trunc('month', paid_at), 'YYYY-MM') AS month,
             SUM(total::numeric)::numeric(12,2) AS revenue,
             COUNT(*)::int AS invoices
      FROM invoices
      WHERE pay_status = 'paid' AND paid_at IS NOT NULL AND deleted_at IS NULL
        AND paid_at > NOW() - INTERVAL '12 months'
      GROUP BY 1 ORDER BY 1
    `);

    // Refill adherence: of refill requests resolved in the last 90 days,
    // how many were confirmed (vs declined/expired)?
    const adherenceRes = await db.execute(sql`
      SELECT
        COUNT(*) FILTER (WHERE status = 'confirmed')::int AS confirmed,
        COUNT(*) FILTER (WHERE status IN ('declined','expired'))::int AS missed
      FROM refill_requests
      WHERE created_at > NOW() - INTERVAL '90 days' AND status <> 'pending'
    `);

    // Top products by paid revenue (last 12 months)
    const topRes = await db.execute(sql`
      SELECT p.name, SUM(oi.line_total::numeric)::numeric(12,2) AS revenue,
             SUM(oi.quantity)::int AS units
      FROM order_items oi
      JOIN products p ON p.id = oi.product_id
      JOIN invoices i ON i.order_id = oi.order_id
      WHERE i.pay_status = 'paid' AND i.deleted_at IS NULL
        AND i.paid_at > NOW() - INTERVAL '12 months'
      GROUP BY p.name ORDER BY revenue DESC LIMIT 8
    `);

    // Churn risk: active rules overdue by more than half their interval
    const churnRes = await db.execute(sql`
      SELECT pt.id AS patient_id, pt.name AS patient_name, pr.name AS product_name,
             rr.interval_days,
             (CURRENT_DATE - COALESCE(s.delivered_at, rr.last_fill_date, so.created_at::date)) AS days_since_last,
             rr.escalated_at IS NOT NULL AS escalated
      FROM reminder_rules rr
      JOIN patients pt ON pt.id = rr.patient_id AND pt.deleted_at IS NULL
      JOIN products pr ON pr.id = rr.product_id
      LEFT JOIN sales_orders so ON so.id = rr.last_order_id
      LEFT JOIN shipments s ON s.order_id = rr.last_order_id
      WHERE rr.active = TRUE
        AND COALESCE(s.delivered_at, rr.last_fill_date, so.created_at::date) IS NOT NULL
        AND (CURRENT_DATE - COALESCE(s.delivered_at, rr.last_fill_date, so.created_at::date))
              > (rr.interval_days * 1.5)
      ORDER BY days_since_last DESC
      LIMIT 20
    `);

    // Autopay adoption
    const autopayRes = await db.execute(sql`
      SELECT COUNT(*) FILTER (WHERE autopay)::int AS enabled,
             COUNT(*)::int AS total
      FROM reminder_rules WHERE active = TRUE
    `);

    const rows = r => r.rows || r;
    const adh = rows(adherenceRes)[0] || { confirmed: 0, missed: 0 };
    const totalResolved = (adh.confirmed || 0) + (adh.missed || 0);

    return res.json({
      monthly_revenue: rows(revRes),
      adherence: {
        confirmed: adh.confirmed || 0,
        missed: adh.missed || 0,
        rate: totalResolved > 0 ? Math.round((adh.confirmed / totalResolved) * 100) : null,
      },
      top_products: rows(topRes),
      churn_risk: rows(churnRes),
      autopay: rows(autopayRes)[0] || { enabled: 0, total: 0 },
    });
  } catch (err) {
    console.error('Analytics error:', err);
    return res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

module.exports = router;
