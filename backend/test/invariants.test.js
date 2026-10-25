// Randomised workload and concurrency test. After hundreds of random orders,
// cancellations and retirements, the database must satisfy every invariant
// below. Summary figures are printed with the prefix "RESULT" for reporting.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup, SEED } = require('./helpers');

let t, actors;
const credits = Object.values(SEED.credits);
const basePrice = { [SEED.credits.vcs2022]: 18.5, [SEED.credits.vcs2023]: 21, [SEED.credits.gs2023]: 14.75, [SEED.credits.gs2024]: 12.4 };

before(async () => {
  t = await setup('invariants');
  actors = [
    { token: await t.login(SEED.steel) }, { token: await t.login(SEED.air) },
    { token: await t.login(SEED.green) }, { token: await t.login(SEED.solar) },
  ];
  for (let i = 0; i < 4; i++) actors.push(await t.newApprovedCompany('both', { deposit: 100000 }));
});
after(async () => { await t.close(); });

let seed = 20261020;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];

test('randomised workload of 400 actions', async () => {
  const counts = { placed: 0, rejected_funds: 0, rejected_holdings: 0, cancelled: 0, retired: 0, trades: 0, other: 0 };
  const started = Date.now();
  for (let i = 0; i < 400; i++) {
    const a = pick(actors);
    const roll = rnd();
    if (roll < 0.05) {
      const open = (await t.api('GET', '/api/trading/orders', a.token)).body.filter((o) => ['open', 'partially_filled'].includes(o.status));
      if (open.length) { if ((await t.api('DELETE', `/api/trading/orders/${pick(open).id}`, a.token)).status === 200) counts.cancelled++; }
      continue;
    }
    if (roll < 0.10) {
      const r = await t.api('POST', '/api/trading/retire', a.token, { credit_id: pick(credits), quantity: 1 + Math.floor(rnd() * 20), beneficiary: 'Random test', report_year: 2025 });
      if (r.status === 201) counts.retired++;
      continue;
    }
    const credit = pick(credits);
    const body = {
      credit_id: credit,
      order_type: rnd() < 0.5 ? 'buy' : 'sell',
      quantity: 1 + Math.floor(rnd() * 200),
      price_per_unit: Number((basePrice[credit] * (0.85 + rnd() * 0.3)).toFixed(2)),
    };
    const r = await t.api('POST', '/api/trading/orders', a.token, body);
    if (r.status === 201) { counts.placed++; counts.trades += r.body.trades.length; }
    else if (/Insufficient funds/.test(r.body.error)) counts.rejected_funds++;
    else if (/Insufficient credits/.test(r.body.error)) counts.rejected_holdings++;
    else counts.other++;
  }
  counts.seconds = (Date.now() - started) / 1000;
  console.log('RESULT random ' + JSON.stringify(counts));
  assert.equal(counts.other, 0);
  assert.ok(counts.trades > 50);
});

test('40 concurrent buy orders on one credit', async () => {
  const seller = actors[2]; // GreenTerra lists 400 t of VCS-2023 at $20
  await t.api('POST', '/api/trading/orders', seller.token, { credit_id: SEED.credits.vcs2023, order_type: 'sell', quantity: 400, price_per_unit: 20 });
  const buyers = actors.slice(4);
  const started = performance.now();
  const results = await Promise.all(Array.from({ length: 40 }, (_, i) =>
    t.api('POST', '/api/trading/orders', buyers[i % buyers.length].token, { credit_id: SEED.credits.vcs2023, order_type: 'buy', quantity: 20, price_per_unit: 25 })));
  const wall = performance.now() - started;
  const ok = results.filter((r) => r.status === 201).length;
  const filled = results.filter((r) => r.status === 201).reduce((s, r) => s + Number(r.body.order.filled_qty), 0);
  console.log('RESULT concurrency ' + JSON.stringify({ requests: 40, ok, filled_tonnes: filled, wall_ms: Math.round(wall) }));
  assert.equal(ok, 40);
});

const INVARIANTS = {
  'filled quantity never exceeds order quantity': `SELECT COUNT(*) FROM trading.orders WHERE filled_qty > quantity`,
  'filled quantity equals the sum of the order\'s trades': `SELECT COUNT(*) FROM trading.orders o WHERE o.filled_qty <> COALESCE((SELECT SUM(quantity) FROM trading.trades t WHERE t.buy_order_id = o.id OR t.sell_order_id = o.id), 0)`,
  'trade price lies within both limit prices': `SELECT COUNT(*) FROM trading.trades t JOIN trading.orders b ON t.buy_order_id = b.id JOIN trading.orders s ON t.sell_order_id = s.id WHERE t.trade_price > b.price_per_unit OR t.trade_price < s.price_per_unit`,
  'no self-trades': `SELECT COUNT(*) FROM trading.trades WHERE buyer_company_id = seller_company_id`,
  'order status consistent with fill': `SELECT COUNT(*) FROM trading.orders WHERE (status = 'filled' AND filled_qty <> quantity) OR (status = 'open' AND filled_qty <> 0) OR (status = 'partially_filled' AND (filled_qty = 0 OR filled_qty >= quantity))`,
  'no negative holdings (sold + retired never exceed owned)': `SELECT COUNT(*) FROM (SELECT
        CASE WHEN cp.company_id = c.id THEN cc.quantity ELSE 0 END
        + COALESCE((SELECT SUM(quantity) FROM trading.trades WHERE credit_id = cc.id AND buyer_company_id = c.id), 0)
        - COALESCE((SELECT SUM(quantity) FROM trading.trades WHERE credit_id = cc.id AND seller_company_id = c.id), 0)
        - COALESCE((SELECT SUM(quantity) FROM registry.retirements WHERE credit_id = cc.id AND company_id = c.id), 0) AS held
      FROM registry.companies c CROSS JOIN registry.carbon_credits cc JOIN registry.carbon_projects cp ON cc.project_id = cp.id) x WHERE held < 0`,
  'order book not crossed between companies': `SELECT COUNT(*) FROM trading.orders b JOIN trading.orders s ON b.credit_id = s.credit_id
      WHERE b.order_type = 'buy' AND s.order_type = 'sell' AND b.company_id <> s.company_id
        AND b.status IN ('open','partially_filled') AND s.status IN ('open','partially_filled') AND b.price_per_unit >= s.price_per_unit`,
  'money is conserved: balances = deposits − withdrawals − fees': `SELECT COUNT(*) FROM (SELECT
        (SELECT SUM(balance) FROM trading.wallets) AS bal,
        (SELECT SUM(amount) FROM trading.wallet_ledger WHERE entry_type = 'deposit')
        + (SELECT COALESCE(SUM(amount), 0) FROM trading.wallet_ledger WHERE entry_type = 'withdrawal')
        - (SELECT SUM(platform_fee) FROM trading.trades) AS expected) x WHERE bal <> expected`,
  'each wallet\'s escrow equals its open buy orders': `SELECT COUNT(*) FROM trading.wallets w WHERE w.reserved <>
        COALESCE((SELECT SUM(reserved_amount) FROM trading.orders o WHERE o.company_id = w.company_id AND o.status IN ('open','partially_filled')), 0)`,
  'open buy orders hold exactly remaining quantity × limit price': `SELECT COUNT(*) FROM trading.orders
        WHERE order_type = 'buy' AND status IN ('open','partially_filled') AND reserved_amount <> ROUND((quantity - filled_qty) * price_per_unit, 2)`,
  'closed orders hold no escrow': `SELECT COUNT(*) FROM trading.orders WHERE status NOT IN ('open','partially_filled') AND reserved_amount <> 0`,
  'each wallet balance equals its own ledger': `SELECT COUNT(*) FROM trading.wallets w WHERE w.balance <>
        (SELECT balance_after FROM trading.wallet_ledger l WHERE l.company_id = w.company_id ORDER BY id DESC LIMIT 1)`,
};

test('all invariants hold after the workload', async () => {
  const results = {};
  for (const [name, sql] of Object.entries(INVARIANTS)) {
    results[name] = Number((await t.db.query(sql)).rows[0].count);
  }
  const totals = (await t.db.query(`SELECT (SELECT COUNT(*) FROM trading.trades) AS trades, (SELECT COUNT(*) FROM registry.retirements) AS retirements,
    (SELECT COUNT(*) FROM trading.wallet_ledger) AS ledger_rows, (SELECT SUM(platform_fee) FROM trading.trades) AS fees`)).rows[0];
  console.log('RESULT invariants ' + JSON.stringify({ results, totals }));
  for (const [name, violations] of Object.entries(results)) assert.equal(violations, 0, name);
});
