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
    severity,
    status,
    is_recovery: status === 'RESOLVED' || status === 'OK' || payload.recovery === '1',
    tags,
    timestamp: payload.timestamp || payload.event_time || new Date().toISOString(),
    url: payload.url || '',
  };
}

/** Build alert tag map: { tagname_lower: [value1, value2, ...] }
 *  If the TAG value contains commas (e.g. "joao.silva,maria.souza"),
 *  each part is stored as a separate entry so individual lookups work. */
function buildAlertTagMap(tags) {
  const map = {};
  for (const t of (tags || [])) {
    const k = (t.tag || '').toLowerCase().trim();
    const rawValue = (t.value || '').trim();
    if (!map[k]) map[k] = [];
    // Split comma-separated values from the alert tag
    const parts = rawValue.split(',').map(v => v.trim().toLowerCase()).filter(v => v.length > 0);
    for (const part of parts) {
      if (!map[k].includes(part)) map[k].push(part);
    }
    // Also store the full raw value (lowercase) for exact-match filters
    const full = rawValue.toLowerCase();
    if (full && !map[k].includes(full)) map[k].push(full);
  }
  return map;
}

function alertHasTag(tagMap, name, value) {
  const k = name.toLowerCase().trim();
  if (!tagMap[k]) return false;
  if (!value || value.trim() === '') return true; // any value
  return tagMap[k].includes(value.toLowerCase().trim());
}

function buildMessage(alert, mentions = [], notifyAll = false) {
  const emoji = SEVERITY_EMOJI[alert.severity] || '⚪';
  const statusLabel = alert.is_recovery ? '✅ *RESOLVIDO*' : `${emoji} *${alert.severity.toUpperCase()}*`;
  let msg = `${statusLabel}\n`;
  msg += `🖥️ *Host:* ${alert.hostname}\n`;
  if (alert.trigger_name) msg += `⚡ *Evento:* ${alert.trigger_name}\n`;
  if (alert.host_ip) msg += `🔗 *IP:* ${alert.host_ip}\n`;
  msg += `🕐 *Hora:* ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}\n`;
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

/** RULE 1: Check notify-all tag on alert and destination switch */
function checkNotifyAll(alert, destination, tagMap) {
  if (!destination.notify_all_enabled) return false;
  return alertHasTag(tagMap, 'notificar-todos', '1');
}

/** RULE 2: Schedule check with optional TAG filter */
function checkSchedule(destinationId, severity, tagMap) {
  const now = new Date();
  const currentDay = now.getDay();
  const currentTime = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;

  const rules = db.prepare(`
    SELECT * FROM schedule_rules
    WHERE destination_id = ? AND severity = ? AND active = 1
  `).all(destinationId, severity);

  if (rules.length === 0) return { allowed: true };

  for (const rule of rules) {
    const days = rule.days_of_week.split(',').map(Number);
    if (!days.includes(currentDay)) continue;

    // Check TAG filter for this schedule rule
    if (rule.tag_filter_name) {
      const tagPresent = alertHasTag(tagMap, rule.tag_filter_name, rule.tag_filter_value);
      const tagMatches = rule.tag_filter_negate ? !tagPresent : tagPresent;
      if (!tagMatches) continue; // Rule doesn't apply for this alert's tags
    }

    const inWindow = currentTime >= rule.start_time && currentTime <= rule.end_time;
    if (!inWindow) {
      return { allowed: false, action: rule.action, rule };
    }
  }
  return { allowed: true };
}

/** RULE 3: TAG list — check if alert matches, with optional severity negation */
function destinationMatchesTagFilters(destination, alert, tagMap) {
  const tagFilters = db.prepare(`
    SELECT * FROM destination_tag_filters WHERE destination_id = ?
  `).all(destination.id);

  if (tagFilters.length === 0) return { matched: true, ignoreSeverity: false };

  for (const filter of tagFilters) {
    const tagPresent = alertHasTag(tagMap, filter.tag_name, filter.tag_value);
    if (tagPresent) {
      return { matched: true, ignoreSeverity: !!filter.negate_severity };
    }
  }
  return { matched: false, ignoreSeverity: false };
}

/** Check severity filter */
function destinationAllowsSeverity(destination, severity) {
  const sevFilters = db.prepare(`
    SELECT severity FROM destination_severity_filters WHERE destination_id = ?
  `).all(destination.id).map(r => r.severity);
  if (sevFilters.length === 0) return true;
  return sevFilters.includes(severity);
}

/** Resolve mention phones from alert tags — supports comma-separated tag values */
function resolveMentions(alert) {
  const mappings = db.prepare(`SELECT * FROM tag_phone_mappings`).all();
  const tagMap = buildAlertTagMap(alert.tags);
  const phones = new Set();

  for (const mapping of mappings) {
    const tagName = mapping.tag_name.toLowerCase();
    if (!tagMap[tagName]) continue;

    // Support comma-separated values in mapping
    const mappingValues = mapping.tag_value.split(',').map(v => v.trim().toLowerCase());
    const alertValues = tagMap[tagName];

    const matched = mappingValues.some(mv => !mv || alertValues.includes(mv));
    if (matched) phones.add(mapping.phone_number);
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
    WHERE destination_id = ?
    AND status IN ('pending', 'held', 'sending')
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
    // ── RULE 1: notificar-todos ──────────────────────────────────────────────
    if (checkNotifyAll(alert, dest, tagMap)) {
      if (alert.event_id && checkDedup(alert, dest.id)) { skipped++; continue; }
      const message = buildMessage(alert, [], true); // notifyAll=true
      const scheduledAt = new Date().toISOString().replace('T', ' ').replace('Z', '').split('.')[0];
      db.prepare(`INSERT INTO alert_queue (alert_id, alert_data, destination_id, status, scheduled_at) VALUES (?, ?, ?, 'pending', ?)`)
        .run(alert.event_id || null, JSON.stringify({ ...alert, message, mention_phones: [], notify_all: true }), dest.id, scheduledAt);
      queued++;
      continue; // Skip all other rules for this destination
    }

    // ── RULE 2: Schedule check (with TAG filter) ─────────────────────────────
    const scheduleCheck = checkSchedule(dest.id, alert.severity, tagMap);

    // ── RULE 3: TAG filters with severity negation ───────────────────────────
    const tagCheck = destinationMatchesTagFilters(dest, alert, tagMap);

    // If no TAG filters configured — check severity normally
    // If TAG filters configured and matched with negate_severity — skip severity check
    // If TAG filters configured and NOT matched — block
    if (!tagCheck.matched) { skipped++; continue; }

    const severityOk = tagCheck.ignoreSeverity || destinationAllowsSeverity(dest, alert.severity);
    if (!severityOk) { skipped++; continue; }

    if (alert.event_id && checkDedup(alert, dest.id)) { skipped++; continue; }

    const phones = resolveMentions(alert);
    const message = buildMessage(alert, dest.type === 'group' ? phones : []);

    let status = 'pending';
    let scheduledAt = new Date().toISOString().replace('T', ' ').replace('Z', '').split('.')[0];

    if (!scheduleCheck.allowed) {
      if (scheduleCheck.action === 'hold') {
        status = 'held';
        scheduledAt = getNextAllowedTime(scheduleCheck.rule);
      } else {
        db.prepare(`INSERT INTO alert_logs (alert_id, event_id, hostname, severity, message, destination_id, destination_name, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(alert.event_id, alert.event_id, alert.hostname, alert.severity, message, dest.id, dest.name, 'skipped_schedule');
        skipped++; continue;
      }
    }

    db.prepare(`INSERT INTO alert_queue (alert_id, alert_data, destination_id, status, scheduled_at) VALUES (?, ?, ?, ?, ?)`)
      .run(alert.event_id || null, JSON.stringify({ ...alert, message, mention_phones: phones }), dest.id, status, scheduledAt);
    queued++;
  }

  return { queued, skipped };
}

module.exports = { processAlert, normalizeAlert, buildMessage, SEVERITY_EMOJI, SEVERITY_ORDER };
