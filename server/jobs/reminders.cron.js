const cron = require('node-cron');
const { db } = require('../db');
const { reminder_rules, reminder_logs, patients, products, sales_orders } = require('../db/schema');
const { eq, and } = require('drizzle-orm');
const { sendReminderEmail } = require('../services/mailer');
const axios = require('axios');

async function runReminderJob() {
  const today = new Date().toISOString().split('T')[0];
  console.log(`[Reminders] Running job for ${today}`);

  const rules = await db.select({
    rule: reminder_rules,
    patient: patients,
    product: products,
  })
    .from(reminder_rules)
    .leftJoin(patients, eq(reminder_rules.patient_id, patients.id))
    .leftJoin(products, eq(reminder_rules.product_id, products.id))
    .where(eq(reminder_rules.active, true));

  for (const { rule, patient, product } of rules) {
    try {
      let lastOrderDate = null;
      if (rule.last_order_id) {
        const [order] = await db.select().from(sales_orders).where(eq(sales_orders.id, rule.last_order_id));
        if (order) lastOrderDate = new Date(order.created_at).toISOString().split('T')[0];
      }

      if (!lastOrderDate) continue;

      const next_due = new Date(lastOrderDate);
      next_due.setDate(next_due.getDate() + rule.interval_days);
      const nextDueStr = next_due.toISOString().split('T')[0];

      if (nextDueStr > today) continue;

      // Send email
      await sendReminderEmail(patient, product, rule);

      // Log
      await db.insert(reminder_logs).values({
        rule_id: rule.id,
        channel: 'email',
      });

      // Optional WhatsApp
      if (process.env.ENABLE_WHATSAPP_REMINDERS === 'true') {
        await sendWhatsApp(patient, product, rule);
      }

      // Update last_reminded_at
      await db.update(reminder_rules)
        .set({ last_reminded_at: new Date() })
        .where(eq(reminder_rules.id, rule.id));

      console.log(`[Reminders] Sent reminder for patient ${patient.name}, product ${product.name}`);
    } catch (err) {
      console.error(`[Reminders] Error for rule ${rule.id}:`, err.message);
    }
  }

  console.log('[Reminders] Job complete.');
}

async function sendWhatsApp(patient, product, rule) {
  if (!process.env.WHATSAPP_API_URL) return;
  try {
    await axios.post(process.env.WHATSAPP_API_URL, {
      to: patient.phone,
      message: `Hi ${patient.name}, time to restock ${product.name}! Visit ${process.env.BASE_URL}/reorder/${rule.id}`,
    });
  } catch (err) {
    console.error('[WhatsApp] Send failed:', err.message);
  }
}

// Schedule: 08:00 daily, Mexico City time
function start() {
  cron.schedule('0 8 * * *', runReminderJob, {
    timezone: 'America/Mexico_City',
  });
  console.log('[Reminders] Cron scheduled: 08:00 daily (Mexico City)');
}

module.exports = { start, runReminderJob };
