const express = require('express');
const router = express.Router();
const db = require('../database');
const { authMiddleware } = require('../middleware/auth');

router.use(authMiddleware);

router.get('/', (req, res) => {
  res.json(db.prepare(`SELECT * FROM global_tags ORDER BY name`).all());
});

router.post('/', (req, res) => {
  const { name, description = '', color = '#00d4ff' } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  try {
    const r = db.prepare(`INSERT INTO global_tags (name, description, color) VALUES (?, ?, ?)`).run(name.trim(), description, color);
    res.json({ id: r.lastInsertRowid, name, description, color });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.put('/:id', (req, res) => {
  const t = db.prepare(`SELECT * FROM global_tags WHERE id = ?`).get(req.params.id);
  if (!t) return res.status(404).json({ error: 'Not found' });
  const { name, description, color } = req.body;
  db.prepare(`UPDATE global_tags SET name = ?, description = ?, color = ? WHERE id = ?`)
    .run(name ?? t.name, description ?? t.description, color ?? t.color, req.params.id);
  res.json({ success: true });
});

router.delete('/:id', (req, res) => {
  db.prepare(`DELETE FROM global_tags WHERE id = ?`).run(req.params.id);
  res.json({ success: true });
});

module.exports = router;
