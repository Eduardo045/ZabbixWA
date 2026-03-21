const db = require('../database');
const wahaService = require('./wahaService');

let paused = false;
let processing = false;
const sendTimestamps = {};

function isPaused() { return paused; }
function pause() {
  paused = true;
  db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES ('queue_paused', '1')`).run();
  console.log('[queue] Paused');
}
function resume() {
  paused = false;
  db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES ('queue_paused', '0')`).run();
  console.log('[queue] Resumed');
}

function getRateLimit() {
  const limit = parseInt(db.prepare(`SELECT value FROM settings WHERE key = 'queue_rate_limit'`).get()?.value || '10');
  const window = parseInt(db.prepare(`SELECT value FROM settings WHERE key = 'queue_rate_window_ms'`).get()?.value || '60000');
  return { limit, window };
}

function isRateLimited(destId) {
  const { limit, window } = getRateLimit();
  const now = Date.now();
  if (!sendTimestamps[destId]) sendTimestamps[destId] = [];
  sendTimestamps[destId] = sendTimestamps[destId].filter(t => now - t < window);
  return sendTimestamps[destId].length >= limit;
}

function recordSend(destId) {
  if (!sendTimestamps[destId]) sendTimestamps[destId] = [];
  sendTimestamps[destId].push(Date.now());
}

async function sendQueueItem(item, session, dest) {
  const alertData = JSON.parse(item.alert_data);
  let mentions = [];
  const { buildMessage } = require('./alertService');

  // notificar-todos: mention all group participants
  if (alertData.notify_all && dest.type === 'group') {
    try {
      const participants = await wahaService.getGroupParticipants(session, dest.chat_id);
      if (participants && participants.length > 0) {
        mentions = participants
          .map(p => (p.id || '').replace(/\s/g, ''))
          .filter(id => id.endsWith('@c.us') || id.endsWith('@s.whatsapp.net'));
        console.log(`[queue] notify-all: mentioning ${mentions.length} participants`);
      }
    } catch (e) {
      console.warn(`[queue] notify-all: could not fetch participants (${e.message})`);
    }
    const finalMessage = buildMessage(alertData, mentions, mentions.length === 0);
    await wahaService.sendText(session, dest.chat_id, finalMessage, mentions);
    return { mentions, message: finalMessage };
  }

  // Normal mentions: resolve from mapped phones
  if (dest.type === 'group' && alertData.mention_phones && alertData.mention_phones.length > 0) {
    const rawMentions = alertData.mention_phones.map(phone => `${phone.replace(/\D/g, '')}@c.us`);
    try {
      const participants = await wahaService.getGroupParticipants(session, dest.chat_id);
      if (participants && participants.length > 0) {
        const participantPhones = new Set(
          participants.map(p => (p.id || p.phone || '').replace(/@.*$/, '').replace(/\D/g, ''))
        );
        mentions = rawMentions.filter(m => participantPhones.has(m.replace(/@.*$/, '')));
        console.log(`[queue] Mentions validated: ${mentions.length}/${rawMentions.length}`);
      } else {
        mentions = rawMentions;
        console.log(`[queue] Participants unavailable, mentioning directly: ${mentions.length}`);
      }
    } catch (e) {
      mentions = rawMentions;
      console.warn(`[queue] Could not fetch participants (${e.message}), mentioning directly.`);
    }
  }

  const finalMessage = buildMessage(alertData, mentions);
  await wahaService.sendText(session, dest.chat_id, finalMessage, mentions);
  return { mentions, message: finalMessage };
}

async function processItem(item) {
  const dest = db.prepare(`SELECT * FROM destinations WHERE id = ?`).get(item.destination_id);
  if (!dest || !dest.active) {
    db.prepare(`UPDATE alert_queue SET status = 'skipped', error_message = 'Destination inactive or deleted' WHERE id = ?`).run(item.id);
    return;
  }
  const session = dest.waha_session_id ? db.prepare(`SELECT * FROM waha_sessions WHERE id = ?`).get(dest.waha_session_id) : null;
  if (!session) {
    db.prepare(`UPDATE alert_queue SET status = 'failed', error_message = 'No WAHA session configured' WHERE id = ?`).run(item.id);
    return;
  }
  if (isRateLimited(dest.id)) {
    console.log(`[queue] Rate limited for destination ${dest.id}, will retry`);
    return;
  }
  db.prepare(`UPDATE alert_queue SET status = 'sending' WHERE id = ?`).run(item.id);
  try {
    const result = await sendQueueItem(item, session, dest);
    db.prepare(`UPDATE alert_queue SET status = 'sent', sent_at = CURRENT_TIMESTAMP WHERE id = ?`).run(item.id);
    recordSend(dest.id);
    const alertData = JSON.parse(item.alert_data);
    db.prepare(`INSERT INTO alert_logs (alert_id, event_id, hostname, severity, message, destination_id, destination_name, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(item.alert_id, alertData.event_id || '', alertData.hostname || '', alertData.severity || '', result.message, dest.id, dest.name, 'sent');
    console.log(`[queue] ✅ Sent item ${item.id} to ${dest.name}`);
  } catch (e) {
    const retries = item.retry_count + 1;
    const maxRetries = parseInt(db.prepare(`SELECT value FROM settings WHERE key = 'max_retries'`).get()?.value || '3');
    console.error(`[queue] ❌ Failed item ${item.id}: ${e.message} (attempt ${retries}/${maxRetries})`);
    if (retries >= maxRetries) {
      db.prepare(`UPDATE alert_queue SET status = 'failed', retry_count = ?, error_message = ? WHERE id = ?`)
        .run(retries, e.message.slice(0, 500), item.id);
    } else {
      const backoff = Math.min(30000 * retries, 300000);
      const nextTry = new Date(Date.now() + backoff).toISOString().replace('T', ' ').replace('Z', '').split('.')[0];
      db.prepare(`UPDATE alert_queue SET status = 'pending', retry_count = ?, error_message = ?, scheduled_at = ? WHERE id = ?`)
        .run(retries, e.message.slice(0, 500), nextTry, item.id);
    }
  }
}

async function processQueue() {
  if (paused || processing) return;
  processing = true;
  try {
    db.prepare(`UPDATE alert_queue SET status = 'pending' WHERE status = 'held' AND datetime(scheduled_at) <= datetime('now')`).run();
    const items = db.prepare(`
      SELECT * FROM alert_queue
      WHERE status = 'pending' AND datetime(scheduled_at) <= datetime('now')
      ORDER BY created_at ASC LIMIT 20
    `).all();
    for (const item of items) {
      if (paused) break;
      await processItem(item);
      await new Promise(r => setTimeout(r, 500));
    }
  } finally {
    processing = false;
  }
}

async function forceProcess(item) {
  const dest = db.prepare(`SELECT * FROM destinations WHERE id = ?`).get(item.destination_id);
  const session = dest?.waha_session_id ? db.prepare(`SELECT * FROM waha_sessions WHERE id = ?`).get(dest.waha_session_id) : null;
  if (!dest || !session) throw new Error('Destination or session not configured');
  db.prepare(`UPDATE alert_queue SET status = 'sending' WHERE id = ?`).run(item.id);
  try {
    await sendQueueItem(item, session, dest);
    db.prepare(`UPDATE alert_queue SET status = 'sent', sent_at = CURRENT_TIMESTAMP WHERE id = ?`).run(item.id);
    recordSend(dest.id);
    console.log(`[queue] 🚀 Force-sent item ${item.id}`);
  } catch (e) {
    db.prepare(`UPDATE alert_queue SET status = 'failed', error_message = ? WHERE id = ?`).run(e.message, item.id);
    throw e;
  }
}

function start() {
  const intervalMs = parseInt(process.env.QUEUE_INTERVAL_MS || 5000);
  const pausedSetting = db.prepare(`SELECT value FROM settings WHERE key = 'queue_paused'`).get()?.value;
  paused = pausedSetting === '1';
  setInterval(processQueue, intervalMs);
  console.log(`[queue] Started (interval: ${intervalMs}ms, paused: ${paused})`);
}

module.exports = { start, pause, resume, isPaused, processQueue, forceProcess };
