const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup, SEED, PDF_BASE64 } = require('./helpers');

let t, owner, ownerCompanyId, adminToken, docId;
before(async () => {
  t = await setup('kyc');
  adminToken = await t.login(SEED.admin);
  // a verified user with a company but no documents yet
  const email = `kyc.owner.${Date.now()}@example.com`;
  const reg = await t.api('POST', '/api/auth/register', null, { email, password: 'Test@12345', full_name: 'KYC Owner', role: 'seller' });
  await t.api('GET', `/api/auth/verify-email?token=${new URL(reg.body.dev_verification_url).searchParams.get('token')}`);
  owner = await t.login({ email, password: 'Test@12345' });
  const c = await t.api('POST', '/api/companies', owner, { legal_name: 'KYC Test Ltd', company_type: 'both', registration_number: `KYC-${Date.now()}`, country: 'in', industry_sector: 'energy' });
  ownerCompanyId = c.body.company.id;
});
after(async () => { await t.close(); });

test('a new company starts pending and cannot trade', async () => {
  const r = await t.api('POST', '/api/trading/orders', owner, { credit_id: SEED.credits.vcs2022, order_type: 'buy', quantity: 1, price_per_unit: 1 });
  assert.equal(r.status, 403);
});

test('admin cannot approve KYC before any document is uploaded', async () => {
  const r = await t.api('PUT', `/api/companies/admin/${ownerCompanyId}/kyc`, adminToken, { kyc_status: 'approved' });
  assert.equal(r.status, 400);
});

test('upload rejects unsupported types, spoofed content and oversized files', async () => {
  const exe = Buffer.from('MZ fake program').toString('base64');
  assert.equal((await t.api('POST', '/api/companies/documents', owner, { doc_type: 'other', file_name: 'a.exe', mime_type: 'application/x-msdownload', data_base64: exe })).status, 400);
  assert.equal((await t.api('POST', '/api/companies/documents', owner, { doc_type: 'other', file_name: 'a.pdf', mime_type: 'application/pdf', data_base64: exe })).status, 400);
  const big = Buffer.concat([Buffer.from('%PDF'), Buffer.alloc(5 * 1024 * 1024)]).toString('base64');
  assert.equal((await t.api('POST', '/api/companies/documents', owner, { doc_type: 'other', file_name: 'big.pdf', mime_type: 'application/pdf', data_base64: big })).status, 400);
  assert.equal((await t.api('POST', '/api/companies/documents', owner, { doc_type: 'bogus', file_name: 'a.pdf', mime_type: 'application/pdf', data_base64: PDF_BASE64 })).status, 400);
});

test('a valid PDF uploads with its SHA-256 recorded and admins are notified', async () => {
  const r = await t.api('POST', '/api/companies/documents', owner, { doc_type: 'certificate_of_incorporation', file_name: '../../etc/passwd.pdf', mime_type: 'application/pdf', data_base64: PDF_BASE64 });
  assert.equal(r.status, 201);
  assert.equal(r.body.document.original_name, 'passwd.pdf'); // path parts stripped
  assert.match(r.body.document.sha256, /^[0-9a-f]{64}$/);
  docId = r.body.document.id;
  const n = await t.api('GET', '/api/notifications', adminToken);
  assert.ok(n.body.notifications.some((x) => x.kind === 'kyc'));
});

test('documents can be downloaded by the owner and an admin, but not by others', async () => {
  const own = await fetch(`${t.base}/api/companies/documents/${docId}/download`, { headers: { Authorization: `Bearer ${owner}` } });
  assert.equal(own.status, 200);
  assert.equal(Buffer.from(await own.arrayBuffer()).toString('base64'), PDF_BASE64);
  const adm = await fetch(`${t.base}/api/companies/documents/${docId}/download`, { headers: { Authorization: `Bearer ${adminToken}` } });
  assert.equal(adm.status, 200);
  const other = await t.api('GET', `/api/companies/documents/${docId}/download`, await t.login(SEED.steel));
  assert.equal(other.status, 404);
});

test('rejecting needs a reason; approval works once documents exist and notifies the company', async () => {
  assert.equal((await t.api('PUT', `/api/companies/admin/${ownerCompanyId}/kyc`, adminToken, { kyc_status: 'rejected' })).status, 400);
  assert.equal((await t.api('PUT', `/api/companies/admin/${ownerCompanyId}/kyc`, adminToken, { kyc_status: 'approved' })).status, 200);
  const n = await t.api('GET', '/api/notifications', owner);
  assert.ok(n.body.notifications.some((x) => x.title.includes('approved')));
});

let projectId;
test('credits cannot be issued on a project that is not approved', async () => {
  const p = await t.api('POST', '/api/companies/projects', owner, {
    name: 'Rajasthan Solar Park', description: 'Utility solar plant for registry tests.', project_type: 'solar',
    verification_standard: 'Gold Standard', verification_body: 'TUV', country: 'IN', total_credits_cap: 1000,
    start_date: '2020-01-01', end_date: '2035-12-31',
  });
  assert.equal(p.status, 201);
  projectId = p.body.project.id;
  const r = await t.api('POST', '/api/companies/credits', owner, { project_id: projectId, serial_number: 'GS-2023-000001', vintage_year: 2023, quantity: 10, price_per_unit: 10 });
  assert.equal(r.status, 403);
  assert.equal((await t.api('PUT', `/api/companies/admin/projects/${projectId}/approve`, adminToken, { status: 'active' })).status, 200);
});

test('registry rules: serial prefix, year match, crediting period, future vintage, cap, duplicates', async () => {
  const issue = (body) => t.api('POST', '/api/companies/credits', owner, { project_id: projectId, price_per_unit: 10, quantity: 100, ...body });
  assert.equal((await issue({ serial_number: 'VCS-2023-000001', vintage_year: 2023 })).status, 400); // wrong prefix for Gold Standard
  assert.equal((await issue({ serial_number: 'GS-2022-000001', vintage_year: 2023 })).status, 400); // year mismatch
  assert.equal((await issue({ serial_number: 'GS-2019-000001', vintage_year: 2019 })).status, 400); // before project start
  const next = new Date().getFullYear() + 1;
  assert.equal((await issue({ serial_number: `GS-${next}-000001`, vintage_year: next })).status, 400); // future vintage
  assert.equal((await issue({ serial_number: 'GS-2023-000001', vintage_year: 2023, quantity: 5000 })).status, 400); // over cap
  assert.equal((await issue({ serial_number: 'GS-2023-000001', vintage_year: 2023, quantity: -5 })).status, 400);
  assert.equal((await issue({ serial_number: 'GS-2023-000001', vintage_year: 2023 })).status, 201);
  assert.equal((await issue({ serial_number: 'GS-2023-000001', vintage_year: 2023 })).status, 409); // duplicate serial
  const rest = await issue({ serial_number: 'GS-2024-000002', vintage_year: 2024, quantity: 901 });
  assert.equal(rest.status, 400); // 900 left under the 1,000 cap
  assert.equal((await issue({ serial_number: 'GS-2024-000002', vintage_year: 2024, quantity: 900 })).status, 201);
});
