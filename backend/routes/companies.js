const express = require('express');
const router = express.Router();
const { pool, audit } = require('../db');
const { authMiddleware, adminOnly } = require('../middleware/auth');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const wallet = require('../lib/wallet');
const { notifyCompany, notifyAdmins } = require('../lib/notify');
const { checkSerial, checkVintage } = require('../lib/registry-rules');

const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, '..', 'uploads', 'kyc');
const MAX_DOC_BYTES = 5 * 1024 * 1024;
const DOC_TYPES = ['certificate_of_incorporation', 'tax_registration', 'address_proof', 'authorised_signatory_id', 'other'];
// Accepted file types, checked against the file's own leading bytes (not just its name)
const MIME_SIGNATURES = {
  'application/pdf': { ext: '.pdf', magic: Buffer.from('%PDF') },
  'image/png': { ext: '.png', magic: Buffer.from([0x89, 0x50, 0x4e, 0x47]) },
  'image/jpeg': { ext: '.jpg', magic: Buffer.from([0xff, 0xd8, 0xff]) },
};

// GET /api/companies/my - Get my company profile
router.get('/my', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT c.*, u.email, u.full_name, u.phone, u.is_verified
      FROM registry.companies c
      JOIN auth.users u ON c.user_id = u.id
      WHERE c.user_id = $1
    `, [req.user.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Company not found.' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch company.' });
  }
});

// POST /api/companies - Register my company
router.post('/', authMiddleware, async (req, res) => {
  const {
    legal_name, trade_name, company_type, registration_number, country,
    industry_sector, annual_revenue_usd, employee_count,
    primary_pollution_sources, annual_emissions_baseline, emissions_unit, founded_year
  } = req.body;

  if (!legal_name || !company_type || !registration_number || !country || !industry_sector) {
    return res.status(400).json({ error: 'Missing required fields.' });
  }

  const client = await pool.connect();
  try {
    const verified = await client.query('SELECT is_verified FROM auth.users WHERE id = $1', [req.user.id]);
    if (!verified.rows[0] || !verified.rows[0].is_verified) {
      return res.status(403).json({ error: 'Please verify your e-mail address before registering a company.' });
    }
    const existing = await client.query('SELECT id FROM registry.companies WHERE user_id = $1', [req.user.id]);
    if (existing.rows.length > 0) return res.status(409).json({ error: 'Company already registered.' });

    const result = await client.query(`
      INSERT INTO registry.companies
        (user_id, legal_name, trade_name, company_type, registration_number, country,
         industry_sector, annual_revenue_usd, employee_count,
         primary_pollution_sources, annual_emissions_baseline, emissions_unit, founded_year)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
      RETURNING id, legal_name, kyc_status, created_at
    `, [
      req.user.id, legal_name, trade_name || null, company_type, registration_number,
      country.toUpperCase(), industry_sector, annual_revenue_usd || null,
      employee_count || null,
      primary_pollution_sources ? `{${primary_pollution_sources.join(',')}}` : '{}',
      annual_emissions_baseline || null, emissions_unit || 'tCO2e', founded_year || null
    ]);

    await wallet.ensureWallet(client, result.rows[0].id);
    await audit(client, req.user.id, 'INSERT', 'registry', 'companies', result.rows[0].id);
    await notifyAdmins(client, 'kyc', `New company registered: ${legal_name}`, 'Waiting for KYC documents and review.');
    res.status(201).json({ message: 'Company registered. Upload your KYC documents for review.', company: result.rows[0] });
  } catch (err) {
    console.error('Company register error:', err.message);
    res.status(500).json({ error: 'Failed to register company: ' + err.message });
  } finally {
    client.release();
  }
});

// PUT /api/companies/my - Update my company
router.put('/my', authMiddleware, async (req, res) => {
  const { trade_name, annual_revenue_usd, employee_count, primary_pollution_sources, annual_emissions_baseline } = req.body;
  try {
    const result = await pool.query(`
      UPDATE registry.companies
      SET trade_name = COALESCE($1, trade_name),
          annual_revenue_usd = COALESCE($2, annual_revenue_usd),
          employee_count = COALESCE($3, employee_count),
          annual_emissions_baseline = COALESCE($4, annual_emissions_baseline)
      WHERE user_id = $5
      RETURNING id, legal_name, updated_at
    `, [trade_name, annual_revenue_usd, employee_count, annual_emissions_baseline, req.user.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Company not found.' });
    await audit(pool, req.user.id, 'UPDATE', 'registry', 'companies', result.rows[0].id);
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Update failed.' });
  }
});

// GET /api/companies/projects - My company's projects (seller)
router.get('/projects', authMiddleware, async (req, res) => {
  try {
    const companyResult = await pool.query('SELECT id FROM registry.companies WHERE user_id = $1', [req.user.id]);
    if (companyResult.rows.length === 0) return res.json([]);

    const result = await pool.query(`
      SELECT cp.*, COUNT(cc.id) AS credit_count, COALESCE(SUM(cc.quantity), 0) AS total_issued
      FROM registry.carbon_projects cp
      LEFT JOIN registry.carbon_credits cc ON cc.project_id = cp.id
      WHERE cp.company_id = $1
      GROUP BY cp.id
      ORDER BY cp.created_at DESC
    `, [companyResult.rows[0].id]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch projects.' });
  }
});

// POST /api/companies/projects - Create a project (seller)
router.post('/projects', authMiddleware, async (req, res) => {
  const { name, description, project_type, verification_standard, verification_body,
          country, total_credits_cap, start_date, end_date } = req.body;
  if (!name || !description || !project_type || !verification_standard || !verification_body ||
      !country || !total_credits_cap || !start_date || !end_date) {
    return res.status(400).json({ error: 'All project fields are required.' });
  }

  const client = await pool.connect();
  try {
    const companyResult = await client.query(
      'SELECT id, kyc_status, company_type FROM registry.companies WHERE user_id = $1', [req.user.id]
    );
    if (companyResult.rows.length === 0) return res.status(404).json({ error: 'Company not found.' });
    const company = companyResult.rows[0];
    if (company.kyc_status !== 'approved') return res.status(403).json({ error: 'KYC approval required.' });
    if (!['seller', 'both'].includes(company.company_type)) return res.status(403).json({ error: 'Only sellers can create projects.' });

    const result = await client.query(`
      INSERT INTO registry.carbon_projects
        (company_id, name, description, project_type, verification_standard, verification_body,
         country, total_credits_cap, start_date, end_date)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      RETURNING id, name, status, created_at
    `, [company.id, name, description, project_type, verification_standard, verification_body,
        country.toUpperCase(), total_credits_cap, start_date, end_date]);

    await audit(client, req.user.id, 'INSERT', 'registry', 'carbon_projects', result.rows[0].id);
    res.status(201).json({ message: 'Project submitted for review.', project: result.rows[0] });
  } catch (err) {
    console.error('Create project error:', err.message);
    res.status(500).json({ error: 'Failed to create project: ' + err.message });
  } finally {
    client.release();
  }
});

// POST /api/companies/credits - Issue credits (seller, admin-approved project)
router.post('/credits', authMiddleware, async (req, res) => {
  const { project_id, serial_number, unit, co2_methodology, additional_benefits } = req.body;
  const vintage_year = Number(req.body.vintage_year);
  const quantity = Number(req.body.quantity);
  const price_per_unit = Number(req.body.price_per_unit);
  if (!project_id || !serial_number || !req.body.vintage_year || !req.body.quantity || !req.body.price_per_unit) {
    return res.status(400).json({ error: 'project_id, serial_number, vintage_year, quantity, price_per_unit are required.' });
  }
  if (!(quantity > 0) || !(price_per_unit > 0)) {
    return res.status(400).json({ error: 'Quantity and price must be positive numbers.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const fail = async (status, error) => { await client.query('ROLLBACK'); return res.status(status).json({ error }); };

    const companyResult = await client.query('SELECT id FROM registry.companies WHERE user_id = $1', [req.user.id]);
    if (companyResult.rows.length === 0) return fail(404, 'Company not found.');

    // Lock the project so two concurrent issuances cannot exceed its cap
    const projectResult = await client.query(`
      SELECT id, status, company_id, verification_standard, total_credits_cap,
             EXTRACT(YEAR FROM start_date)::INT AS start_year, EXTRACT(YEAR FROM end_date)::INT AS end_year
      FROM registry.carbon_projects WHERE id = $1 AND company_id = $2 FOR UPDATE
    `, [project_id, companyResult.rows[0].id]);
    if (projectResult.rows.length === 0) return fail(404, 'Project not found.');
    const project = projectResult.rows[0];
    if (project.status !== 'active') return fail(403, 'Project must be active to issue credits.');

    // Registry consistency checks
    const serialError = checkSerial(serial_number, project.verification_standard, vintage_year);
    if (serialError) return fail(400, serialError);
    const vintageError = checkVintage(vintage_year, project.start_year, project.end_year);
    if (vintageError) return fail(400, vintageError);
    const issued = await client.query(
      'SELECT COALESCE(SUM(quantity), 0) AS issued FROM registry.carbon_credits WHERE project_id = $1', [project_id]
    );
    const headroom = Number(project.total_credits_cap) - Number(issued.rows[0].issued);
    if (quantity > headroom) return fail(400, `This would exceed the project's credit cap. Remaining: ${headroom}.`);

    const result = await client.query(`
      INSERT INTO registry.carbon_credits
        (project_id, serial_number, vintage_year, quantity, price_per_unit, unit, co2_methodology, additional_benefits)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      RETURNING id, serial_number, quantity, price_per_unit, status
    `, [project_id, serial_number, vintage_year, quantity, price_per_unit,
        unit || 'tCO2e', co2_methodology || null,
        additional_benefits ? `{${additional_benefits.join(',')}}` : null]);

    // Add initial market price
    await client.query(`
      INSERT INTO trading.market_prices (credit_id, price, volume_24h, high_24h, low_24h, open_price)
      VALUES ($1, $2, 0, $2, $2, $2)
    `, [result.rows[0].id, price_per_unit]);
    await client.query('COMMIT');

    await audit(client, req.user.id, 'INSERT', 'registry', 'carbon_credits', result.rows[0].id);
    res.status(201).json({ message: 'Credits issued successfully.', credit: result.rows[0] });
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505') return res.status(409).json({ error: 'A credit with this serial number already exists.' });
    console.error('Issue credit error:', err.message);
    res.status(500).json({ error: 'Failed to issue credit.' });
  } finally {
    client.release();
  }
});

// ── KYC DOCUMENTS ─────────────────────────────────────────────────────────────

// POST /api/companies/documents - Upload a KYC document (JSON body with base64 data)
router.post('/documents', authMiddleware, async (req, res) => {
  const { doc_type, file_name, mime_type, data_base64 } = req.body;
  if (!DOC_TYPES.includes(doc_type)) return res.status(400).json({ error: 'Choose a valid document type.' });
  if (!file_name || !data_base64) return res.status(400).json({ error: 'A file is required.' });
  const sig = MIME_SIGNATURES[mime_type];
  if (!sig) return res.status(400).json({ error: 'Only PDF, PNG or JPEG files are accepted.' });

  const data = Buffer.from(String(data_base64), 'base64');
  if (data.length === 0) return res.status(400).json({ error: 'The file is empty.' });
  if (data.length > MAX_DOC_BYTES) return res.status(400).json({ error: 'Files must be 5 MB or smaller.' });
  if (!data.subarray(0, sig.magic.length).equals(sig.magic)) {
    return res.status(400).json({ error: 'The file content does not match its type.' });
  }

  try {
    const company = await pool.query('SELECT id, legal_name FROM registry.companies WHERE user_id = $1', [req.user.id]);
    if (company.rows.length === 0) return res.status(404).json({ error: 'Register your company first.' });

    const id = crypto.randomUUID();
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    const storedName = id + sig.ext; // never use the uploaded name on disk
    fs.writeFileSync(path.join(UPLOAD_DIR, storedName), data);

    const safeName = path.basename(String(file_name)).slice(0, 255);
    const result = await pool.query(`
      INSERT INTO registry.kyc_documents (id, company_id, doc_type, original_name, mime_type, size_bytes, sha256, storage_path, uploaded_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING id, doc_type, original_name, mime_type, size_bytes, sha256, uploaded_at
    `, [id, company.rows[0].id, doc_type, safeName, mime_type, data.length,
        crypto.createHash('sha256').update(data).digest('hex'), storedName, req.user.id]);

    await audit(pool, req.user.id, 'INSERT', 'registry', 'kyc_documents', id);
    await notifyAdmins(pool, 'kyc', `KYC document uploaded by ${company.rows[0].legal_name}`, safeName);
    res.status(201).json({ message: 'Document uploaded.', document: result.rows[0] });
  } catch (err) {
    console.error('Upload error:', err.message);
    res.status(500).json({ error: 'Upload failed.' });
  }
});

// GET /api/companies/documents - My company's KYC documents
router.get('/documents', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT d.id, d.doc_type, d.original_name, d.mime_type, d.size_bytes, d.sha256, d.uploaded_at
      FROM registry.kyc_documents d JOIN registry.companies c ON c.id = d.company_id
      WHERE c.user_id = $1 ORDER BY d.uploaded_at DESC
    `, [req.user.id]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch documents.' });
  }
});

// GET /api/companies/documents/:id/download - Owner or admin only
router.get('/documents/:id/download', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT d.*, c.user_id AS owner_id FROM registry.kyc_documents d
      JOIN registry.companies c ON c.id = d.company_id WHERE d.id = $1
    `, [req.params.id]);
    const doc = result.rows[0];
    if (!doc || (req.user.role !== 'admin' && doc.owner_id !== req.user.id)) {
      return res.status(404).json({ error: 'Document not found.' });
    }
    const filePath = path.join(UPLOAD_DIR, path.basename(doc.storage_path));
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File is missing on the server.' });
    res.setHeader('Content-Type', doc.mime_type);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', `attachment; filename="${doc.original_name.replace(/[^\w.\- ]/g, '_')}"`);
    fs.createReadStream(filePath).pipe(res);
  } catch (err) {
    res.status(404).json({ error: 'Document not found.' });
  }
});

// ── ADMIN ROUTES ──────────────────────────────────────────────────────────────

// GET /api/companies/admin/all
router.get('/admin/all', authMiddleware, adminOnly, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM registry.v_admin_company_overview ORDER BY created_at DESC');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch companies.' });
  }
});

// GET /api/companies/admin/:id/documents - KYC documents of one company
router.get('/admin/:id/documents', authMiddleware, adminOnly, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, doc_type, original_name, mime_type, size_bytes, sha256, uploaded_at
      FROM registry.kyc_documents WHERE company_id = $1 ORDER BY uploaded_at DESC
    `, [req.params.id]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch documents.' });
  }
});

// PUT /api/companies/admin/:id/kyc
router.put('/admin/:id/kyc', authMiddleware, adminOnly, async (req, res) => {
  const { kyc_status, kyc_rejection_reason } = req.body;
  if (!['approved', 'rejected', 'under_review', 'suspended'].includes(kyc_status)) {
    return res.status(400).json({ error: 'Invalid KYC status.' });
  }
  const client = await pool.connect();
  try {
    if (kyc_status === 'approved') {
      const docs = await client.query('SELECT COUNT(*)::INT AS n FROM registry.kyc_documents WHERE company_id = $1', [req.params.id]);
      if (docs.rows[0].n === 0) {
        return res.status(400).json({ error: 'This company has not uploaded any KYC documents yet.' });
      }
    }
    if (kyc_status === 'rejected' && !kyc_rejection_reason) {
      return res.status(400).json({ error: 'Please give a reason for rejecting.' });
    }
    const result = await client.query(`
      UPDATE registry.companies
      SET kyc_status = $1,
          kyc_reviewed_by = $2,
          kyc_reviewed_at = NOW(),
          kyc_rejection_reason = $3
      WHERE id = $4
      RETURNING id, legal_name, kyc_status
    `, [kyc_status, req.user.id, kyc_rejection_reason || null, req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Company not found.' });
    await audit(client, req.user.id, 'UPDATE', 'registry', 'companies', result.rows[0].id);
    await notifyCompany(client, result.rows[0].id, 'kyc', `KYC status: ${kyc_status.replace('_', ' ')}`,
      kyc_status === 'rejected' ? `Reason: ${kyc_rejection_reason}` : null, 'company');
    res.json({ message: 'KYC status updated.', company: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update KYC: ' + err.message });
  } finally {
    client.release();
  }
});

// PUT /api/companies/admin/projects/:id/approve
router.put('/admin/projects/:id/approve', authMiddleware, adminOnly, async (req, res) => {
  const { status, admin_notes } = req.body;
  if (!['active', 'rejected', 'suspended'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status.' });
  }
  const client = await pool.connect();
  try {
    const result = await client.query(`
      UPDATE registry.carbon_projects
      SET status = $1, approved_by = $2, approved_at = NOW(), admin_notes = $3
      WHERE id = $4
      RETURNING id, name, status, company_id
    `, [status, req.user.id, admin_notes || null, req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Project not found.' });
    await audit(client, req.user.id, 'UPDATE', 'registry', 'carbon_projects', result.rows[0].id);
    await notifyCompany(client, result.rows[0].company_id, 'project', `Project "${result.rows[0].name}" is now ${status}`,
      admin_notes ? `Note from the administrator: ${admin_notes}` : null, 'projects');
    res.json({ message: 'Project status updated.', project: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update project: ' + err.message });
  } finally {
    client.release();
  }
});

// GET /api/companies/admin/projects - All projects
router.get('/admin/projects', authMiddleware, adminOnly, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT cp.*, comp.legal_name AS company_name, comp.country AS company_country
      FROM registry.carbon_projects cp
      JOIN registry.companies comp ON cp.company_id = comp.id
      ORDER BY cp.created_at DESC
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch projects.' });
  }
});

// GET /api/companies/admin/trades - All trades
router.get('/admin/trades', authMiddleware, adminOnly, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM trading.v_transaction_history LIMIT 200');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch trades.' });
  }
});

// GET /api/companies/admin/users - All users
router.get('/admin/users', authMiddleware, adminOnly, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, email, role, full_name, is_verified, is_active, mfa_enabled, created_at, last_login_at
      FROM auth.users ORDER BY created_at DESC
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch users.' });
  }
});

// PUT /api/companies/admin/users/:id/toggle
router.put('/admin/users/:id/toggle', authMiddleware, adminOnly, async (req, res) => {
  const client = await pool.connect();
  try {
    const result = await client.query(`
      UPDATE auth.users SET is_active = NOT is_active WHERE id = $1 AND id <> $2 RETURNING id, email, is_active
    `, [req.params.id, req.user.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'User not found (you cannot disable yourself).' });
    await audit(client, req.user.id, 'UPDATE', 'auth', 'users', result.rows[0].id);
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to toggle user.' });
  } finally {
    client.release();
  }
});

// GET /api/companies/admin/audit - Audit log
router.get('/admin/audit', authMiddleware, adminOnly, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT al.*, u.email AS user_email
      FROM auth.audit_log al
      LEFT JOIN auth.users u ON al.user_id = u.id
      ORDER BY al.logged_at DESC LIMIT 100
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch audit log.' });
  }
});

module.exports = router;
