const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup, SEED } = require('./helpers');

let t, buyer, seller;
const wallet = async (token) => (await t.api('GET', '/api/wallet', token)).body;
const order = (token, body) => t.api('POST', '/api/trading/orders', token, body);

before(async () => {
  t = await setup('trading');
  buyer = await t.newApprovedCompany('buyer', { deposit: 10000 });
  seller = await t.newApprovedCompany('both');
  // give the seller credits by letting it buy 500 of GS-2023 from GreenTerra's resting sell order at $14.75
  await t.api('POST', '/api/wallet/deposit', seller.token, { amount: 10000 });
  const r = await order(seller.token, { credit_id: SEED.credits.gs2023, order_type: 'buy', quantity: 500, price_per_unit: 14.75 });
  assert.equal(r.body.trades.length, 1);
});
after(async () => { await t.close(); });

test('wallet deposits are validated', async () => {
  for (const amount of [0, -5, 'abc', 10.123, 2000000]) {
    assert.equal((await t.api('POST', '/api/wallet/deposit', buyer.token, { amount })).status, 400, `amount ${amount}`);
  }
  const w = await wallet(buyer.token);
  assert.equal(Number(w.balance), 10000);
  assert.equal(w.ledger[0].entry_type, 'deposit');
});

test('a buy order without enough funds is rejected and nothing is held', async () => {
  const r = await order(buyer.token, { credit_id: SEED.credits.vcs2023, order_type: 'buy', quantity: 1000, price_per_unit: 20 });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /Insufficient funds/);
  const w = await wallet(buyer.token);
  assert.equal(Number(w.reserved), 0);
});

test('a resting buy order holds quantity × limit price in escrow', async () => {
  const r = await order(buyer.token, { credit_id: SEED.credits.vcs2023, order_type: 'buy', quantity: 100, price_per_unit: 15 });
  assert.equal(r.status, 201);
  assert.equal(r.body.order.status, 'open');
  assert.equal(Number(r.body.order.reserved_amount), 1500);
  const w = await wallet(buyer.token);
  assert.equal(Number(w.reserved), 1500);
  assert.equal(Number(w.available), 8500);
});

test('withdrawals cannot touch escrowed funds', async () => {
  assert.equal((await t.api('POST', '/api/wallet/withdraw', buyer.token, { amount: 9000 })).status, 400);
  assert.equal((await t.api('POST', '/api/wallet/withdraw', buyer.token, { amount: 500 })).status, 201);
  const w = await wallet(buyer.token);
  assert.equal(Number(w.balance), 9500);
  assert.equal(Number(w.available), 8000);
});

test('a crossing sell order trades at the resting buy price and settles both wallets', async () => {
  const sellerBefore = await wallet(seller.token);
  const r = await order(seller.token, { credit_id: SEED.credits.vcs2023, order_type: 'sell', quantity: 40, price_per_unit: 9 });
  // the seller holds no VCS-2023 credits yet
  assert.equal(r.status, 400);
  const gs = await order(seller.token, { credit_id: SEED.credits.gs2023, order_type: 'sell', quantity: 40, price_per_unit: 12 });
  assert.equal(gs.status, 201);
  assert.equal(gs.body.trades.length, 0); // no buyer for GS-2023 at 12 or more
  const buy = await order(buyer.token, { credit_id: SEED.credits.gs2023, order_type: 'buy', quantity: 40, price_per_unit: 13 });
  assert.equal(buy.body.trades.length, 1);
  const trade = buy.body.trades[0];
  assert.equal(Number(trade.trade_price), 12); // resting price, not the buyer's limit
  assert.equal(Number(trade.total_value), 480);
  assert.equal(Number(trade.platform_fee), 2.4);
  assert.equal(buy.body.order.status, 'filled');
  assert.equal(Number(buy.body.order.reserved_amount), 0); // $40 price improvement returned

  const b = await wallet(buyer.token);
  assert.equal(Number(b.balance), 9500 - 480);
  assert.equal(Number(b.reserved), 1500); // only the VCS-2023 order is still held
  const s = await wallet(seller.token);
  assert.equal(Number(s.balance), Number(sellerBefore.balance) + 477.6);
  const purchase = b.ledger.find((l) => l.entry_type === 'purchase');
  assert.match(purchase.note, /\$40\.00 price improvement/);
  assert.equal(Number(purchase.amount), -480);
});

test('partial fills keep the remaining escrow; cancelling returns it', async () => {
  // buyer's VCS-2023 order: 100 @ 15 (1,500 held). GreenTerra's resting sell is 2,500 @ 21, so no cross.
  const sell = await order(seller.token, { credit_id: SEED.credits.gs2023, order_type: 'sell', quantity: 30, price_per_unit: 10 });
  assert.equal(sell.status, 201);
  const part = await order(buyer.token, { credit_id: SEED.credits.gs2023, order_type: 'buy', quantity: 50, price_per_unit: 10 });
  assert.equal(part.body.order.status, 'partially_filled');
  assert.equal(Number(part.body.order.filled_qty), 30);
  assert.equal(Number(part.body.order.reserved_amount), 200); // 20 left × $10

  const cancel = await t.api('DELETE', `/api/trading/orders/${part.body.order.id}`, buyer.token);
  assert.equal(cancel.status, 200);
  assert.equal(cancel.body.released, 200);
  const orders = (await t.api('GET', '/api/trading/orders', buyer.token)).body;
  assert.equal(orders.find((o) => o.id === part.body.order.id).status, 'cancelled');
});

test('self-trades never happen', async () => {
  const s = await order(seller.token, { credit_id: SEED.credits.gs2023, order_type: 'sell', quantity: 5, price_per_unit: 5 });
  assert.equal(s.status, 201);
  const b = await order(seller.token, { credit_id: SEED.credits.gs2023, order_type: 'buy', quantity: 5, price_per_unit: 50 });
  // the seller's own ask at $5 is skipped; it matches GreenTerra's ask at $14.75 instead
  assert.ok(b.body.trades.every((tr) => Number(tr.trade_price) !== 5));
});

test('orders are validated: quantity, price and expiry', async () => {
  assert.equal((await order(buyer.token, { credit_id: SEED.credits.gs2023, order_type: 'buy', quantity: -1, price_per_unit: 5 })).status, 400);
  assert.equal((await order(buyer.token, { credit_id: SEED.credits.gs2023, order_type: 'hold', quantity: 1, price_per_unit: 5 })).status, 400);
  assert.equal((await order(buyer.token, { credit_id: SEED.credits.gs2023, order_type: 'buy', quantity: 1, price_per_unit: 5, order_expiry: '2001-01-01T00:00:00Z' })).status, 400);
});

test('both sides of a trade are notified', async () => {
  const n = (await t.api('GET', '/api/notifications', buyer.token)).body;
  assert.ok(n.notifications.some((x) => x.kind === 'trade' && x.title === 'Credits bought'));
  const s = (await t.api('GET', '/api/notifications', seller.token)).body;
  assert.ok(s.notifications.some((x) => x.kind === 'trade' && x.title === 'Credits sold'));
});

test('admin manual matching validates prices and quantities', async () => {
  const admin = await t.login(SEED.admin);
  const ask = await order(seller.token, { credit_id: SEED.credits.gs2023, order_type: 'sell', quantity: 10, price_per_unit: 30 });
  const bid = await order(buyer.token, { credit_id: SEED.credits.gs2023, order_type: 'buy', quantity: 10, price_per_unit: 8 });
  assert.equal((await t.api('POST', '/api/trading/execute', admin, { buy_order_id: bid.body.order.id, sell_order_id: ask.body.order.id, quantity: 5, trade_price: 20 })).status, 400);
  assert.equal((await t.api('POST', '/api/trading/execute', admin, { buy_order_id: bid.body.order.id, sell_order_id: ask.body.order.id, quantity: 50, trade_price: 8 })).status, 400);
});

test('wallets reconcile: balances = deposits − withdrawals − fees', async () => {
  const r = await t.db.query(`
    SELECT (SELECT SUM(balance) FROM trading.wallets) AS balances,
           (SELECT SUM(amount) FROM trading.wallet_ledger WHERE entry_type = 'deposit') AS deposits,
           (SELECT COALESCE(SUM(-amount), 0) FROM trading.wallet_ledger WHERE entry_type = 'withdrawal') AS withdrawals,
           (SELECT SUM(platform_fee) FROM trading.trades) AS fees,
           (SELECT SUM(reserved) FROM trading.wallets) AS reserved,
           (SELECT COALESCE(SUM(reserved_amount), 0) FROM trading.orders WHERE status IN ('open','partially_filled')) AS escrow
  `);
  const x = r.rows[0];
  assert.equal(Number(x.balances).toFixed(2), (Number(x.deposits) - Number(x.withdrawals) - Number(x.fees)).toFixed(2));
  assert.equal(Number(x.reserved).toFixed(2), Number(x.escrow).toFixed(2));
});
