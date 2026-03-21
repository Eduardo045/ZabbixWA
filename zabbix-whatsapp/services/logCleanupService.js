const db = require('../database');

function getSettings() {
  const rows = db.prepare(`SELECT key, value FROM settings WHERE key IN ('log_max_rows','log_retention_days','queue_max_sent_rows')`).all();
  const s = {};
  for (const r of rows) s[r.key] = parseInt(r.value) || 0;
  return {
    logMaxRows: s.log_max_rows || 50000,
    logRetentionDays: s.log_retention_days || 30,
    queueMaxSentRows: s.queue_max_sent_rows || 10000,
  };
}

function cleanup() {
  const { logMaxRows, logRetentionDays, queueMaxSentRows } = getSettings();

  // 1. Delete logs older than retention window
  const byAge = db.prepare(`
    DELETE FROM alert_logs
    WHERE created_at < datetime('now', '-' || ? || ' days')
  `).run(logRetentionDays);

  // 2. If still above max rows, delete oldest surplus
  const count = db.prepare(`SELECT COUNT(*) as c FROM alert_logs`).get().c;
  let byCount = { changes: 0 };
  if (count > logMaxRows) {
    byCount = db.prepare(`
      DELETE FROM alert_logs WHERE id IN (
        SELECT id FROM alert_logs ORDER BY created_at ASC LIMIT ?
      )
    `).run(count - logMaxRows);
  }

  // 3. Trim sent/skipped items from queue
  const qCount = db.prepare(`SELECT COUNT(*) as c FROM alert_queue WHERE status IN ('sent','skipped')`).get().c;
  let qByCount = { changes: 0 };
  if (qCount > queueMaxSentRows) {
    qByCount = db.prepare(`
      DELETE FROM alert_queue WHERE status IN ('sent','skipped') AND id IN (
        SELECT id FROM alert_queue WHERE status IN ('sent','skipped')
        ORDER BY created_at ASC LIMIT ?
      )
    `).run(qCount - queueMaxSentRows);
  }

  const total = byAge.changes + byCount.changes + qByCount.changes;
  if (total > 0) {
    console.log(`[cleanup] Removed: ${byAge.changes} old logs, ${byCount.changes} excess logs, ${qByCount.changes} sent queue items`);
  }
  return { byAge: byAge.changes, byCount: byCount.changes, queueTrimmed: qByCount.changes };
}

function start() {
  // Run at startup and every hour
  cleanup();
  setInterval(cleanup, 60 * 60 * 1000);
  console.log('[cleanup] Log cleanup service started (hourly)');
}

module.exports = { start, cleanup };
