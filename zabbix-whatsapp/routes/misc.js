const express = require('express');
const router = express.Router();
const db = require('../database');
const { authMiddleware, adminOnly } = require('../middleware/auth');

router.use(authMiddleware);

router.get('/settings', (req, res) => {
  const rows = db.prepare(`SELECT key, value FROM settings`).all();
  const settings = {};
  for (const r of rows) settings[r.key] = r.value;
  if (req.user.role !== 'admin') delete settings.webhook_token;
  res.json(settings);
});

router.put('/settings', adminOnly, (req, res) => {
  const allowed = ['queue_rate_limit','queue_rate_window_ms','queue_interval_ms','max_retries',
    'dedup_window_minutes','webhook_token','log_max_rows','log_retention_days','queue_max_sent_rows'];
  const update = db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`);
  for (const key of allowed) {
    if (req.body[key] !== undefined) update.run(key, String(req.body[key]));
  }
  res.json({ success: true });
});

router.post('/settings/cleanup-now', adminOnly, (req, res) => {
  try {
    const result = require('../services/logCleanupService').cleanup();
    res.json({ success: true, ...result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/dashboard', (req, res) => {
  const queueStats = {};
  for (const s of ['pending','sending','sent','failed','held','skipped']) {
    queueStats[s] = db.prepare(`SELECT COUNT(*) as c FROM alert_queue WHERE status = ?`).get(s).c;
  }
  const recentAlerts = db.prepare(`SELECT * FROM alert_logs ORDER BY created_at DESC LIMIT 20`).all();
  const destinationsCount = db.prepare(`SELECT COUNT(*) as c FROM destinations WHERE active = 1`).get().c;
  const sessionsCount = db.prepare(`SELECT COUNT(*) as c FROM waha_sessions`).get().c;
  const mappingsCount = db.prepare(`SELECT COUNT(*) as c FROM tag_phone_mappings`).get().c;
  const logTotalRows = db.prepare(`SELECT COUNT(*) as c FROM alert_logs`).get().c;
  const queueTotalRows = db.prepare(`SELECT COUNT(*) as c FROM alert_queue`).get().c;
  const alertsByHour = db.prepare(`SELECT strftime('%H', created_at) as hour, COUNT(*) as count FROM alert_logs WHERE created_at > datetime('now', '-24 hours') GROUP BY hour ORDER BY hour`).all();
  const alertsBySeverity = db.prepare(`SELECT severity, COUNT(*) as count FROM alert_logs WHERE created_at > datetime('now', '-24 hours') GROUP BY severity`).all();
  res.json({ queueStats, recentAlerts, destinationsCount, sessionsCount, mappingsCount, logTotalRows, queueTotalRows, alertsByHour, alertsBySeverity });
});

router.get('/logs', (req, res) => {
  const { limit = 100, offset = 0, severity, status } = req.query;
  let q = `SELECT * FROM alert_logs WHERE 1=1`;
  const params = [];
  if (severity) { q += ` AND severity = ?`; params.push(severity); }
  if (status) { q += ` AND status = ?`; params.push(status); }
  q += ` ORDER BY created_at DESC LIMIT ? OFFSET ?`;
  params.push(parseInt(limit), parseInt(offset));
  const total = db.prepare(`SELECT COUNT(*) as c FROM alert_logs WHERE 1=1${severity?' AND severity=?':''}${status?' AND status=?':''}`).get(...params.slice(0,-2)).c;
  res.json({ items: db.prepare(q).all(...params), total });
});

module.exports = router;
