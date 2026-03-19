const express = require('express');
const router = express.Router();
const db = require('../database');
const { authMiddleware } = require('../middleware/auth');

router.use(authMiddleware);

router.get('/', (req, res) => {
  res.json(db.prepare(`SELECT * FROM tag_phone_mappings ORDER BY tag_name, tag_value`).all());
});

router.post('/', (req, res) => {
  const { tag_name, tag_value, phone_number, description = '' } = req.body;
  if (!tag_name || !tag_value || !phone_number) return res.status(400).json({ error: 'tag_name, tag_value, phone_number required' });

  const phone = phone_number.replace(/\D/g, '');
  const result = db.prepare(`INSERT INTO tag_phone_mappings (tag_name, tag_value, phone_number, description) VALUES (?, ?, ?, ?)`)
    .run(tag_name, tag_value, phone, description);
  res.json({ id: result.lastInsertRowid, tag_name, tag_value, phone_number: phone, description });
});

router.put('/:id', (req, res) => {
  const m = db.prepare(`SELECT * FROM tag_phone_mappings WHERE id = ?`).get(req.params.id);
  if (!m) return res.status(404).json({ error: 'Not found' });
  const { tag_name, tag_value, phone_number, description } = req.body;
  const phone = phone_number ? phone_number.replace(/\D/g, '') : m.phone_number;
  db.prepare(`UPDATE tag_phone_mappings SET tag_name = ?, tag_value = ?, phone_number = ?, description = ? WHERE id = ?`)
    .run(tag_name ?? m.tag_name, tag_value ?? m.tag_value, phone, description ?? m.description, req.params.id);
  res.json({ success: true });
});

router.delete('/:id', (req, res) => {
  db.prepare(`DELETE FROM tag_phone_mappings WHERE id = ?`).run(req.params.id);
  res.json({ success: true });
});

module.exports = router;
