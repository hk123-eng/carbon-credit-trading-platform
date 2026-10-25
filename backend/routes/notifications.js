const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const { authMiddleware } = require('../middleware/auth');

// GET /api/notifications - Latest notifications and unread count
router.get('/', authMiddleware, async (req, res) => {
  try {
    const list = await pool.query(`
      SELECT id, kind, title, body, link_page, is_read, created_at
      FROM auth.notifications WHERE user_id = $1
      ORDER BY created_at DESC, id DESC LIMIT 50
    `, [req.user.id]);
    const unread = await pool.query(
      'SELECT COUNT(*)::INT AS n FROM auth.notifications WHERE user_id = $1 AND NOT is_read', [req.user.id]
    );
    res.json({ unread: unread.rows[0].n, notifications: list.rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch notifications.' });
  }
});

// POST /api/notifications/read-all
router.post('/read-all', authMiddleware, async (req, res) => {
  try {
    const r = await pool.query(
      'UPDATE auth.notifications SET is_read = TRUE WHERE user_id = $1 AND NOT is_read', [req.user.id]
    );
    res.json({ updated: r.rowCount });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update notifications.' });
  }
});

// POST /api/notifications/:id/read
router.post('/:id/read', authMiddleware, async (req, res) => {
  if (!/^\d+$/.test(req.params.id)) return res.status(404).json({ error: 'Notification not found.' });
  try {
    const r = await pool.query(
      'UPDATE auth.notifications SET is_read = TRUE WHERE id = $1 AND user_id = $2 RETURNING id', [req.params.id, req.user.id]
    );
    if (r.rows.length === 0) return res.status(404).json({ error: 'Notification not found.' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update notification.' });
  }
});

module.exports = router;
