const express = require('express');
const router = express.Router();
const db = require('../database');
const { authMiddleware, adminOnly } = require('../middleware/auth');

router.use(authMiddleware);


// ── NTP Sync ─────────────────────────────────────────────────────────────────
router.post('/settings/ntp-sync', adminOnly, async (req, res) => {
  const ntpServer = req.body.ntp_server ||
    db.prepare("SELECT value FROM settings WHERE key='ntp_server'").get()?.value ||
    'pool.ntp.org';
  try {
    // Use worldtimeapi.org to get timezone info from IP (no UDP needed)
    // Or use the NTP server hostname to look up timezone via time.is API
    const axios = require('axios');

    // Primary: worldtimeapi.org — detects timezone from server's public IP
    let timezone = null;
    let ntpTime = null;
    let source = '';

    try {
      const r = await axios.get('https://worldtimeapi.org/api/ip', { timeout: 8000 });
      timezone = r.data.timezone;
      ntpTime = r.data.datetime;
      source = 'worldtimeapi.org';
    } catch {
      // Fallback: timeapi.io
      try {
        const r2 = await axios.get('https://timeapi.io/api/time/current/ip?ipAddress=', { timeout: 8000 });
        timezone = r2.data.timeZone;
        ntpTime = r2.data.dateTime;
        source = 'timeapi.io';
      } catch {
        // Last fallback: keep current, just validate the timezone provided
        if (req.body.timezone) {
          timezone = req.body.timezone;
          ntpTime = new Date().toISOString();
          source = 'manual';
        } else {
          return res.status(503).json({ error: 'NTP/time services unavailable. Configure o timezone manualmente.' });
        }
      }
    }

    // Validate timezone string
    try { new Intl.DateTimeFormat('en', { timeZone: timezone }); } catch {
      return res.status(400).json({ error: `Timezone invalido: ${timezone}` });
    }

    // Save to database
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('timezone', ?)").run(timezone);
    if (ntpServer) db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('ntp_server', ?)").run(ntpServer);

    console.log(`[ntp] Timezone sincronizado: ${timezone} (via ${source})`);
    res.json({ success: true, timezone, ntp_time: ntpTime, source });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Timezone list for dropdown ────────────────────────────────────────────────
router.get('/timezones', (req, res) => {
  // Common timezones grouped by region
  const zones = [
    // Americas
    'America/Noronha','America/Belem','America/Fortaleza','America/Recife',
    'America/Araguaina','America/Maceio','America/Bahia','America/Sao_Paulo',
    'America/Campo_Grande','America/Cuiaba','America/Porto_Velho',
    'America/Boa_Vista','America/Manaus','America/Eirunepe','America/Rio_Branco',
    'America/New_York','America/Chicago','America/Denver','America/Los_Angeles',
    'America/Anchorage','America/Adak','America/Argentina/Buenos_Aires',
    'America/Santiago','America/Bogota','America/Lima','America/Caracas',
    'America/Mexico_City','America/Toronto','America/Vancouver',
    // Europe
    'UTC','Europe/London','Europe/Lisbon','Europe/Madrid','Europe/Paris',
    'Europe/Berlin','Europe/Rome','Europe/Amsterdam','Europe/Brussels',
    'Europe/Warsaw','Europe/Prague','Europe/Vienna','Europe/Budapest',
    'Europe/Bucharest','Europe/Athens','Europe/Helsinki','Europe/Stockholm',
    'Europe/Oslo','Europe/Copenhagen','Europe/Zurich','Europe/Moscow',
    'Europe/Kiev','Europe/Istanbul',
    // Asia / Pacific
    'Asia/Dubai','Asia/Karachi','Asia/Kolkata','Asia/Dhaka','Asia/Bangkok',
    'Asia/Jakarta','Asia/Singapore','Asia/Shanghai','Asia/Tokyo','Asia/Seoul',
    'Asia/Taipei','Asia/Hong_Kong','Asia/Kuala_Lumpur',
    'Australia/Perth','Australia/Darwin','Australia/Brisbane',
    'Australia/Adelaide','Australia/Sydney','Australia/Melbourne',
    'Pacific/Auckland','Pacific/Fiji',
    // Africa
    'Africa/Cairo','Africa/Johannesburg','Africa/Lagos','Africa/Nairobi',
  ];
  res.json(zones);
});

router.get('/settings', (req, res) => {
  const rows = db.prepare(`SELECT key, value FROM settings`).all();
  const settings = {};
  for (const r of rows) settings[r.key] = r.value;
  if (req.user.role !== 'admin') delete settings.webhook_token;
  res.json(settings);
});

router.put('/settings', adminOnly, (req, res) => {
  const allowed = ['queue_rate_limit','queue_rate_window_ms','queue_interval_ms','max_retries',
    'dedup_window_minutes','webhook_token','log_max_rows','log_retention_days','queue_max_sent_rows',
    'timezone','ntp_server'];
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
