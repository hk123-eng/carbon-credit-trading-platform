const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup, SEED } = require('./helpers');

let t, co, steel;
const year = new Date().getFullYear() - 1;

before(async () => {
  t = await setup('retire');
  co = await t.newApprovedCompany('buyer', { deposit: 50000, baseline: 10000 });
  // buy 300 t of VCS-2022 from GreenTerra's resting sell order at $18.50
  const r = await t.api('POST', '/api/trading/orders', co.token, { credit_id: SEED.credits.vcs2022, order_type: 'buy', quantity: 300, price_per_unit: 18.5 });
  assert.equal(r.body.trades.length, 1);
  steel = await t.login(SEED.steel);
});
after(async () => { await t.close(); });

const retire = (token, body) => t.api('POST', '/api/trading/retire', token, { credit_id: SEED.credits.vcs2022, beneficiary: 'Test Co', report_year: year, ...body });

test('retirement is validated: quantity, beneficiary, year and holdings', async () => {
  assert.equal((await retire(co.token, { quantity: 0 })).status, 400);
  assert.equal((await retire(co.token, { quantity: 10, beneficiary: '   ' })).status, 400);
  assert.equal((await retire(co.token, { quantity: 10, report_year: year + 5 })).status, 400);
  assert.equal((await retire(co.token, { quantity: 301 })).status, 400); // holds only 300
});

let certId, certNumber;
test('retiring credits issues a numbered certificate and reduces holdings', async () => {
  const r = await retire(co.token, { quantity: 120, reason: 'Offset of Scope 1 emissions' });
  assert.equal(r.status, 201);
  assert.match(r.body.retirement.certificate_number, new RegExp(`^RET-${year}-\\d{6}$`));
  certId = r.body.retirement.id;
  certNumber = r.body.retirement.certificate_number;
  const p = (await t.api('GET', '/api/trading/portfolio', co.token)).body;
  const h = p.find((x) => x.credit_id === SEED.credits.vcs2022);
  assert.equal(Number(h.quantity_held), 180);
  assert.equal(Number(h.quantity_retired), 120);
});

test('retired credits can no longer be sold or retired again', async () => {
  const sell = await t.api('POST', '/api/trading/orders', co.token, { credit_id: SEED.credits.vcs2022, order_type: 'sell', quantity: 181, price_per_unit: 30 });
  assert.equal(sell.status, 400);
  assert.equal((await retire(co.token, { quantity: 181 })).status, 400);
  // listing 100 for sale leaves only 80 available to retire
  assert.equal((await t.api('POST', '/api/trading/orders', co.token, { credit_id: SEED.credits.vcs2022, order_type: 'sell', quantity: 100, price_per_unit: 30 })).status, 201);
  assert.equal((await retire(co.token, { quantity: 81 })).status, 400);
});

test('certificates are visible to the owner and admins only, but publicly verifiable by number', async () => {
  assert.equal((await t.api('GET', `/api/trading/retirements/${certId}`, co.token)).status, 200);
  assert.equal((await t.api('GET', `/api/trading/retirements/${certId}`, steel)).status, 404);
  assert.equal((await t.api('GET', `/api/trading/retirements/${certId}`, await t.login(SEED.admin))).status, 200);
  const pub = await t.api('GET', `/api/market/certificates/${certNumber}`);
  assert.equal(pub.status, 200);
  assert.equal(pub.body.valid, true);
  assert.equal(Number(pub.body.quantity), 120);
  assert.equal((await t.api('GET', '/api/market/certificates/RET-1999-000999')).status, 404);
  assert.equal((await t.api('GET', '/api/market/certificates/not-a-number')).status, 404);
});

test('a retirement notification is created', async () => {
  const n = (await t.api('GET', '/api/notifications', co.token)).body;
  assert.ok(n.notifications.some((x) => x.kind === 'retirement' && x.title.includes(certNumber)));
});

test('emission reports take retired credits from verified retirements, not from user input', async () => {
  const r = await t.api('POST', '/api/compliance/reports', co.token, { report_year: year, scope1_tonnes: 6000, scope2_tonnes: 2000, scope3_tonnes: 1000, credits_retired: 999999 });
  assert.equal(r.status, 201);
  assert.equal(Number(r.body.report.credits_retired), 120);
  assert.equal((await t.api('POST', '/api/compliance/reports', co.token, { report_year: year, scope1_tonnes: 1, scope2_tonnes: 1, scope3_tonnes: 1 })).status, 409);
  assert.equal((await t.api('POST', '/api/compliance/reports', co.token, { report_year: year + 3, scope1_tonnes: 1, scope2_tonnes: 1, scope3_tonnes: 1 })).status, 400);
  assert.equal((await t.api('POST', '/api/compliance/reports', co.token, { report_year: year - 1, scope1_tonnes: -1, scope2_tonnes: 1, scope3_tonnes: 1 })).status, 400);
});

test('compliance status follows the straight-line path to the target', async () => {
  // baseline 10,000 t; target: −50% by year+5 from baseline year−5 → allowed(year) = 10,000 × (1 − 0.5 × 5/10) = 7,500
  assert.equal((await t.api('POST', '/api/compliance/targets', co.token, { baseline_year: year - 5, target_year: year + 5, reduction_pct: 50, target_type: 'absolute' })).status, 201);
  let rep = (await t.api('GET', '/api/compliance/reports', co.token)).body.find((x) => x.report_year === year);
  assert.equal(Number(rep.allowed_emissions), 7500);
  assert.equal(Number(rep.net_emissions), 9000 - 120);
  assert.equal(rep.compliance_status, 'off_track');
  // retiring 80 more credits is not enough; reporting a lower year is checked against a looser path
  await t.api('POST', '/api/compliance/reports', co.token, { report_year: year - 4, scope1_tonnes: 5000, scope2_tonnes: 2000, scope3_tonnes: 1000 });
  rep = (await t.api('GET', '/api/compliance/reports', co.token)).body.find((x) => x.report_year === year - 4);
  assert.equal(Number(rep.allowed_emissions), 9500); // 10,000 × (1 − 0.5 × 1/10)
  assert.equal(rep.compliance_status, 'on_track');
});

test('report reviews notify the company', async () => {
  const admin = await t.login(SEED.admin);
  const rep = (await t.api('GET', '/api/compliance/reports', co.token)).body.find((x) => x.report_year === year);
  assert.equal((await t.api('PUT', `/api/compliance/admin/reports/${rep.id}/review`, admin, { status: 'approved' })).status, 200);
  const n = (await t.api('GET', '/api/notifications', co.token)).body;
  assert.ok(n.notifications.some((x) => x.kind === 'report'));
});
