const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const db = require('../database');
const { authMiddleware, adminOnly } = require('../middleware/auth');

router.use(authMiddleware);

router.get('/', adminOnly, (req, res) => {
  const users = db.prepare(`SELECT id, username, role, active, created_at FROM users ORDER BY id`).all();
  res.json(users);
});

router.post('/', adminOnly, (req, res) => {
  const { username, password, role = 'operator' } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
  if (!['admin', 'operator'].includes(role)) return res.status(400).json({ error: 'Invalid role' });

  try {
    const hash = bcrypt.hashSync(password, 10);
    const result = db.prepare(`INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)`).run(username, hash, role);
    res.json({ id: result.lastInsertRowid, username, role });
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(409).json({ error: 'Username already exists' });
    throw e;
  }
});

router.put('/:id', adminOnly, (req, res) => {
  const { username, role, active } = req.body;
  const user = db.prepare(`SELECT * FROM users WHERE id = ?`).get(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  db.prepare(`UPDATE users SET username = ?, role = ?, active = ? WHERE id = ?`)
    .run(username ?? user.username, role ?? user.role, active ?? user.active, req.params.id);
  res.json({ success: true });
});

router.put('/:id/password', (req, res) => {
  const { currentPassword, newPassword } = req.body;
  const isAdmin = req.user.role === 'admin';
  const isSelf = req.user.id === parseInt(req.params.id);

  if (!isAdmin && !isSelf) return res.status(403).json({ error: 'Forbidden' });

  const user = db.prepare(`SELECT * FROM users WHERE id = ?`).get(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  if (!isAdmin) {
    if (!bcrypt.compareSync(currentPassword, user.password_hash)) {
      return res.status(401).json({ error: 'Current password incorrect' });
    }
  }

  if (!newPassword || newPassword.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
  db.prepare(`UPDATE users SET password_hash = ? WHERE id = ?`).run(bcrypt.hashSync(newPassword, 10), req.params.id);
  res.json({ success: true });
});

router.delete('/:id', adminOnly, (req, res) => {
  if (req.user.id === parseInt(req.params.id)) return res.status(400).json({ error: 'Cannot delete yourself' });
  db.prepare(`UPDATE users SET active = 0 WHERE id = ?`).run(req.params.id);
  res.json({ success: true });
});

module.exports = router;
