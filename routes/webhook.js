const express = require('express');
const router = express.Router();
const db = require('../database');
const alertService = require('../services/alertService');

router.post('/zabbix', async (req, res) => {
  // Optional token auth
  const webhookToken = db.prepare(`SELECT value FROM settings WHERE key = 'webhook_token'`).get()?.value;
  if (webhookToken) {
    const providedToken = req.query.token || req.headers['x-webhook-token'];
    if (providedToken !== webhookToken) return res.status(401).json({ error: 'Unauthorized' });
  }

  const payload = req.body;
  if (!payload || typeof payload !== 'object') return res.status(400).json({ error: 'Invalid payload' });

  try {
    const results = await alertService.processAlert(payload);
    res.json({ success: true, queued: results.queued, skipped: results.skipped });
  } catch (e) {
    console.error('[webhook] Error processing alert:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Test endpoint to check webhook is reachable
router.get('/zabbix/ping', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

module.exports = router;
