const express = require('express');
const router = express.Router();
const { pool, audit } = require('../db');
const { authMiddleware, adminOnly } = require('../middleware/auth');
const { expireOrders } = require('../jobs/order-expiry');

// GET /api/admin/stats - Platform totals for the admin overview
router.get('/stats', authMiddleware, adminOnly, async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM registry.companies)                                   AS companies,
        (SELECT COUNT(*) FROM registry.companies WHERE kyc_status = 'pending')      AS kyc_pending,
        (SELECT COUNT(*) FROM registry.carbon_projects WHERE status = 'pending')    AS projects_pending,
        (SELECT COUNT(*) FROM trading.trades)                                       AS trades,
        (SELECT COALESCE(SUM(quantity), 0) FROM trading.trades)                     AS volume_tonnes,
        (SELECT COALESCE(SUM(total_value), 0) FROM trading.trades)                  AS traded_value,
        (SELECT COALESCE(SUM(platform_fee), 0) FROM trading.trades)                 AS fee_revenue,
        (SELECT COALESCE(SUM(quantity), 0) FROM registry.retirements)               AS retired_tonnes,
        (SELECT COALESCE(SUM(balance), 0) FROM trading.wallets)                     AS wallet_funds,
        (SELECT COALESCE(SUM(reserved), 0) FROM trading.wallets)                    AS escrow_funds,
        (SELECT COUNT(*) FROM trading.orders WHERE status IN ('open','partially_filled')) AS open_orders
    `);
    res.json(r.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch platform statistics.' });
  }
});

// POST /api/admin/jobs/expire-orders - Run the order-expiry job now
router.post('/jobs/expire-orders', authMiddleware, adminOnly, async (req, res) => {
  try {
    const expired = await expireOrders(pool);
    await audit(pool, req.user.id, 'UPDATE', 'trading', 'orders', null);
    res.json({ message: `${expired} order(s) expired.`, expired });
  } catch (err) {
    console.error('Expiry job error:', err.message);
    res.status(500).json({ error: 'Order expiry job failed.' });
  }
});

// GET /api/admin/retirements - All retirement certificates
router.get('/retirements', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { CERTIFICATE_SQL } = require('./trading');
    const r = await pool.query(CERTIFICATE_SQL + ' ORDER BY r.retired_at DESC LIMIT 200');
    res.json(r.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch retirements.' });
  }
});

module.exports = router;
