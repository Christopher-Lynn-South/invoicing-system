// ─── Admin / staff auth ───────────────────────────────────────────────────────

function requireLogin(req, res, next) {
  if (!req.session || !req.session.adminId) {
    return res.status(401).json({ error: 'UNAUTHORIZED', message: 'Login required.' });
  }
  next();
}

/** Require a specific staff role.  Always implies requireLogin. */
function requireRole(role) {
  return (req, res, next) => {
    if (!req.session || !req.session.adminId) {
      return res.status(401).json({ error: 'UNAUTHORIZED', message: 'Login required.' });
    }
    if (req.session.adminRole !== role) {
      return res.status(403).json({ error: 'FORBIDDEN', message: 'Insufficient permissions.' });
    }
    next();
  };
}

// ─── Patient portal auth ──────────────────────────────────────────────────────

function requirePatientLogin(req, res, next) {
  if (!req.session || !req.session.patientId) {
    return res.status(401).json({ error: 'UNAUTHORIZED', message: 'Patient login required.' });
  }
  next();
}

module.exports = { requireLogin, requireRole, requirePatientLogin };
