const db = require('../database');

const SEVERITY_MAP = {
  'not classified': 'not_classified', 'not_classified': 'not_classified',
  'information': 'information', 'warning': 'warning', 'average': 'average',
  'high': 'high', 'disaster': 'disaster',
  '0': 'not_classified', '1': 'information', '2': 'warning',
  '3': 'average', '4': 'high', '5': 'disaster',
};

const SEVERITY_EMOJI = {
  not_classified: '⚪', information: 'ℹ️', warning: '⚠️',
  average: '🟠', high: '🔴', disaster: '💥',
};

const SEVERITY_ORDER = ['not_classified','information','warning','average','high','disaster'];

function normalizeAlert(payload) {
  const rawSeverity = (payload.severity || payload.event_severity || '').toLowerCase().trim();
  const severity = SEVERITY_MAP[rawSeverity] || 'not_classified';
  let tags = [];
  try {
    if (typeof payload.tags === 'string') tags = JSON.parse(payload.tags);
    else if (Array.isArray(payload.tags)) tags = payload.tags;
    else if (typeof payload.tags === 'object' && payload.tags) {
      tags = Object.entries(payload.tags).map(([tag, value]) => ({ tag, value }));
    }
  } catch { tags = []; }
  const status = (payload.status || payload.event_status || 'PROBLEM').toUpperCase();
  return {
    event_id: String(payload.eventid || payload.event_id || ''),
    trigger_id: String(payload.triggerid || payload.trigger_id || ''),
    hostname: payload.hostname || payload.host || payload.HOST || '',
    host_ip: payload.hostip || payload.host_ip || '',
    trigger_name: payload.triggername || payload.trigger_name || payload.name || payload.eventname || '',
    severity, status,
    is_recovery: status === 'RESOLVED' || status === 'OK' || payload.recovery === '1',
    tags, timestamp: payload.timestamp || payload.event_time || new Date().toISOString(),
    url: payload.url || '',
  };
}

/** Build tag map splitting comma-separated alert values */
function buildAlertTagMap(tags) {
  const map = {};
  for (const t of (tags || [])) {
    const k = (t.tag || '').toLowerCase().trim();
    const rawValue = (t.value || '').trim();
    if (!map[k]) map[k] = [];
    const parts = rawValue.split(',').map(v => v.trim().toLowerCase()).filter(v => v.length > 0);
    for (const part of parts) if (!map[k].includes(part)) map[k].push(part);
    const full = rawValue.toLowerCase();
    if (full && !map[k].includes(full)) map[k].push(full);
  }
  return map;
}

function alertHasTag(tagMap, name, value) {
  const k = name.toLowerCase().trim();
  if (!tagMap[k]) return false;
  if (!value || value.trim() === '') return true;
  return tagMap[k].includes(value.toLowerCase().trim());
}

function buildMessage(alert, mentions = [], notifyAll = false) {
  const tz = db.prepare("SELECT value FROM settings WHERE key='timezone'").get()?.value || 'UTC';
  const emoji = SEVERITY_EMOJI[alert.severity] || '⚪';
  const statusLabel = alert.is_recovery ? '✅ *RESOLVIDO*' : `${emoji} *${alert.severity.toUpperCase()}*`;
  let msg = `${statusLabel}\n`;
  msg += `🖥️ *Host:* ${alert.hostname}\n`;
  if (alert.trigger_name) msg += `⚡ *Evento:* ${alert.trigger_name}\n`;
  if (alert.host_ip) msg += `🔗 *IP:* ${alert.host_ip}\n`;
  msg += `🕐 *Hora:* ${new Date().toLocaleString('pt-BR', { timeZone: tz, dateStyle: 'short', timeStyle: 'medium' })}\n`;
  if (alert.tags && alert.tags.length > 0) {
    msg += `🏷️ *Tags:* ${alert.tags.map(t => `${t.tag}:${t.value}`).join(', ')}\n`;
  }
  if (alert.url) msg += `🔗 ${alert.url}\n`;
  if (notifyAll) {
    msg += `\n📢 @all`;
  } else if (mentions.length > 0) {
    msg += `\n👤 ${mentions.map(m => `@${m.replace(/@.*$/, '')}`).join(' ')}`;
  }
  return msg;
}

/** RULE 1: notificar-todos */
function checkNotifyAll(alert, destination, tagMap) {
  if (!destination.notify_all_enabled) return false;
  return alertHasTag(tagMap, 'notificar-todos', '1');
}

/** RULE 2: Schedule check with optional TAG filter */
function checkSchedule(destinationId, severity, tagMap) {
  const now = new Date();
  const currentDay = now.getDay();
  const currentTime = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
  const rules = db.prepare(`SELECT * FROM schedule_rules WHERE destination_id = ? AND severity = ? AND active = 1`).all(destinationId, severity);
  if (rules.length === 0) return { allowed: true };
  for (const rule of rules) {
    const days = rule.days_of_week.split(',').map(Number);
    if (!days.includes(currentDay)) continue;
    if (rule.tag_filter_name) {
      const tagPresent = alertHasTag(tagMap, rule.tag_filter_name, rule.tag_filter_value);
      const tagMatches = rule.tag_filter_negate ? !tagPresent : tagPresent;
      if (!tagMatches) continue;
    }
    const inWindow = currentTime >= rule.start_time && currentTime <= rule.end_time;
    if (!inWindow) return { allowed: false, action: rule.action, rule };
  }
  return { allowed: true };
}

/** RULE 3: TAG routing filters — ANY match passes, none = all pass
 *  negate_severity: when matched, delivery ignores severity check */
function checkTagRouting(destination, tagMap) {
  const tagFilters = db.prepare(`SELECT * FROM destination_tag_filters WHERE destination_id = ?`).all(destination.id);
  if (tagFilters.length === 0) return { pass: true, ignoreSeverity: false };
  for (const filter of tagFilters) {
    if (alertHasTag(tagMap, filter.tag_name, filter.tag_value)) {
      return { pass: true, ignoreSeverity: !!filter.negate_severity };
    }
  }
  return { pass: false, ignoreSeverity: false };
}

/** Severity check with optional TAG condition per severity.
 *  severity_mode=bypass: skip severity check entirely (route by TAGs only).
 *  severity_mode=whitelist (default): selected severities allowed.
 *    - If a severity has a TAG condition → alert must also match that TAG.
 *    - If no severities selected → all pass.
 */
function checkSeverity(destination, severity, tagMap) {
  if (destination.severity_mode === 'bypass') return true;

  const sevFilters = db.prepare(`SELECT severity FROM destination_severity_filters WHERE destination_id = ?`).all(destination.id).map(r => r.severity);
  if (sevFilters.length === 0) return true; // no filter = all pass
  if (!sevFilters.includes(severity)) return false;

  // Check optional TAG condition for this severity
  const conditions = db.prepare(`SELECT * FROM destination_severity_conditions WHERE destination_id = ? AND severity = ?`).all(destination.id, severity);
  if (conditions.length === 0) return true; // severity matched, no TAG condition = pass
  // Any condition match passes
  for (const cond of conditions) {
    if (alertHasTag(tagMap, cond.tag_name, cond.tag_value)) return true;
  }
  return false; // severity matched but TAG condition not met
}

/** Resolve mentions from destination_mention_filters + tag_phone_mappings.
 *  mention_filters: if empty → try all mappings; if set → only those matching */
function resolveMentions(alert, destinationId) {
  const tagMap = buildAlertTagMap(alert.tags);
  const mentionFilters = db.prepare(`SELECT * FROM destination_mention_filters WHERE destination_id = ?`).all(destinationId);
  const allMappings = db.prepare(`SELECT * FROM tag_phone_mappings`).all();
  const phones = new Set();

  for (const mapping of allMappings) {
    const tagName = mapping.tag_name.toLowerCase();
    if (!tagMap[tagName]) continue;
    const mappingValues = mapping.tag_value.split(',').map(v => v.trim().toLowerCase());
    const alertValues = tagMap[tagName];
    const matched = mappingValues.some(mv => !mv || alertValues.includes(mv));
    if (!matched) continue;

    // If mention filters exist, check this mapping is allowed
    if (mentionFilters.length > 0) {
      const allowed = mentionFilters.some(mf =>
        mf.tag_name.toLowerCase() === tagName &&
        (!mf.tag_value || alertValues.includes(mf.tag_value.toLowerCase()))
      );
      if (!allowed) continue;
    }
    phones.add(mapping.phone_number);
  }
  return Array.from(phones);
}

function getNextAllowedTime(rule) {
  const now = new Date();
  const days = rule.days_of_week.split(',').map(Number);
  const [startH, startM] = rule.start_time.split(':').map(Number);
  for (let i = 0; i <= 7; i++) {
    const candidate = new Date(now);
    candidate.setDate(candidate.getDate() + i);
    candidate.setHours(startH, startM, 0, 0);
    if (candidate > now && days.includes(candidate.getDay())) {
      return candidate.toISOString().replace('T', ' ').replace('Z', '').split('.')[0];
    }
  }
  return new Date(now.getTime() + 3600000).toISOString().replace('T', ' ').replace('Z', '').split('.')[0];
}

function checkDedup(alert, destinationId) {
  const windowMinutes = parseInt(db.prepare(`SELECT value FROM settings WHERE key = 'dedup_window_minutes'`).get()?.value || '5');
  const existing = db.prepare(`
    SELECT id FROM alert_queue
    WHERE destination_id = ? AND status IN ('pending','held','sending')
    AND json_extract(alert_data, '$.event_id') = ?
    AND datetime(created_at) > datetime('now', '-' || ? || ' minutes')
  `).get(destinationId, alert.event_id, windowMinutes);
  return !!existing;
}

async function processAlert(payload) {
  const alert = normalizeAlert(payload);
  console.log(`[alert] Processing: [${alert.severity}] ${alert.hostname} - ${alert.trigger_name}`);
  const destinations = db.prepare(`SELECT * FROM destinations WHERE active = 1`).all();
  let queued = 0, skipped = 0;
  const tagMap = buildAlertTagMap(alert.tags);

  for (const dest of destinations) {

    // ── RULE 1: notificar-todos ─────────────────────────────────────────────
    if (checkNotifyAll(alert, dest, tagMap)) {
      if (alert.event_id && checkDedup(alert, dest.id)) { skipped++; continue; }
      const message = buildMessage(alert, [], true);
      const scheduledAt = new Date().toISOString().replace('T',' ').replace('Z','').split('.')[0];
      db.prepare(`INSERT INTO alert_queue (alert_id,alert_data,destination_id,status,scheduled_at) VALUES (?,?,?,'pending',?)`)
        .run(alert.event_id||null, JSON.stringify({...alert,message,mention_phones:[],notify_all:true}), dest.id, scheduledAt);
      queued++; continue;
    }

    // ── RULE 3: TAG routing (pure routing, no mention logic) ─────────────────
    const tagRoute = checkTagRouting(dest, tagMap);
    if (!tagRoute.pass) { skipped++; continue; }

    // ── RULE 3 + Severity: check severity (possibly bypassed by TAG negate) ──
    const sevOk = tagRoute.ignoreSeverity || checkSeverity(dest, alert.severity, tagMap);
    if (!sevOk) { skipped++; continue; }

    // ── RULE 2: Schedule check ───────────────────────────────────────────────
    const scheduleCheck = checkSchedule(dest.id, alert.severity, tagMap);

    if (alert.event_id && checkDedup(alert, dest.id)) { skipped++; continue; }

    // Mentions are resolved independently — NEVER block routing
    const phones = resolveMentions(alert, dest.id);
    const message = buildMessage(alert, dest.type === 'group' ? phones : []);

    let status = 'pending';
    let scheduledAt = new Date().toISOString().replace('T',' ').replace('Z','').split('.')[0];

    if (!scheduleCheck.allowed) {
      if (scheduleCheck.action === 'hold') {
        status = 'held';
        scheduledAt = getNextAllowedTime(scheduleCheck.rule);
      } else {
        db.prepare(`INSERT INTO alert_logs (alert_id,event_id,hostname,severity,message,destination_id,destination_name,status) VALUES (?,?,?,?,?,?,?,'skipped_schedule')`)
          .run(alert.event_id, alert.event_id, alert.hostname, alert.severity, message, dest.id, dest.name);
        skipped++; continue;
      }
    }

    db.prepare(`INSERT INTO alert_queue (alert_id,alert_data,destination_id,status,scheduled_at) VALUES (?,?,?,?,?)`)
      .run(alert.event_id||null, JSON.stringify({...alert,message,mention_phones:phones}), dest.id, status, scheduledAt);
    queued++;
  }
  return { queued, skipped };
}

module.exports = { processAlert, normalizeAlert, buildMessage, SEVERITY_EMOJI, SEVERITY_ORDER };
