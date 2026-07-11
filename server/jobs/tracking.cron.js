const cron = require('node-cron');
const { db } = require('../db');
const { shipments, shipment_events, sales_orders, patients } = require('../db/schema');
const { eq, and, notInArray, ne } = require('drizzle-orm');
const fedexService = require('../services/fedex');
const { sendTrackingUpdate, sendAdminAlert } = require('../services/mailer');

// Event code → action mapping
const EVENT_ACTIONS = {
  DL: { stopPolling: true, updateStatus: 'delivered', patientEmail: true, adminAlert: false },
  OD: { stopPolling: false, patientEmail: process.env.TRACKING_NOTIFY_OUT_FOR_DELIVERY !== 'false', adminAlert: false },
  IT: { stopPolling: false, patientEmail: false, adminAlert: false },
  PU: { stopPolling: false, patientEmail: false, adminAlert: false },
  DP: { stopPolling: false, patientEmail: false, adminAlert: false },
  AO: { stopPolling: false, patientEmail: false, adminAlert: false },
  DE: { stopPolling: false, setException: true, patientEmail: true, adminAlert: true },
  SE: { stopPolling: false, setException: true, patientEmail: true, adminAlert: true },
  DY: { stopPolling: false, setException: true, patientEmail: false, adminAlert: false },
  CA: { stopPolling: true, setException: true, patientEmail: true, adminAlert: true },
  RS: { stopPolling: true, setException: true, patientEmail: true, adminAlert: true, urgent: true },
};

async function pollShipment(shipment) {
  if (!shipment.fedex_tracking_number) return;

  try {
    const result = await fedexService.trackShipment(shipment.fedex_tracking_number);
    if (!result) return;

    const events = result.trackingEvents || result.events || [];
    const existingEvents = await db.select().from(shipment_events)
      .where(eq(shipment_events.shipment_id, shipment.id));
    const existingTimestamps = new Set(existingEvents.map(e => e.event_timestamp?.toISOString()));

    let latestStatus = shipment.latest_status;
    let setException = false;
    let stopPolling = false;
    let newStatus = null;

    // Load order and patient for notifications
    const [order] = await db.select().from(sales_orders).where(eq(sales_orders.id, shipment.order_id));
    const [patient] = order ? await db.select().from(patients).where(eq(patients.id, order.patient_id)) : [null];

    for (const event of events) {
      const eventTs = event.date ? new Date(event.date).toISOString() : null;
      if (eventTs && existingTimestamps.has(eventTs)) continue;

      const code = event.eventType || event.derivedStatusCode;
      const description = event.description || event.derivedStatus || '';
      const location = event.scanLocation || {};

      await db.insert(shipment_events).values({
        shipment_id: shipment.id,
        event_code: code,
        event_description: description,
        event_timestamp: eventTs ? new Date(eventTs) : null,
        location_city: location.city,
        location_state: location.stateOrProvinceCode,
        location_country: location.countryCode,
        raw_json: event,
      }).onConflictDoNothing();

      latestStatus = description || latestStatus;

      const action = EVENT_ACTIONS[code];
      if (action) {
        if (action.stopPolling) stopPolling = true;
        if (action.setException) setException = true;
        if (action.updateStatus) newStatus = action.updateStatus;

        if (action.patientEmail && patient && order) {
          try {
            await sendTrackingUpdate(patient, order, shipment, code, description);
          } catch (mailErr) {
            console.error('[Tracking] Email error:', mailErr.message);
          }
        }

        if (action.adminAlert && order) {
          const subject = action.urgent
            ? `URGENT: Order ${order.order_number} is returning to sender`
            : `Delivery exception on Order ${order.order_number}`;
          const body = `
            <p><strong>Order:</strong> ${order.order_number}</p>
            <p><strong>Patient:</strong> ${patient?.name || 'N/A'}</p>
            <p><strong>Tracking:</strong> <a href="https://www.fedex.com/fedextrack/?tracknumbers=${shipment.fedex_tracking_number}">${shipment.fedex_tracking_number}</a></p>
            <p><strong>Event:</strong> ${code} — ${description}</p>
            <p><strong>Location:</strong> ${[location.city, location.stateOrProvinceCode, location.countryCode].filter(Boolean).join(', ')}</p>
            <p><a href="${process.env.BASE_URL}/orders/${order.id}">View Order in Dashboard</a></p>
          `;
          try {
            await sendAdminAlert(subject, body);
          } catch (alertErr) {
            console.error('[Tracking] Admin alert error:', alertErr.message);
          }
        }
      }
    }

    const updateData = {
      latest_status: latestStatus,
      last_polled_at: new Date(),
    };
    if (stopPolling) updateData.polling_active = false;
    if (setException) updateData.exception_flag = true;
    if (newStatus) updateData.status = newStatus;
    // Record actual delivery date — refill countdowns start from this
    if (newStatus === 'delivered' && !shipment.delivered_at) {
      updateData.delivered_at = new Date().toISOString().split('T')[0];
    }

    await db.update(shipments).set(updateData).where(eq(shipments.id, shipment.id));
  } catch (err) {
    console.error(`[Tracking] Poll error for ${shipment.fedex_tracking_number}:`, err.message);
  }
}

async function runTrackingJob() {
  console.log('[Tracking] Running poll cycle...');
  const activeShipments = await db.select().from(shipments)
    .where(and(
      eq(shipments.polling_active, true),
      notInArray(shipments.status, ['delivered', 'cancelled'])
    ));

  console.log(`[Tracking] Polling ${activeShipments.length} active shipments`);
  for (const shipment of activeShipments) {
    await pollShipment(shipment);
  }
  console.log('[Tracking] Poll cycle complete.');
}

function start() {
  const interval = process.env.TRACKING_POLL_INTERVAL_MINUTES || '30';
  cron.schedule(`*/${interval} * * * *`, runTrackingJob);
  console.log(`[Tracking] Cron scheduled: every ${interval} minutes`);
}

module.exports = { start, runTrackingJob, pollShipment };
