function requireLogin(req, res, next) {
  if (!req.session || !req.session.adminId) {
    return res.status(401).json({ error: 'UNAUTHORIZED', message: 'Login required.' });
  }
  next();
}

module.exports = { requireLogin };
