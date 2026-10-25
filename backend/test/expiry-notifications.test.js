const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup, SEED } = require('./helpers');

let t, co, admin;
before(async () => {
  t = await setup('expiry');
  co = await t.newApprovedCompany('buyer', { deposit: 5000 });
  admin = await t.login(SEED.admin);
});
after(async () => { await t.close(); });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('an expired buy order is closed by the job and its escrow returned', async () => {
  const expiry = new Date(Date.now() + 1500).toISOString();
  const r = await t.api('POST', '/api/trading/orders', co.token, { credit_id: SEED.credits.gs2024, order_type: 'buy', quantity: 100, price_per_unit: 10, order_expiry: expiry });
  assert.equal(r.status, 201);
  assert.equal(r.body.order.status, 'open');
  let w = (await t.api('GET', '/api/wallet', co.token)).body;
  assert.equal(Number(w.reserved), 1000);

  const { expireOrders } = require('../jobs/order-expiry');
  assert.equal(await expireOrders(require('../db').pool), 0); // not yet due
  await sleep(1800);
  const run = await t.api('POST', '/api/admin/jobs/expire-orders', admin);
  assert.equal(run.status, 200);
  assert.equal(run.body.expired, 1);

  const o = (await t.api('GET', '/api/trading/orders', co.token)).body.find((x) => x.id === r.body.order.id);
  assert.equal(o.status, 'expired');
  assert.equal(Number(o.reserved_amount), 0);
  w = (await t.api('GET', '/api/wallet', co.token)).body;
  assert.equal(Number(w.reserved), 0);
  assert.equal(Number(w.available), 5000);
  assert.equal(w.ledger[0].entry_type, 'release');
});

test('expired orders are skipped by matching even before the job runs', async () => {
  const sell = await t.api('POST', '/api/trading/orders', co.token, { credit_id: SEED.credits.gs2024, order_type: 'buy', quantity: 10, price_per_unit: 1, order_expiry: new Date(Date.now() + 800).toISOString() });
  assert.equal(sell.status, 201);
  await sleep(1000);
  // SolarVerde sells at $1: the expired $1 bid must not be filled
  const solar = await t.login(SEED.solar);
  const ask = await t.api('POST', '/api/trading/orders', solar, { credit_id: SEED.credits.gs2024, order_type: 'sell', quantity: 10, price_per_unit: 1 });
  assert.equal(ask.body.trades.length, 0);
});

test('the owner is notified when an order expires', async () => {
  const n = (await t.api('GET', '/api/notifications', co.token)).body;
  assert.ok(n.notifications.some((x) => x.kind === 'order_expired'));
});

test('notifications: unread count, mark one read, mark all read, privacy', async () => {
  let n = (await t.api('GET', '/api/notifications', co.token)).body;
  assert.ok(n.unread >= 2);
  const first = n.notifications.find((x) => !x.is_read);
  assert.equal((await t.api('POST', `/api/notifications/${first.id}/read`, co.token)).status, 200);
  assert.equal((await t.api('POST', `/api/notifications/${first.id}/read`, admin)).status, 404); // not admin's notification
  assert.equal((await t.api('POST', '/api/notifications/abc/read', co.token)).status, 404);
  const before = (await t.api('GET', '/api/notifications', co.token)).body.unread;
  assert.equal(before, n.unread - 1);
  await t.api('POST', '/api/notifications/read-all', co.token);
  n = (await t.api('GET', '/api/notifications', co.token)).body;
  assert.equal(n.unread, 0);
});

test('admin statistics summarise the platform', async () => {
  const s = (await t.api('GET', '/api/admin/stats', admin)).body;
  assert.ok(Number(s.companies) >= 5);
  assert.ok(Number(s.trades) >= 1);
  assert.ok(Number(s.wallet_funds) > 0);
  assert.equal(Number(s.retired_tonnes), 400); // the seeded retirement
});

test('the audit trail records logins, orders, expiry and wallet changes', async () => {
  const log = (await t.api('GET', '/api/companies/admin/audit', admin)).body;
  const tables = new Set(log.map((l) => l.table_name));
  for (const name of ['users', 'orders', 'wallets', 'companies', 'kyc_documents']) assert.ok(tables.has(name), name);
});
