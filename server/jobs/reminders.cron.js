const cron = require('node-cron');
const { db } = require('../db');
const {
  reminder_rules, reminder_logs, patients, products, sales_orders,
  shipments, prescriptions, invoices,
} = require('../db/schema');
const { eq, and, gte, lte, isNull, isNotNull, sql } = require('drizzle-orm');
const { sendReminderEmail, sendMail, sendAdminAlert } = require('../services/mailer');
const { sendReminderSMS, sendAutopayNoticeSMS, sendNudgeSMS } = require('../services/sms');
const { chargeAutopayRule } = require('../services/autopay');
const axios = require('axios');

const DAY_MS = 86400000;
const todayStr = () => new Date().toISOString().split('T')[0];

// ─── Refill countdown base date ────────────────────────────────────────────────
// Priority: actual delivery date of the last order's shipment → last_fill_date
// → last order created_at. Returns 'YYYY-MM-DD' or null.
async function countdownBaseDate(rule) {
  if (rule.last_order_id) {
    const [ship] = await db.select({ delivered_at: shipments.delivered_at })
      .from(shipments).where(eq(shipments.order_id, rule.last_order_id)).limit(1);
    if (ship?.delivered_at) return ship.delivered_at;
  }
  if (rule.last_fill_date) return rule.last_fill_date;
  if (rule.last_order_id) {
    const [order] = await db.select({ created_at: sales_orders.created_at })
      .from(sales_orders).where(eq(sales_orders.id, rule.last_order_id)).limit(1);
    if (order) return new Date(order.created_at).toISOString().split('T')[0];
  }
  return null;
}

// Channels already sent for this rule since it became due
async function channelsSentSince(ruleId, sinceDateStr) {
  const logs = await db.select({ channel: reminder_logs.channel })
    .from(reminder_logs)
    .where(and(
      eq(reminder_logs.rule_id, ruleId),
      gte(reminder_logs.sent_at, new Date(sinceDateStr + 'T00:00:00Z')),
    ));
  return new Set(logs.map(l => l.channel));
}

async function logSend(ruleId, channel) {
  await db.insert(reminder_logs).values({ rule_id: ruleId, channel });
}

// ─── Main daily job ────────────────────────────────────────────────────────────
async function runReminderJob() {
  const today = todayStr();
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
      if (!patient || !product) continue;
      if (patient.deleted_at) continue;

      // Customer snooze
      if (rule.snooze_until && rule.snooze_until >= today) continue;

      const base = await countdownBaseDate(rule);
      if (!base) continue;

      const due = new Date(base);
      due.setDate(due.getDate() + rule.interval_days);
      const dueStr = due.toISOString().split('T')[0];
      const daysUntilDue = Math.round((due - new Date(today)) / DAY_MS);
      const daysOverdue = -daysUntilDue;

      // ── Autopay path ─────────────────────────────────────────────────────────
      if (rule.autopay && patient.stripe_default_pm) {
        // Heads-up 3 days out (once per cycle)
        if (daysUntilDue > 0 && daysUntilDue <= 3) {
          const noticedThisCycle = rule.autopay_notice_sent_at &&
            new Date(rule.autopay_notice_sent_at) > new Date(base);
          if (!noticedThisCycle) {
            await sendAutopayNoticeSMS(patient, product, dueStr);
            try {
              await sendMail({
                to: patient.email,
                subject: `Your ${product.name} refill ships soon`,
                html: `<p>Hi ${patient.name},</p>
                  <p>Your <strong>${product.name}</strong> refill will be charged to your saved card and shipped on <strong>${dueStr}</strong>.</p>
                  <p>Need to skip or change the address? <a href="${process.env.BASE_URL}/customer/portal">Manage it in your portal</a> before then.</p>`,
              });
            } catch (e) { console.error('[Autopay] notice email failed:', e.message); }
            await db.update(reminder_rules)
              .set({ autopay_notice_sent_at: new Date() })
              .where(eq(reminder_rules.id, rule.id));
            console.log(`[Autopay] Heads-up sent for ${patient.name} / ${product.name}`);
          }
          continue;
        }

        // Due (or overdue): charge
        if (daysOverdue >= 0) {
          // Skip if we already created an order for this cycle
          const chargedThisCycle = rule.last_order_id && base &&
            rule.last_reminded_at && new Date(rule.last_reminded_at) > due;
          if (!chargedThisCycle) {
            const result = await chargeAutopayRule(rule, patient, product);
            console.log(`[Autopay] Charge for ${patient.name}: ${result.ok ? 'OK' : 'FAILED — ' + result.error}`);
          }
          continue;
        }
        continue;
      }

      // ── Standard reminder + escalation ladder ────────────────────────────────
      if (daysOverdue < 0) continue; // not due yet

      const sent = await channelsSentSince(rule.id, dueStr);

      // Stage 1 (day 0+): preferred channel(s)
      const wantEmail = rule.channel_pref === 'email' || rule.channel_pref === 'both';
      const wantSMS   = rule.channel_pref === 'sms'   || rule.channel_pref === 'both';

      if (wantEmail && !sent.has('email') && patient.email) {
        await sendReminderEmail(patient, product, rule);
        await logSend(rule.id, 'email');
        console.log(`[Reminders] Email → ${patient.name} (${product.name})`);
      }
      if (wantSMS && !sent.has('sms') && patient.phone) {
        await sendReminderSMS(patient, product, rule);
        await logSend(rule.id, 'sms');
        console.log(`[Reminders] SMS → ${patient.name} (${product.name})`);
      }

      // Stage 2 (day 3+): escalate to SMS even if pref was email-only
      if (daysOverdue >= 3 && !sent.has('sms') && patient.phone && !wantSMS) {
        await sendReminderSMS(patient, product, rule);
        await logSend(rule.id, 'sms');
        console.log(`[Reminders] Escalation SMS → ${patient.name}`);
      }

      // Stage 3 (day 7+): flag for staff follow-up (once per cycle)
      if (daysOverdue >= 7) {
        const alreadyEscalated = rule.escalated_at && new Date(rule.escalated_at) > due;
        if (!alreadyEscalated) {
          await db.update(reminder_rules)
            .set({ escalated_at: new Date() })
            .where(eq(reminder_rules.id, rule.id));
          try {
            await sendAdminAlert(
              `Refill overdue ${daysOverdue} days — ${patient.name}`,
              `<p><strong>${patient.name}</strong> hasn't responded to refill reminders for <strong>${product.name}</strong> (due ${dueStr}).</p>
               <p>Email and SMS were sent. Consider calling: ${patient.phone || 'no phone on file'}</p>
               <p><a href="${process.env.BASE_URL}/patients/${patient.id}">Open patient record</a></p>`
            );
          } catch (e) { console.error('[Reminders] admin alert failed:', e.message); }
          console.log(`[Reminders] Escalated to staff: ${patient.name}`);
        }
      }

      // Optional WhatsApp (legacy flag)
      if (process.env.ENABLE_WHATSAPP_REMINDERS === 'true' && !sent.has('whatsapp')) {
        await sendWhatsApp(patient, product, rule);
        await logSend(rule.id, 'whatsapp');
      }

      await db.update(reminder_rules)
        .set({ last_reminded_at: new Date() })
        .where(eq(reminder_rules.id, rule.id));
    } catch (err) {
      console.error(`[Reminders] Error for rule ${rule.id}:`, err.message);
    }
  }

  await runRxExpiryCheck();
  console.log('[Reminders] Job complete.');
}

// ─── Rx expiry notices (30 days out) ──────────────────────────────────────────
async function runRxExpiryCheck() {
  const today = todayStr();
  const cutoff = new Date(Date.now() + 30 * DAY_MS).toISOString().split('T')[0];
  try {
    const rows = await db.select({ rx: prescriptions, patient: patients })
      .from(prescriptions)
      .leftJoin(patients, eq(prescriptions.patient_id, patients.id))
      .where(and(
        eq(prescriptions.status, 'active'),
        isNotNull(prescriptions.expiry_date),
        gte(prescriptions.expiry_date, today),
        lte(prescriptions.expiry_date, cutoff),
        isNull(prescriptions.expiry_notified_at),
      ));

    for (const { rx, patient } of rows) {
      if (!patient) continue;
      try {
        if (patient.email) {
          await sendMail({
            to: patient.email,
            subject: 'Your prescription expires soon',
            html: `<p>Hi ${patient.name},</p>
              <p>Your prescription from Dr. ${rx.prescribing_doctor} expires on <strong>${rx.expiry_date}</strong>.</p>
              <p>To avoid any interruption to your refills, please contact your prescriber for a renewal, or reply to this email and we'll help coordinate it.</p>`,
          });
        }
        await sendAdminAlert(
          `Rx expiring ${rx.expiry_date} — ${patient.name}`,
          `<p>Prescription for <strong>${patient.name}</strong> (Dr. ${rx.prescribing_doctor}) expires <strong>${rx.expiry_date}</strong>.</p>
           <p>Patient has been emailed. Consider contacting the prescriber for a renewal.</p>
           <p><a href="${process.env.BASE_URL}/patients/${rx.patient_id}">Open patient record</a></p>`
        );
        await db.update(prescriptions)
          .set({ expiry_notified_at: new Date() })
          .where(eq(prescriptions.id, rx.id));
        console.log(`[RxExpiry] Notified ${patient.name} (expires ${rx.expiry_date})`);
      } catch (e) {
        console.error(`[RxExpiry] Failed for rx ${rx.id}:`, e.message);
      }
    }
  } catch (err) {
    console.error('[RxExpiry] Check failed:', err.message);
  }
}

// ─── Abandoned checkout nudges (hourly) ────────────────────────────────────────
// Invoice was viewed 24h+ ago, still pending, never nudged → gentle reminder.
async function runNudgeJob() {
  try {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const rows = await db.select().from(invoices)
      .where(and(
        eq(invoices.pay_status, 'pending'),
        isNull(invoices.deleted_at),
        isNull(invoices.nudge_sent_at),
        isNotNull(invoices.viewed_at),
        lte(invoices.viewed_at, cutoff),
      ));

    for (const invoice of rows) {
      try {
        const [order] = await db.select().from(sales_orders).where(eq(sales_orders.id, invoice.order_id));
        if (!order) continue;
        const [patient] = await db.select().from(patients).where(eq(patients.id, order.patient_id));
        if (!patient) continue;

        const payUrl = invoice.pay_token
          ? `${process.env.BASE_URL}/pay/t/${invoice.pay_token}`
          : `${process.env.BASE_URL}/pay/${invoice.id}`;

        if (patient.email) {
          await sendMail({
            to: patient.email,
            subject: `Still there? Invoice ${invoice.invoice_number} is waiting`,
            html: `<p>Hi ${patient.name},</p>
              <p>We noticed you started but didn't finish paying invoice <strong>${invoice.invoice_number}</strong>
              ($${parseFloat(invoice.total).toFixed(2)}).</p>
              <p style="margin:20px 0"><a href="${payUrl}" style="background:#4f46e5;color:#fff;padding:12px 26px;border-radius:8px;text-decoration:none;font-weight:600">Complete Payment</a></p>
              <p style="font-size:12px;color:#6b7280">Questions? Just reply to this email.</p>`,
          });
        }
        await sendNudgeSMS(patient, invoice);

        await db.update(invoices)
          .set({ nudge_sent_at: new Date() })
          .where(eq(invoices.id, invoice.id));
        console.log(`[Nudge] Sent for invoice ${invoice.invoice_number}`);
      } catch (e) {
        console.error(`[Nudge] Failed for invoice ${invoice.id}:`, e.message);
      }
    }
  } catch (err) {
    console.error('[Nudge] Job failed:', err.message);
  }
}

async function sendWhatsApp(patient, product, rule) {
  if (!process.env.WHATSAPP_API_URL || !patient.phone) return;
  try {
    await axios.post(process.env.WHATSAPP_API_URL, {
      to: patient.phone,
      message: `Hi ${patient.name}, time to restock ${product.name}! Visit ${process.env.BASE_URL}/reorder/${rule.id}`,
    });
  } catch (err) {
    console.error('[WhatsApp] Send failed:', err.message);
  }
}

// Schedule: reminders 09:00 daily (Pacific); nudges hourly
function start() {
  cron.schedule('0 9 * * *', runReminderJob, { timezone: 'America/Los_Angeles' });
  cron.schedule('15 * * * *', runNudgeJob);
  console.log('[Reminders] Cron scheduled: 09:00 daily (Pacific); nudges hourly at :15');
}

module.exports = { start, runReminderJob, runNudgeJob, runRxExpiryCheck };
