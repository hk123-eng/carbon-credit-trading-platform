const express = require('express');
const router = express.Router();
const { pool, audit } = require('../db');
const { authMiddleware, adminOnly } = require('../middleware/auth');
const wallet = require('../lib/wallet');
const { notifyCompany } = require('../lib/notify');

const PLATFORM_FEE_RATE = 0.005; // 0.5% fee, paid by the seller

// ── Helpers ───────────────────────────────────────────────────────────────────

function remaining(order) {
  return Number(order.quantity) - Number(order.filled_qty);
}

// Credits a company can still sell or retire: issued credits (if it owns the
// project) + bought − sold − retired − quantity already listed in open sell orders.
async function availableToSell(client, companyId, creditId) {
  const result = await client.query(`
    SELECT
      COALESCE((SELECT cc.quantity
                FROM registry.carbon_credits cc
                JOIN registry.carbon_projects cp ON cc.project_id = cp.id
                WHERE cc.id = $2 AND cp.company_id = $1), 0)
      + COALESCE((SELECT SUM(quantity) FROM trading.trades WHERE credit_id = $2 AND buyer_company_id = $1), 0)
      - COALESCE((SELECT SUM(quantity) FROM trading.trades WHERE credit_id = $2 AND seller_company_id = $1), 0)
      - COALESCE((SELECT SUM(quantity) FROM registry.retirements WHERE credit_id = $2 AND company_id = $1), 0)
      - COALESCE((SELECT SUM(quantity - filled_qty) FROM trading.orders
                  WHERE credit_id = $2 AND company_id = $1 AND order_type = 'sell'
                    AND status IN ('open','partially_filled')), 0)
      AS available
  `, [companyId, creditId]);
  return Number(result.rows[0].available);
}

// Records one trade between a buy and a sell order, updates both orders' fill
// status, settles the money through the wallets and publishes the trade price.
// Must run inside a transaction with both order rows locked.
async function executeTrade(client, buy, sell, quantity, price) {
  const platform_fee = (quantity * price * PLATFORM_FEE_RATE).toFixed(2);

  const tradeResult = await client.query(`
    INSERT INTO trading.trades
      (buy_order_id, sell_order_id, credit_id, buyer_company_id, seller_company_id, quantity, trade_price, platform_fee)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    RETURNING id, credit_id, buyer_company_id, seller_company_id, quantity, trade_price, platform_fee,
              total_value, net_value, executed_at
  `, [buy.id, sell.id, buy.credit_id, buy.company_id, sell.company_id, quantity, price, platform_fee]);
  const trade = tradeResult.rows[0];

  const updated = await client.query(`
    UPDATE trading.orders
    SET filled_qty = filled_qty + $1,
        status = CASE WHEN filled_qty + $1 >= quantity THEN 'filled' ELSE 'partially_filled' END
    WHERE id = ANY($2)
    RETURNING id, status
  `, [quantity, [buy.id, sell.id]]);

  // Money moves in the same transaction as the credits
  await wallet.settleTrade(client, trade, buy.id);
  const buyAfter = updated.rows.find((o) => o.id === buy.id);
  if (buyAfter && buyAfter.status === 'filled') {
    await wallet.releaseOrder(client, buy.id, 'Buy order filled; unused escrow returned');
  }

  // Publish the new price, rolling up the last 24h of trades for this credit
  await client.query(`
    INSERT INTO trading.market_prices (credit_id, price, volume_24h, high_24h, low_24h, open_price)
    SELECT $1, $2,
           COALESCE(SUM(t.quantity), 0),
           GREATEST(COALESCE(MAX(t.trade_price), $2), $2),
           LEAST(COALESCE(MIN(t.trade_price), $2), $2),
           COALESCE((SELECT trade_price FROM trading.trades
                     WHERE credit_id = $1 AND executed_at > NOW() - INTERVAL '24 hours'
                     ORDER BY executed_at ASC LIMIT 1), $2)
    FROM trading.trades t
    WHERE t.credit_id = $1 AND t.executed_at > NOW() - INTERVAL '24 hours'
  `, [buy.credit_id, price]);

  return trade;
}

// Matches an incoming order against resting orders on the opposite side using
// price-time priority. Trades execute at the resting order's price.
async function matchOrder(client, incoming) {
  const isBuy = incoming.order_type === 'buy';
  const opposite = await client.query(`
    SELECT * FROM trading.orders
    WHERE credit_id = $1
      AND order_type = $2
      AND company_id <> $3
      AND status IN ('open','partially_filled')
      AND (order_expiry IS NULL OR order_expiry > NOW())
      AND price_per_unit ${isBuy ? '<=' : '>='} $4
    ORDER BY price_per_unit ${isBuy ? 'ASC' : 'DESC'}, placed_at ASC
    FOR UPDATE
  `, [incoming.credit_id, isBuy ? 'sell' : 'buy', incoming.company_id, incoming.price_per_unit]);

  const trades = [];
  let left = remaining(incoming);

  for (const resting of opposite.rows) {
    if (left <= 0) break;
    const qty = Math.min(left, remaining(resting));
    if (qty <= 0) continue;

    const buy = isBuy ? incoming : resting;
    const sell = isBuy ? resting : incoming;
    trades.push(await executeTrade(client, buy, sell, qty, Number(resting.price_per_unit)));
    left -= qty;
  }
  return trades;
}

async function getCompany(db, userId) {
  const result = await db.query('SELECT id, kyc_status, legal_name FROM registry.companies WHERE user_id = $1', [userId]);
  return result.rows[0] || null;
}

async function notifyTrades(db, trades) {
  if (!trades.length) return;
  const serials = await db.query(
    'SELECT id, serial_number FROM registry.carbon_credits WHERE id = ANY($1)',
    [[...new Set(trades.map((t) => t.credit_id))]]
  );
  const serialOf = Object.fromEntries(serials.rows.map((r) => [r.id, r.serial_number]));
  for (const t of trades) {
    const what = `${Number(t.quantity)} tCO2e of ${serialOf[t.credit_id]} at $${Number(t.trade_price).toFixed(2)}`;
    await notifyCompany(db, t.buyer_company_id, 'trade', 'Credits bought', `You bought ${what}. Paid $${t.total_value}.`, 'trading');
    await notifyCompany(db, t.seller_company_id, 'trade', 'Credits sold', `You sold ${what}. Received $${t.net_value} after fees.`, 'trading');
  }
}

// ── Orders ────────────────────────────────────────────────────────────────────

// GET /api/trading/orders - My company's orders
router.get('/orders', authMiddleware, async (req, res) => {
  try {
    const company = await getCompany(pool, req.user.id);
    if (!company) return res.status(404).json({ error: 'Company not found.' });

    const result = await pool.query(`
      SELECT o.id, o.order_type, o.quantity, o.price_per_unit, o.filled_qty, o.reserved_amount,
             o.status, o.placed_at, o.order_expiry, o.notes,
             cc.serial_number, cp.name AS project_name, cp.project_type
      FROM trading.orders o
      JOIN registry.carbon_credits cc ON o.credit_id = cc.id
      JOIN registry.carbon_projects cp ON cc.project_id = cp.id
      WHERE o.company_id = $1
      ORDER BY o.placed_at DESC
    `, [company.id]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch orders.' });
  }
});

// POST /api/trading/orders - Place a new order and match it against the order book
router.post('/orders', authMiddleware, async (req, res) => {
  const { credit_id, order_type, notes, order_expiry } = req.body;
  const quantity = Number(req.body.quantity);
  const price_per_unit = Number(req.body.price_per_unit);

  if (!credit_id || !order_type || !req.body.quantity || !req.body.price_per_unit) {
    return res.status(400).json({ error: 'credit_id, order_type, quantity, price_per_unit are required.' });
  }
  if (!['buy', 'sell'].includes(order_type)) {
    return res.status(400).json({ error: 'order_type must be buy or sell.' });
  }
  if (!Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(price_per_unit) || price_per_unit <= 0) {
    return res.status(400).json({ error: 'Quantity and price must be positive numbers.' });
  }
  if (order_expiry) {
    const t = new Date(order_expiry);
    if (Number.isNaN(t.getTime()) || t <= new Date()) {
      return res.status(400).json({ error: 'Order expiry must be a valid time in the future.' });
    }
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const fail = async (status, error) => { await client.query('ROLLBACK'); return res.status(status).json({ error }); };

    const company = await getCompany(client, req.user.id);
    if (!company) return fail(404, 'Company profile not found. Please register your company first.');
    if (company.kyc_status !== 'approved') return fail(403, 'KYC approval required to place orders.');

    // Lock the credit row so concurrent sell orders can't oversell it
    const creditResult = await client.query(
      'SELECT id, status FROM registry.carbon_credits WHERE id = $1 FOR UPDATE', [credit_id]
    );
    if (creditResult.rows.length === 0) return fail(404, 'Credit not found.');
    if (creditResult.rows[0].status !== 'available') return fail(400, 'Credit is not available for trading.');

    if (order_type === 'sell') {
      const available = await availableToSell(client, company.id, credit_id);
      if (quantity > available) return fail(400, `Insufficient credits to sell. Available: ${available}.`);
    }

    const orderResult = await client.query(`
      INSERT INTO trading.orders (company_id, credit_id, order_type, quantity, price_per_unit, notes, order_expiry, reserved_amount)
      VALUES ($1, $2, $3, $4, $5, $6, $7,
              CASE WHEN $8 THEN ROUND($4::NUMERIC * $5::NUMERIC, 2) ELSE 0 END)
      RETURNING *
    `, [company.id, credit_id, order_type, quantity, price_per_unit, notes || null, order_expiry || null, order_type === 'buy']);
    const order = orderResult.rows[0];

    // Buy orders lock quantity × limit price in escrow before they can match
    if (order_type === 'buy') {
      try {
        await wallet.hold(client, company.id, order.reserved_amount, order.id);
      } catch (err) {
        if (err instanceof wallet.InsufficientFundsError) {
          return fail(400, `Insufficient funds for this order ($${order.reserved_amount} needed). Available: $${err.available}.`);
        }
        throw err;
      }
    }

    const trades = await matchOrder(client, order);

    const finalOrder = await client.query(
      'SELECT id, order_type, quantity, price_per_unit, filled_qty, reserved_amount, status, placed_at, order_expiry FROM trading.orders WHERE id = $1',
      [order.id]
    );

    await client.query('COMMIT');

    await audit(client, req.user.id, 'INSERT', 'trading', 'orders', order.id);
    for (const t of trades) await audit(client, req.user.id, 'INSERT', 'trading', 'trades', t.id);
    await notifyTrades(client, trades);

    const message = trades.length
      ? `Order placed. ${trades.length} trade(s) executed.`
      : 'Order placed. Waiting for a matching order.';
    res.status(201).json({ message, order: finalOrder.rows[0], trades });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Place order error:', err.message);
    res.status(500).json({ error: 'Failed to place order.' });
  } finally {
    client.release();
  }
});

// DELETE /api/trading/orders/:id - Cancel an order and return its escrow
router.delete('/orders/:id', authMiddleware, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const company = await getCompany(client, req.user.id);
    if (!company) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Company not found.' }); }

    const result = await client.query(`
      UPDATE trading.orders SET status = 'cancelled'
      WHERE id = $1 AND company_id = $2 AND status IN ('open','partially_filled')
      RETURNING id, order_type
    `, [req.params.id, company.id]);
    if (result.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Order not found or cannot be cancelled.' });
    }
    const released = result.rows[0].order_type === 'buy'
      ? await wallet.releaseOrder(client, req.params.id, 'Order cancelled')
      : 0;
    await client.query('COMMIT');
    await audit(client, req.user.id, 'UPDATE', 'trading', 'orders', req.params.id);
    res.json({ message: 'Order cancelled successfully.', released });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: 'Failed to cancel order.' });
  } finally {
    client.release();
  }
});

// POST /api/trading/execute - Manually match a buy and a sell order (admin only)
router.post('/execute', authMiddleware, adminOnly, async (req, res) => {
  const { buy_order_id, sell_order_id } = req.body;
  const quantity = Number(req.body.quantity);
  const trade_price = Number(req.body.trade_price);
  if (!buy_order_id || !sell_order_id || !(quantity > 0) || !(trade_price > 0)) {
    return res.status(400).json({ error: 'buy_order_id, sell_order_id, and positive quantity and trade_price are required.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const orders = await client.query(`
      SELECT * FROM trading.orders
      WHERE id = ANY($1) AND status IN ('open','partially_filled')
      FOR UPDATE
    `, [[buy_order_id, sell_order_id]]);
    const buy = orders.rows.find(o => o.id === buy_order_id && o.order_type === 'buy');
    const sell = orders.rows.find(o => o.id === sell_order_id && o.order_type === 'sell');

    const fail = async (msg) => { await client.query('ROLLBACK'); return res.status(400).json({ error: msg }); };
    if (!buy || !sell) return fail('Need one open buy order and one open sell order.');
    if (buy.credit_id !== sell.credit_id) return fail('Orders must be for the same credit.');
    if (buy.company_id === sell.company_id) return fail('Cannot trade with yourself.');
    if (quantity > remaining(buy) || quantity > remaining(sell)) return fail('Quantity exceeds what is left on one of the orders.');
    if (trade_price > Number(buy.price_per_unit) || trade_price < Number(sell.price_per_unit)) {
      return fail('Trade price must be between the sell price and the buy price.');
    }

    const trade = await executeTrade(client, buy, sell, quantity, trade_price);
    await client.query('COMMIT');
    await audit(client, req.user.id, 'INSERT', 'trading', 'trades', trade.id);
    await notifyTrades(client, [trade]);
    res.status(201).json({ message: 'Trade executed successfully.', trade });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Trade execution error:', err.message);
    res.status(500).json({ error: 'Trade execution failed.' });
  } finally {
    client.release();
  }
});

// ── Trades and portfolio ─────────────────────────────────────────────────────

// GET /api/trading/trades - Transaction history
router.get('/trades', authMiddleware, async (req, res) => {
  try {
    const company = await getCompany(pool, req.user.id);
    if (!company) return res.json([]);

    const result = await pool.query(`
      SELECT t.id AS trade_id, t.executed_at, t.quantity, t.trade_price, t.total_value,
             t.platform_fee, t.net_value,
             cc.serial_number, cp.name AS project_name, cp.project_type,
             buyer.legal_name AS buyer_name, seller.legal_name AS seller_name,
             CASE WHEN t.buyer_company_id = $1 THEN 'buy' ELSE 'sell' END AS side
      FROM trading.trades t
      JOIN registry.carbon_credits cc ON t.credit_id = cc.id
      JOIN registry.carbon_projects cp ON cc.project_id = cp.id
      JOIN registry.companies buyer ON t.buyer_company_id = buyer.id
      JOIN registry.companies seller ON t.seller_company_id = seller.id
      WHERE t.buyer_company_id = $1 OR t.seller_company_id = $1
      ORDER BY t.executed_at DESC
    `, [company.id]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch trades.' });
  }
});

// GET /api/trading/portfolio - My holdings
router.get('/portfolio', authMiddleware, async (req, res) => {
  try {
    const company = await getCompany(pool, req.user.id);
    if (!company) return res.json([]);

    const result = await pool.query(`
      SELECT * FROM trading.v_portfolio WHERE company_id = $1
    `, [company.id]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch portfolio.' });
  }
});

// ── Retirement ────────────────────────────────────────────────────────────────

// POST /api/trading/retire - Permanently retire held credits and issue a certificate
router.post('/retire', authMiddleware, async (req, res) => {
  const { credit_id, beneficiary, reason } = req.body;
  const quantity = Number(req.body.quantity);
  const report_year = Number(req.body.report_year);
  if (!credit_id || !beneficiary || !String(beneficiary).trim()) {
    return res.status(400).json({ error: 'credit_id and beneficiary are required.' });
  }
  if (!Number.isFinite(quantity) || quantity <= 0) {
    return res.status(400).json({ error: 'Quantity must be a positive number.' });
  }
  if (!Number.isInteger(report_year) || report_year < 2000 || report_year > new Date().getFullYear()) {
    return res.status(400).json({ error: 'Report year must be a past or current year.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const fail = async (status, error) => { await client.query('ROLLBACK'); return res.status(status).json({ error }); };

    const company = await getCompany(client, req.user.id);
    if (!company) return fail(404, 'Company profile not found.');
    if (company.kyc_status !== 'approved') return fail(403, 'KYC approval required to retire credits.');

    const credit = await client.query(
      'SELECT id, serial_number FROM registry.carbon_credits WHERE id = $1 FOR UPDATE', [credit_id]
    );
    if (credit.rows.length === 0) return fail(404, 'Credit not found.');

    const available = await availableToSell(client, company.id, credit_id);
    if (quantity > available) return fail(400, `Insufficient credits to retire. Available: ${available}.`);

    const result = await client.query(`
      INSERT INTO registry.retirements
        (certificate_number, company_id, credit_id, quantity, beneficiary, reason, report_year, retired_by)
      VALUES ('RET-' || $8 || '-' || LPAD(nextval('registry.retirement_cert_seq')::TEXT, 6, '0'),
              $1, $2, $3, $4, $5, $6, $7)
      RETURNING id, certificate_number, quantity, report_year, retired_at
    `, [company.id, credit_id, quantity, String(beneficiary).trim(), reason || null, report_year, req.user.id, String(report_year)]);
    await client.query('COMMIT');

    const r = result.rows[0];
    await audit(client, req.user.id, 'INSERT', 'registry', 'retirements', r.id);
    await notifyCompany(client, company.id, 'retirement', `Retirement certificate ${r.certificate_number} issued`,
      `${quantity} tCO2e of ${credit.rows[0].serial_number} retired for ${report_year}.`, 'retirements');
    res.status(201).json({ message: 'Credits retired. Certificate issued.', retirement: r });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Retire error:', err.message);
    res.status(500).json({ error: 'Failed to retire credits.' });
  } finally {
    client.release();
  }
});

const CERTIFICATE_SQL = `
  SELECT r.id, r.certificate_number, r.quantity, r.beneficiary, r.reason, r.report_year, r.retired_at,
         r.company_id, comp.legal_name AS company_name, comp.country AS company_country,
         cc.serial_number, cc.vintage_year, cc.unit,
         cp.name AS project_name, cp.project_type, cp.verification_standard, cp.country AS project_country
  FROM registry.retirements r
  JOIN registry.companies comp ON comp.id = r.company_id
  JOIN registry.carbon_credits cc ON cc.id = r.credit_id
  JOIN registry.carbon_projects cp ON cp.id = cc.project_id
`;

// GET /api/trading/retirements - My retirement certificates
router.get('/retirements', authMiddleware, async (req, res) => {
  try {
    const company = await getCompany(pool, req.user.id);
    if (!company) return res.json([]);
    const result = await pool.query(CERTIFICATE_SQL + ' WHERE r.company_id = $1 ORDER BY r.retired_at DESC', [company.id]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch retirements.' });
  }
});

// GET /api/trading/retirements/:id - One certificate (owner or admin)
router.get('/retirements/:id', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(CERTIFICATE_SQL + ' WHERE r.id = $1', [req.params.id]);
    const cert = result.rows[0];
    if (!cert) return res.status(404).json({ error: 'Certificate not found.' });
    if (req.user.role !== 'admin') {
      const company = await getCompany(pool, req.user.id);
      if (!company || company.id !== cert.company_id) return res.status(404).json({ error: 'Certificate not found.' });
    }
    res.json(cert);
  } catch (err) {
    res.status(404).json({ error: 'Certificate not found.' });
  }
});

module.exports = router;
module.exports.CERTIFICATE_SQL = CERTIFICATE_SQL;
