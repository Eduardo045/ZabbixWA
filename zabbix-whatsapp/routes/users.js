const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const db = require('../database');
const { authMiddleware, adminOnly } = require('../middleware/auth');

router.use(authMiddleware);

// Password strength validation
function validatePassword(pw) {
  if (!pw || pw.length < 8) return 'A senha deve ter ao menos 8 caracteres';
  if (!/[A-Za-z]/.test(pw)) return 'A senha deve conter ao menos uma letra';
  if (!/[0-9]/.test(pw)) return 'A senha deve conter ao menos um número';
  return null;
}

router.get('/', adminOnly, (req, res) => {
  const users = db.prepare(`SELECT id, username, role, active, created_at FROM users ORDER BY id`).all();
  res.json(users);
});

router.post('/', adminOnly, (req, res) => {
  const { username, password, role = 'operator' } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
  if (!['admin', 'operator'].includes(role)) return res.status(400).json({ error: 'Invalid role' });

  // Username: alphanumeric + dots/underscores/hyphens only
  if (!/^[a-zA-Z0-9._-]{3,50}$/.test(username)) {
    return res.status(400).json({ error: 'Username must be 3-50 alphanumeric characters (. _ - allowed)' });
  }

  const pwError = validatePassword(password);
  if (pwError) return res.status(400).json({ error: pwError });

  try {
    const hash = bcrypt.hashSync(password, 12); // increased from 10
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

  if (username && !/^[a-zA-Z0-9._-]{3,50}$/.test(username)) {
    return res.status(400).json({ error: 'Invalid username format' });
  }
  if (role && !['admin', 'operator'].includes(role)) {
    return res.status(400).json({ error: 'Invalid role' });
  }

  db.prepare(`UPDATE users SET username = ?, role = ?, active = ? WHERE id = ?`)
    .run(username ?? user.username, role ?? user.role, active !== undefined ? (active ? 1 : 0) : user.active, req.params.id);
  res.json({ success: true });
});

router.put('/:id/password', (req, res) => {
  const { currentPassword, newPassword } = req.body;
  const isAdmin = req.user.role === 'admin';
  const isSelf = req.user.id === parseInt(req.params.id);

  if (!isAdmin && !isSelf) return res.status(403).json({ error: 'Forbidden' });

  const user = db.prepare(`SELECT * FROM users WHERE id = ?`).get(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  // Non-admin must provide current password
  if (!isAdmin) {
    if (!currentPassword || !bcrypt.compareSync(currentPassword, user.password_hash)) {
      return res.status(401).json({ error: 'Current password incorrect' });
    }
  }

  const pwError = validatePassword(newPassword);
  if (pwError) return res.status(400).json({ error: pwError });

  db.prepare(`UPDATE users SET password_hash = ? WHERE id = ?`).run(bcrypt.hashSync(newPassword, 12), req.params.id);
  res.json({ success: true });
});

router.delete('/:id', adminOnly, (req, res) => {
  if (req.user.id === parseInt(req.params.id)) return res.status(400).json({ error: 'Cannot delete yourself' });
  db.prepare(`UPDATE users SET active = 0 WHERE id = ?`).run(req.params.id);
  res.json({ success: true });
});

module.exports = router;
