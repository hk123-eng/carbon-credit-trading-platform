const express = require('express');
const router = express.Router();
const { pool, audit } = require('../db');
const { authMiddleware, adminOnly } = require('../middleware/auth');
const { notifyCompany } = require('../lib/notify');

// GET /api/compliance/reports - My emissions reports
router.get('/reports', authMiddleware, async (req, res) => {
  try {
    const companyResult = await pool.query('SELECT id FROM registry.companies WHERE user_id = $1', [req.user.id]);
    if (companyResult.rows.length === 0) return res.json([]);

    const result = await pool.query(`
      SELECT * FROM compliance.v_emissions_dashboard
      WHERE company_id = $1 ORDER BY report_year DESC
    `, [companyResult.rows[0].id]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch emissions reports.' });
  }
});

// POST /api/compliance/reports - Submit emissions report
router.post('/reports', authMiddleware, async (req, res) => {
  const { report_year, scope1_tonnes, scope2_tonnes, scope3_tonnes,
          credits_purchased, methodology, third_party_verified, verifier_name } = req.body;
  if (!report_year || scope1_tonnes === undefined || scope2_tonnes === undefined || scope3_tonnes === undefined) {
    return res.status(400).json({ error: 'report_year, scope1, scope2, scope3 are required.' });
  }
  const year = Number(report_year);
  if (!Number.isInteger(year) || year < 2000 || year > new Date().getFullYear()) {
    return res.status(400).json({ error: 'Report year must be a past or current year.' });
  }
  for (const v of [scope1_tonnes, scope2_tonnes, scope3_tonnes]) {
    if (!(Number(v) >= 0)) return res.status(400).json({ error: 'Emission figures must be zero or more.' });
  }

  const client = await pool.connect();
  try {
    const companyResult = await client.query('SELECT id FROM registry.companies WHERE user_id = $1', [req.user.id]);
    if (companyResult.rows.length === 0) return res.status(404).json({ error: 'Company not found.' });

    const result = await client.query(`
      INSERT INTO compliance.emissions_reports
        (company_id, report_year, scope1_tonnes, scope2_tonnes, scope3_tonnes,
         credits_purchased, credits_retired, methodology, third_party_verified, verifier_name,
         status, submitted_at)
      VALUES ($1,$2,$3,$4,$5,$6,
              (SELECT COALESCE(SUM(quantity), 0) FROM registry.retirements WHERE company_id = $1 AND report_year = $2),
              $7,$8,$9,'submitted', NOW())
      RETURNING id, report_year, total_tonnes, credits_retired, status
    `, [companyResult.rows[0].id, year, scope1_tonnes, scope2_tonnes, scope3_tonnes,
        credits_purchased || 0,
        methodology || 'GHG Protocol', third_party_verified || false, verifier_name || null]);

    await audit(client, req.user.id, 'INSERT', 'compliance', 'emissions_reports', result.rows[0].id);
    res.status(201).json({ message: 'Emissions report submitted.', report: result.rows[0] });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'A report for this year has already been submitted.' });
    console.error('Submit report error:', err.message);
    res.status(500).json({ error: 'Failed to submit report.' });
  } finally {
    client.release();
  }
});

// GET /api/compliance/targets - My reduction targets
router.get('/targets', authMiddleware, async (req, res) => {
  try {
    const companyResult = await pool.query('SELECT id FROM registry.companies WHERE user_id = $1', [req.user.id]);
    if (companyResult.rows.length === 0) return res.json([]);
    const result = await pool.query('SELECT * FROM compliance.emission_targets WHERE company_id = $1 ORDER BY target_year', [companyResult.rows[0].id]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch targets.' });
  }
});

// POST /api/compliance/targets
router.post('/targets', authMiddleware, async (req, res) => {
  const { baseline_year, target_year, reduction_pct, target_type, description, is_public } = req.body;
  if (!baseline_year || !target_year || !reduction_pct || !target_type) {
    return res.status(400).json({ error: 'baseline_year, target_year, reduction_pct, target_type are required.' });
  }
  const client = await pool.connect();
  try {
    const companyResult = await client.query('SELECT id FROM registry.companies WHERE user_id = $1', [req.user.id]);
    if (companyResult.rows.length === 0) return res.status(404).json({ error: 'Company not found.' });
    const result = await client.query(`
      INSERT INTO compliance.emission_targets (company_id, baseline_year, target_year, reduction_pct, target_type, description, is_public)
      VALUES ($1,$2,$3,$4,$5,$6,$7)
      RETURNING id, target_year, reduction_pct, target_type
    `, [companyResult.rows[0].id, baseline_year, target_year, reduction_pct, target_type, description || null, is_public !== false]);
    await audit(client, req.user.id, 'INSERT', 'compliance', 'emission_targets', result.rows[0].id);
    res.status(201).json({ message: 'Target set.', target: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Failed to set target: ' + err.message });
  } finally {
    client.release();
  }
});

// GET /api/compliance/admin/reports - All reports (admin)
router.get('/admin/reports', authMiddleware, adminOnly, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM compliance.v_emissions_dashboard ORDER BY report_year DESC');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch reports.' });
  }
});

// PUT /api/compliance/admin/reports/:id/review
router.put('/admin/reports/:id/review', authMiddleware, adminOnly, async (req, res) => {
  const { status, review_notes } = req.body;
  if (!['approved', 'rejected', 'under_review'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status.' });
  }
  const client = await pool.connect();
  try {
    const result = await client.query(`
      UPDATE compliance.emissions_reports
      SET status = $1, reviewed_by = $2, reviewed_at = NOW(), review_notes = $3
      WHERE id = $4
      RETURNING id, report_year, status, company_id
    `, [status, req.user.id, review_notes || null, req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Report not found.' });
    await audit(client, req.user.id, 'UPDATE', 'compliance', 'emissions_reports', result.rows[0].id);
    await notifyCompany(client, result.rows[0].company_id, 'report',
      `Your ${result.rows[0].report_year} emissions report was ${status.replace('_', ' ')}`,
      review_notes ? `Reviewer notes: ${review_notes}` : null, 'compliance');
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Review failed: ' + err.message });
  } finally {
    client.release();
  }
});

module.exports = router;
