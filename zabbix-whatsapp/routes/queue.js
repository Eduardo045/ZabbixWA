const express = require('express');
const router = express.Router();
const db = require('../database');
const { authMiddleware } = require('../middleware/auth');
const queueService = require('../services/queueService');

router.use(authMiddleware);

router.get('/', (req, res) => {
  const { status, destination_id, limit = 100, offset = 0 } = req.query;
  let query = `
    SELECT q.*, d.name as destination_name
    FROM alert_queue q
    LEFT JOIN destinations d ON q.destination_id = d.id
    WHERE 1=1
  `;
  const params = [];
  if (status) { query += ` AND q.status = ?`; params.push(status); }
  if (destination_id) { query += ` AND q.destination_id = ?`; params.push(destination_id); }
  query += ` ORDER BY q.created_at DESC LIMIT ? OFFSET ?`;
  params.push(parseInt(limit), parseInt(offset));

  const items = db.prepare(query).all(...params);
  const total = db.prepare(`SELECT COUNT(*) as c FROM alert_queue WHERE 1=1${status ? ' AND status = ?' : ''}${destination_id ? ' AND destination_id = ?' : ''}`).get(...params.slice(0, -2)).c;
  res.json({ items, total });
});

router.get('/stats', (req, res) => {
  const statuses = ['pending', 'sending', 'sent', 'failed', 'skipped', 'held'];
  const stats = {};
  for (const s of statuses) {
    stats[s] = db.prepare(`SELECT COUNT(*) as c FROM alert_queue WHERE status = ?`).get(s).c;
  }
  stats.paused = queueService.isPaused();
  stats.total = Object.values(stats).reduce((a, b) => typeof b === 'number' ? a + b : a, 0) - (stats.paused ? 1 : 0);
  res.json(stats);
});

router.post('/pause', (req, res) => {
  queueService.pause();
  res.json({ paused: true });
});

router.post('/resume', (req, res) => {
  queueService.resume();
  res.json({ paused: false });
});

router.post('/flush', (req, res) => {
  const { destination_id, status = 'pending' } = req.body;
  let query = `DELETE FROM alert_queue WHERE status IN ('pending', 'held')`;
  const params = [];
  if (destination_id) { query += ` AND destination_id = ?`; params.push(destination_id); }
  const result = db.prepare(query).run(...params);
  res.json({ deleted: result.changes });
});

router.post('/retry-failed', (req, res) => {
  const result = db.prepare(`UPDATE alert_queue SET status = 'pending', retry_count = 0, error_message = NULL, scheduled_at = CURRENT_TIMESTAMP WHERE status = 'failed'`).run();
  res.json({ updated: result.changes });
});

router.post('/clear-failed', (req, res) => {
  const result = db.prepare(`DELETE FROM alert_queue WHERE status = 'failed'`).run();
  res.json({ deleted: result.changes });
});

router.post('/clear-sent', (req, res) => {
  const result = db.prepare(`DELETE FROM alert_queue WHERE status IN ('sent', 'skipped')`).run();
  res.json({ deleted: result.changes });
});

router.post('/:id/force', async (req, res) => {
  const item = db.prepare(`SELECT * FROM alert_queue WHERE id = ?`).get(req.params.id);
  if (!item) return res.status(404).json({ error: 'Not found' });
  try {
    await queueService.forceProcess(item);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/:id/hold', (req, res) => {
  db.prepare(`UPDATE alert_queue SET status = 'held', scheduled_at = ? WHERE id = ?`)
    .run(req.body.scheduled_at || new Date(Date.now() + 3600000).toISOString(), req.params.id);
  res.json({ success: true });
});

router.delete('/:id', (req, res) => {
  db.prepare(`DELETE FROM alert_queue WHERE id = ?`).run(req.params.id);
  res.json({ success: true });
});

module.exports = router;
