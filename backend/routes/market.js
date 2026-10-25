const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const { authMiddleware } = require('../middleware/auth');

// GET /api/market - Market overview (all available credits)
router.get('/', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(`SELECT * FROM trading.v_market_overview ORDER BY current_price DESC NULLS LAST`);
    res.json(result.rows);
  } catch (err) {
    console.error('Market overview error:', err.message);
    res.status(500).json({ error: 'Failed to fetch market data.' });
  }
});

// GET /api/market/credits - All available credits
router.get('/credits', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT cc.id, cc.serial_number, cc.vintage_year, cc.quantity, cc.price_per_unit,
             cc.status, cc.additional_benefits, cc.co2_methodology,
             cp.name AS project_name, cp.project_type, cp.verification_standard,
             cp.country AS project_country, cp.description AS project_description,
             comp.legal_name AS seller_name, comp.reliability_score
      FROM registry.carbon_credits cc
      JOIN registry.carbon_projects cp ON cc.project_id = cp.id
      JOIN registry.companies comp ON cp.company_id = comp.id
      WHERE cc.status = 'available'
      ORDER BY cc.issued_at DESC
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch credits.' });
  }
});

// GET /api/market/credit/:id - Single credit detail
router.get('/credit/:id', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT cc.*, cp.name AS project_name, cp.project_type, cp.verification_standard,
             cp.description AS project_description, cp.country AS project_country,
             cp.start_date, cp.end_date, cp.verification_body,
             comp.legal_name AS seller_name, comp.reliability_score
      FROM registry.carbon_credits cc
      JOIN registry.carbon_projects cp ON cc.project_id = cp.id
      JOIN registry.companies comp ON cp.company_id = comp.id
      WHERE cc.id = $1
    `, [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Credit not found.' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch credit.' });
  }
});

// GET /api/market/prices/:creditId - Price history
router.get('/prices/:creditId', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT price, volume_24h, high_24h, low_24h, open_price, recorded_at
      FROM trading.market_prices
      WHERE credit_id = $1
      ORDER BY recorded_at DESC
      LIMIT 90
    `, [req.params.creditId]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch price history.' });
  }
});

// GET /api/market/orders/:creditId - Open orders for a credit
router.get('/orders/:creditId', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT o.id, o.order_type, o.quantity, o.price_per_unit, o.filled_qty, o.status, o.placed_at,
             c.legal_name AS company_name
      FROM trading.orders o
      JOIN registry.companies c ON o.company_id = c.id
      WHERE o.credit_id = $1 AND o.status IN ('open','partially_filled')
      ORDER BY o.price_per_unit DESC, o.placed_at ASC
    `, [req.params.creditId]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch orders.' });
  }
});

// GET /api/market/certificates/:number - Public check that a retirement certificate is genuine
router.get('/certificates/:number', async (req, res) => {
  if (!/^RET-\d{4}-\d{6}$/.test(req.params.number)) return res.status(404).json({ error: 'Certificate not found.' });
  try {
    const result = await pool.query(`
      SELECT r.certificate_number, r.quantity, r.beneficiary, r.report_year, r.retired_at,
             comp.legal_name AS retired_by, cc.serial_number, cc.vintage_year,
             cp.name AS project_name, cp.verification_standard
      FROM registry.retirements r
      JOIN registry.companies comp ON comp.id = r.company_id
      JOIN registry.carbon_credits cc ON cc.id = r.credit_id
      JOIN registry.carbon_projects cp ON cp.id = cc.project_id
      WHERE r.certificate_number = $1
    `, [req.params.number]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Certificate not found.' });
    res.json({ valid: true, ...result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Lookup failed.' });
  }
});

module.exports = router;
