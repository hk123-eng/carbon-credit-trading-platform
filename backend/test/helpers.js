// Shared test setup: each test file gets its own freshly created database
// (built from database/schema.sql) and its own server on a random port.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Client } = require('pg');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

// Safety: point every connection at a test database from the moment the tests
// load, so code that touches the database too early can never reach real data.
process.env.DB_NAME = 'carbon_test_not_ready';
const DB_MODULE = require.resolve('../db');

const SCHEMA = path.join(__dirname, '..', '..', 'database', 'schema.sql');

const SEED = {
  admin: { email: 'admin@carbonplatform.io', password: 'Admin@1234' },
  steel: { email: 'cfo@steelcorp.com', password: 'Buyer@1234', company: 'c0000000-0000-0000-0000-000000000001' },
  green: { email: 'ops@greenterra.io', password: 'Seller@1234', company: 'c0000000-0000-0000-0000-000000000002' },
  air: { email: 'sustainability@airlogix.com', password: 'Buyer@1234', company: 'c0000000-0000-0000-0000-000000000003' },
  solar: { email: 'projects@solarverde.org', password: 'Seller@1234', company: 'c0000000-0000-0000-0000-000000000004' },
  credits: {
    vcs2022: 'd0000000-0000-0000-0000-000000000001',
    vcs2023: 'd0000000-0000-0000-0000-000000000002',
    gs2023: 'd0000000-0000-0000-0000-000000000003',
    gs2024: 'd0000000-0000-0000-0000-000000000004',
  },
  projects: { amazon: 'b0000000-0000-0000-0000-000000000001', solar: 'b0000000-0000-0000-0000-000000000003' },
};

// A tiny but valid-looking PDF for KYC upload tests
const PDF_BASE64 = Buffer.from('%PDF-1.4\n% test document\n%%EOF\n').toString('base64');

function dbConfig(database) {
  return {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT) || 5432,
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD,
    database,
  };
}

async function setup(name) {
  if (require.cache[DB_MODULE]) {
    throw new Error('The database module was loaded before setup(); require app modules inside tests, not at the top of the file.');
  }
  const database = `carbon_test_${name}`;
  process.env.NODE_ENV = 'test';
  process.env.DB_NAME = database;
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-only';
  process.env.MAIL_LOG = 'off';
  process.env.RATE_LIMIT_MAX = '1000000';
  process.env.AUTH_RATE_LIMIT_MAX = '1000000';
  process.env.UPLOAD_DIR = path.join(os.tmpdir(), `carbon-test-uploads-${name}`);

  const admin = new Client(dbConfig('postgres'));
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${database}`);
  await admin.end();

  const db = new Client(dbConfig(database));
  await db.connect();
  await db.query(fs.readFileSync(SCHEMA, 'utf8'));

  const app = require('../server');
  const { pool } = require('../db');
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;

  async function api(method, url, token, body) {
    const res = await fetch(base + url, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let data = null;
    try { data = JSON.parse(text); } catch { data = text; }
    return { status: res.status, body: data, headers: res.headers };
  }

  async function login(who, extra = {}) {
    const r = await api('POST', '/api/auth/login', null, { ...who, ...extra });
    if (r.status !== 200) throw new Error(`login failed for ${who.email}: ${r.status} ${JSON.stringify(r.body)}`);
    return r.body.token;
  }

  // Registers a new user, verifies the e-mail, registers a company, uploads a
  // KYC document and has the administrator approve it. Returns tokens and ids.
  let counter = 0;
  async function newApprovedCompany(companyType = 'both', opts = {}) {
    counter += 1;
    const email = `user${counter}-${Date.now()}@${name}.test`;
    const password = 'Test@12345';
    const reg = await api('POST', '/api/auth/register', null, { email, password, full_name: `Test User ${counter}`, role: companyType === 'buyer' ? 'buyer' : 'seller' });
    if (reg.status !== 201) throw new Error('register failed ' + JSON.stringify(reg.body));
    const token = new URL(reg.body.dev_verification_url).searchParams.get('token');
    await api('GET', `/api/auth/verify-email?token=${token}`);
    const userToken = await login({ email, password });
    const comp = await api('POST', '/api/companies', userToken, {
      legal_name: `Test Co ${counter} ${name}`, company_type: companyType, registration_number: `T-${name}-${counter}-${Date.now()}`,
      country: 'IN', industry_sector: 'manufacturing', annual_emissions_baseline: opts.baseline,
    });
    if (comp.status !== 201) throw new Error('company failed ' + JSON.stringify(comp.body));
    await api('POST', '/api/companies/documents', userToken, { doc_type: 'certificate_of_incorporation', file_name: 'coi.pdf', mime_type: 'application/pdf', data_base64: PDF_BASE64 });
    const adminToken = await login(SEED.admin);
    const kyc = await api('PUT', `/api/companies/admin/${comp.body.company.id}/kyc`, adminToken, { kyc_status: 'approved' });
    if (kyc.status !== 200) throw new Error('kyc failed ' + JSON.stringify(kyc.body));
    if (opts.deposit) await api('POST', '/api/wallet/deposit', userToken, { amount: opts.deposit });
    return { email, password, token: userToken, companyId: comp.body.company.id };
  }

  async function close() {
    await new Promise((r) => server.close(r));
    await pool.end();
    await db.end();
  }

  return { api, login, db, base, close, newApprovedCompany };
}

module.exports = { setup, SEED, PDF_BASE64 };
