const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const db = require('../database');
const alertService = require('../services/alertService');

// ── Timing-safe token comparison ─────────────────────────────────────────────
function safeCompare(a, b) {
  try {
    const bufA = Buffer.from(String(a));
    const bufB = Buffer.from(String(b));
    if (bufA.length !== bufB.length) {
      // Still run timingSafeEqual to avoid timing leak on length
      crypto.timingSafeEqual(bufA, bufA);
      return false;
    }
    return crypto.timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}

router.post('/zabbix', async (req, res) => {
  const webhookToken = db.prepare(`SELECT value FROM settings WHERE key = 'webhook_token'`).get()?.value;
  if (webhookToken) {
    const providedToken = req.query.token || req.headers['x-webhook-token'] || '';
    if (!safeCompare(providedToken, webhookToken)) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  const payload = req.body;
  if (!payload || typeof payload !== 'object') return res.status(400).json({ error: 'Invalid payload' });

  // Basic payload size guard
  const payloadStr = JSON.stringify(payload);
  if (payloadStr.length > 64 * 1024) return res.status(413).json({ error: 'Payload too large' });

  try {
    const results = await alertService.processAlert(payload);
    res.json({ success: true, queued: results.queued, skipped: results.skipped });
  } catch (e) {
    console.error('[webhook] Error processing alert:', e.message);
    res.status(500).json({ error: 'Failed to process alert' }); // no detail leak
  }
});

router.get('/zabbix/ping', (req, res) => {
  res.json({ status: 'ok' }); // removed timestamp to reduce info disclosure
});

module.exports = router;
