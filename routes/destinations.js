const express = require('express');
const router = express.Router();
const db = require('../database');
const { authMiddleware } = require('../middleware/auth');

router.use(authMiddleware);

const SEVERITIES = ['not_classified','information','warning','average','high','disaster'];

function buildDestination(row) {
  const sevFilters = db.prepare(`SELECT severity FROM destination_severity_filters WHERE destination_id = ?`).all(row.id).map(r => r.severity);
  const sevConditions = db.prepare(`SELECT * FROM destination_severity_conditions WHERE destination_id = ?`).all(row.id);
  const mentionFilters = db.prepare(`SELECT * FROM destination_mention_filters WHERE destination_id = ?`).all(row.id);
  const tagFilters = db.prepare(`SELECT * FROM destination_tag_filters WHERE destination_id = ?`).all(row.id);
  const schedules = db.prepare(`SELECT * FROM schedule_rules WHERE destination_id = ? ORDER BY id`).all(row.id);
  const session = row.waha_session_id ? db.prepare(`SELECT id, name, session_name, api_url, status FROM waha_sessions WHERE id = ?`).get(row.waha_session_id) : null;
  return { ...row, severity_filters: sevFilters, sev_conditions: sevConditions, tag_filters: tagFilters, mention_filters: mentionFilters, schedules, session };
}

router.get('/', (req, res) => {
  const rows = db.prepare(`SELECT * FROM destinations ORDER BY id`).all();
  res.json(rows.map(buildDestination));
});

router.get('/:id', (req, res) => {
  const row = db.prepare(`SELECT * FROM destinations WHERE id = ?`).get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json(buildDestination(row));
});

router.post('/', (req, res) => {
  const { name, type = 'group', chat_id, waha_session_id, active = 1, notify_all_enabled = 0, severity_mode = 'whitelist' } = req.body;
  if (!name || !chat_id) return res.status(400).json({ error: 'name and chat_id required' });
  const result = db.prepare(`INSERT INTO destinations (name, type, chat_id, waha_session_id, active, notify_all_enabled, severity_mode) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(name, type, chat_id, waha_session_id || null, active ? 1 : 0, notify_all_enabled ? 1 : 0, severity_mode);
  res.json({ id: result.lastInsertRowid, ...req.body });
});

router.put('/:id', (req, res) => {
  const d = db.prepare(`SELECT * FROM destinations WHERE id = ?`).get(req.params.id);
  if (!d) return res.status(404).json({ error: 'Not found' });
  const { name, type, chat_id, waha_session_id, active, notify_all_enabled } = req.body;
  const new_severity_mode = req.body.severity_mode;
  db.prepare(`UPDATE destinations SET name=?, type=?, chat_id=?, waha_session_id=?, active=?, notify_all_enabled=?, severity_mode=? WHERE id=?`)
    .run(name??d.name, type??d.type, chat_id??d.chat_id, waha_session_id??d.waha_session_id,
      active!==undefined?(active?1:0):d.active,
      notify_all_enabled!==undefined?(notify_all_enabled?1:0):d.notify_all_enabled,
      new_severity_mode??d.severity_mode??'whitelist',
      req.params.id);
  res.json({ success: true });
});

router.delete('/:id', (req, res) => {
  db.prepare(`DELETE FROM destinations WHERE id = ?`).run(req.params.id);
  res.json({ success: true });
});

// Severity filters
router.put('/:id/severity-filters', (req, res) => {
  const { severities } = req.body;
  if (!Array.isArray(severities)) return res.status(400).json({ error: 'severities array required' });
  db.prepare(`DELETE FROM destination_severity_filters WHERE destination_id = ?`).run(req.params.id);
  const insert = db.prepare(`INSERT INTO destination_severity_filters (destination_id, severity) VALUES (?, ?)`);
  for (const sev of severities) insert.run(req.params.id, sev);
  res.json({ success: true, severities });
});

// Tag filters (rule 3 — with negate_severity)
router.get('/:id/tag-filters', (req, res) => {
  res.json(db.prepare(`SELECT * FROM destination_tag_filters WHERE destination_id = ?`).all(req.params.id));
});

router.post('/:id/tag-filters', (req, res) => {
  const { tag_name, tag_value = '', negate_severity = 0 } = req.body;
  if (!tag_name) return res.status(400).json({ error: 'tag_name required' });
  const r = db.prepare(`INSERT INTO destination_tag_filters (destination_id, tag_name, tag_value, negate_severity) VALUES (?, ?, ?, ?)`)
    .run(req.params.id, tag_name, tag_value, negate_severity ? 1 : 0);
  res.json({ id: r.lastInsertRowid, tag_name, tag_value, negate_severity });
});

router.put('/:id/tag-filters/:filterId', (req, res) => {
  const f = db.prepare(`SELECT * FROM destination_tag_filters WHERE id = ? AND destination_id = ?`).get(req.params.filterId, req.params.id);
  if (!f) return res.status(404).json({ error: 'Not found' });
  const { tag_name, tag_value, negate_severity } = req.body;
  db.prepare(`UPDATE destination_tag_filters SET tag_name=?, tag_value=?, negate_severity=? WHERE id=?`)
    .run(tag_name??f.tag_name, tag_value??f.tag_value, negate_severity!==undefined?(negate_severity?1:0):f.negate_severity, req.params.filterId);
  res.json({ success: true });
});

router.delete('/:id/tag-filters/:filterId', (req, res) => {
  db.prepare(`DELETE FROM destination_tag_filters WHERE id = ? AND destination_id = ?`).run(req.params.filterId, req.params.id);
  res.json({ success: true });
});

// Schedule rules (rule 2 — with tag filter)
router.post('/:id/schedules', (req, res) => {
  const { severity, days_of_week, start_time, end_time, action='hold', active=1,
    tag_filter_name='', tag_filter_value='', tag_filter_negate=0 } = req.body;
  if (!severity || !start_time || !end_time) return res.status(400).json({ error: 'severity, start_time, end_time required' });
  const r = db.prepare(`INSERT INTO schedule_rules (destination_id,severity,days_of_week,start_time,end_time,action,tag_filter_name,tag_filter_value,tag_filter_negate,active) VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .run(req.params.id, severity, days_of_week||'1,2,3,4,5', start_time, end_time, action,
      tag_filter_name, tag_filter_value, tag_filter_negate?1:0, active?1:0);
  res.json({ id: r.lastInsertRowid, ...req.body });
});

router.put('/:id/schedules/:sid', (req, res) => {
  const s = db.prepare(`SELECT * FROM schedule_rules WHERE id = ? AND destination_id = ?`).get(req.params.sid, req.params.id);
  if (!s) return res.status(404).json({ error: 'Not found' });
  const { severity, days_of_week, start_time, end_time, action, active,
    tag_filter_name, tag_filter_value, tag_filter_negate } = req.body;
  db.prepare(`UPDATE schedule_rules SET severity=?,days_of_week=?,start_time=?,end_time=?,action=?,tag_filter_name=?,tag_filter_value=?,tag_filter_negate=?,active=? WHERE id=?`)
    .run(severity??s.severity, days_of_week??s.days_of_week, start_time??s.start_time, end_time??s.end_time,
      action??s.action, tag_filter_name??s.tag_filter_name, tag_filter_value??s.tag_filter_value,
      tag_filter_negate!==undefined?(tag_filter_negate?1:0):s.tag_filter_negate,
      active!==undefined?(active?1:0):s.active, req.params.sid);
  res.json({ success: true });
});

router.delete('/:id/schedules/:sid', (req, res) => {
  db.prepare(`DELETE FROM schedule_rules WHERE id = ? AND destination_id = ?`).run(req.params.sid, req.params.id);
  res.json({ success: true });
});

module.exports = router;

// ── Severity Conditions (optional TAG per severity) ─────────────────────────
router.get('/:id/severity-conditions', (req, res) => {
  res.json(db.prepare(`SELECT * FROM destination_severity_conditions WHERE destination_id = ?`).all(req.params.id));
});

router.post('/:id/severity-conditions', (req, res) => {
  const { severity, tag_name = '', tag_value = '' } = req.body;
  if (!severity) return res.status(400).json({ error: 'severity required' });
  const r = db.prepare(`INSERT INTO destination_severity_conditions (destination_id,severity,tag_name,tag_value) VALUES (?,?,?,?)`)
    .run(req.params.id, severity, tag_name, tag_value);
  res.json({ id: r.lastInsertRowid, severity, tag_name, tag_value });
});

router.delete('/:id/severity-conditions/:cid', (req, res) => {
  db.prepare(`DELETE FROM destination_severity_conditions WHERE id = ? AND destination_id = ?`).run(req.params.cid, req.params.id);
  res.json({ success: true });
});

// ── Mention Filters (who gets mentioned — does NOT affect routing) ──────────
router.get('/:id/mention-filters', (req, res) => {
  res.json(db.prepare(`SELECT * FROM destination_mention_filters WHERE destination_id = ?`).all(req.params.id));
});

router.post('/:id/mention-filters', (req, res) => {
  const { tag_name, tag_value = '' } = req.body;
  if (!tag_name) return res.status(400).json({ error: 'tag_name required' });
  const r = db.prepare(`INSERT INTO destination_mention_filters (destination_id,tag_name,tag_value) VALUES (?,?,?)`)
    .run(req.params.id, tag_name, tag_value);
  res.json({ id: r.lastInsertRowid, tag_name, tag_value });
});

router.delete('/:id/mention-filters/:mid', (req, res) => {
  db.prepare(`DELETE FROM destination_mention_filters WHERE id = ? AND destination_id = ?`).run(req.params.mid, req.params.id);
  res.json({ success: true });
});
