const jwt = require('jsonwebtoken');

// JWT_SECRET is validated at startup in server.js — safe to use here
const JWT_SECRET = process.env.JWT_SECRET || 'change-this-secret';

function authMiddleware(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Token required' });
  try {
    const user = jwt.verify(token, JWT_SECRET);
    req.user = user;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

function adminOnly(req, res, next) {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  next();
}

module.exports = { authMiddleware, adminOnly, JWT_SECRET };
