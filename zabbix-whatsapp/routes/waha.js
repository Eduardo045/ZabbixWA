const express = require('express');
const router = express.Router();
const db = require('../database');
const { authMiddleware } = require('../middleware/auth');
const wahaService = require('../services/wahaService');

router.use(authMiddleware);

router.get('/', (req, res) => {
  const sessions = db.prepare(`SELECT * FROM waha_sessions ORDER BY id`).all();
  res.json(sessions);
});

router.post('/', async (req, res) => {
  const { name, api_url, api_key = '', session_name = 'default' } = req.body;
  if (!name || !api_url) return res.status(400).json({ error: 'name and api_url required' });

  try {
    const result = db.prepare(`INSERT INTO waha_sessions (name, api_url, api_key, session_name) VALUES (?, ?, ?, ?)`)
      .run(name, api_url.replace(/\/$/, ''), api_key, session_name);
    res.json({ id: result.lastInsertRowid, name, api_url, session_name });
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(409).json({ error: 'Session name already exists' });
    throw e;
  }
});

router.put('/:id', (req, res) => {
  const { name, api_url, api_key, session_name } = req.body;
  const s = db.prepare(`SELECT * FROM waha_sessions WHERE id = ?`).get(req.params.id);
  if (!s) return res.status(404).json({ error: 'Not found' });

  db.prepare(`UPDATE waha_sessions SET name = ?, api_url = ?, api_key = ?, session_name = ? WHERE id = ?`)
    .run(name ?? s.name, (api_url ?? s.api_url).replace(/\/$/, ''), api_key ?? s.api_key, session_name ?? s.session_name, req.params.id);
  res.json({ success: true });
});

router.delete('/:id', (req, res) => {
  db.prepare(`DELETE FROM waha_sessions WHERE id = ?`).run(req.params.id);
  res.json({ success: true });
});

router.post('/:id/start', async (req, res) => {
  const s = db.prepare(`SELECT * FROM waha_sessions WHERE id = ?`).get(req.params.id);
  if (!s) return res.status(404).json({ error: 'Not found' });
  try {
    const result = await wahaService.startSession(s);
    db.prepare(`UPDATE waha_sessions SET status = 'starting' WHERE id = ?`).run(req.params.id);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/:id/stop', async (req, res) => {
  const s = db.prepare(`SELECT * FROM waha_sessions WHERE id = ?`).get(req.params.id);
  if (!s) return res.status(404).json({ error: 'Not found' });
  try {
    await wahaService.stopSession(s);
    db.prepare(`UPDATE waha_sessions SET status = 'stopped' WHERE id = ?`).run(req.params.id);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/:id/status', async (req, res) => {
  const s = db.prepare(`SELECT * FROM waha_sessions WHERE id = ?`).get(req.params.id);
  if (!s) return res.status(404).json({ error: 'Not found' });
  try {
    const status = await wahaService.getSessionStatus(s);
    db.prepare(`UPDATE waha_sessions SET status = ? WHERE id = ?`).run(status.status || 'unknown', req.params.id);
    res.json(status);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/:id/chats', async (req, res) => {
  const s = db.prepare(`SELECT * FROM waha_sessions WHERE id = ?`).get(req.params.id);
  if (!s) return res.status(404).json({ error: 'Not found' });
  try {
    const chats = await wahaService.listChats(s);
    res.json(chats);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
