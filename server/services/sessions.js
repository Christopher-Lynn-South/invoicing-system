// Helpers for purging server-side sessions (connect-pg-simple table).
//
// The default schema for connect-pg-simple:
//   CREATE TABLE sessions (
//     sid   varchar    PRIMARY KEY,
//     sess  json       NOT NULL,
//     expire timestamp NOT NULL
//   )
//
// We match rows by the JSON path so we don't need to reason about
// serialization format.

const { pool } = require('../db');

// Delete every session row where sess.customerId equals the given patient UUID.
// Use after password reset / change / revoke-portal-access for a patient.
async function purgeCustomerSessions(customerId) {
  if (!customerId) return { deleted: 0 };
  try {
    const res = await pool.query(
      `DELETE FROM sessions WHERE sess->>'customerId' = $1`,
      [customerId]
    );
    return { deleted: res.rowCount || 0 };
  } catch (err) {
    console.error('purgeCustomerSessions failed:', err.message);
    return { deleted: 0, error: err.message };
  }
}

// Delete every session row where sess.adminId equals the given admin UUID.
// Use after a staff user has their password reset by another admin, or is
// deleted / role-changed.
async function purgeAdminSessions(adminId) {
  if (!adminId) return { deleted: 0 };
  try {
    const res = await pool.query(
      `DELETE FROM sessions WHERE sess->>'adminId' = $1`,
      [adminId]
    );
    return { deleted: res.rowCount || 0 };
  } catch (err) {
    console.error('purgeAdminSessions failed:', err.message);
    return { deleted: 0, error: err.message };
  }
}

module.exports = { purgeCustomerSessions, purgeAdminSessions };
