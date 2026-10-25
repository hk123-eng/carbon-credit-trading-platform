// Company wallets with escrow. All functions must run inside a transaction on
// the given client. Amounts are passed to PostgreSQL as strings/numerics so
// rounding happens in NUMERIC arithmetic, not in floating point.

class InsufficientFundsError extends Error {
  constructor(available) {
    super(`Insufficient funds. Available: ${available}.`);
    this.available = available;
  }
}

async function ensureWallet(client, companyId) {
  await client.query(
    'INSERT INTO trading.wallets (company_id) VALUES ($1) ON CONFLICT (company_id) DO NOTHING',
    [companyId]
  );
}

async function getWallet(db, companyId) {
  const r = await db.query(
    'SELECT balance, reserved, balance - reserved AS available FROM trading.wallets WHERE company_id = $1',
    [companyId]
  );
  return r.rows[0] || { balance: '0.00', reserved: '0.00', available: '0.00' };
}

// Applies a change to balance and/or reserved funds and writes one ledger row.
async function post(client, companyId, entryType, { balanceDelta = 0, reservedDelta = 0, amount, referenceId = null, note = null }) {
  const r = await client.query(`
    UPDATE trading.wallets
    SET balance = balance + $2::NUMERIC, reserved = reserved + $3::NUMERIC, updated_at = NOW()
    WHERE company_id = $1
    RETURNING balance, reserved
  `, [companyId, String(balanceDelta), String(reservedDelta)]);
  if (r.rows.length === 0) throw new Error('Wallet not found for company ' + companyId);
  await client.query(`
    INSERT INTO trading.wallet_ledger (company_id, entry_type, amount, balance_after, reserved_after, reference_id, note)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
  `, [companyId, entryType, String(amount), r.rows[0].balance, r.rows[0].reserved, referenceId, note]);
  return r.rows[0];
}

async function deposit(client, companyId, amount, note) {
  await ensureWallet(client, companyId);
  return post(client, companyId, 'deposit', { balanceDelta: amount, amount, note });
}

async function withdraw(client, companyId, amount, note) {
  const w = await lockWallet(client, companyId);
  if (Number(w.available) < Number(amount)) throw new InsufficientFundsError(w.available);
  return post(client, companyId, 'withdrawal', { balanceDelta: -amount, amount: -amount, note });
}

async function lockWallet(client, companyId) {
  await ensureWallet(client, companyId);
  const r = await client.query(
    'SELECT balance, reserved, balance - reserved AS available FROM trading.wallets WHERE company_id = $1 FOR UPDATE',
    [companyId]
  );
  return r.rows[0];
}

// Moves `amount` of available funds into escrow for a buy order.
async function hold(client, companyId, amount, orderId) {
  const w = await lockWallet(client, companyId);
  if (Number(w.available) < Number(amount)) throw new InsufficientFundsError(w.available);
  return post(client, companyId, 'hold', { reservedDelta: amount, amount, referenceId: orderId, note: 'Escrow for buy order' });
}

// Returns whatever escrow is still held by a buy order (on cancel, expiry or full fill).
async function releaseOrder(client, orderId, note) {
  const r = await client.query(`
    UPDATE trading.orders o SET reserved_amount = 0
    FROM (SELECT id, reserved_amount FROM trading.orders WHERE id = $1) old
    WHERE o.id = old.id AND old.reserved_amount > 0
    RETURNING o.company_id, old.reserved_amount AS released
  `, [orderId]);
  if (r.rows.length === 0) return 0;
  const { company_id, released } = r.rows[0];
  await post(client, company_id, 'release', { reservedDelta: `-${released}`, amount: released, referenceId: orderId, note });
  return Number(released);
}

// Settles one executed trade: the buyer pays the trade value out of the escrow
// held by its buy order (any price improvement stays in the buyer's wallet),
// and the seller receives the trade value minus the platform fee.
async function settleTrade(client, trade, buyOrderId) {
  const take = await client.query(`
    UPDATE trading.orders o
    SET reserved_amount = o.reserved_amount - LEAST(o.reserved_amount, ROUND($2::NUMERIC * o.price_per_unit, 2))
    FROM (SELECT id, reserved_amount, price_per_unit FROM trading.orders WHERE id = $1) old
    WHERE o.id = old.id
    RETURNING LEAST(old.reserved_amount, ROUND($2::NUMERIC * old.price_per_unit, 2)) AS escrow_used
  `, [buyOrderId, String(trade.quantity)]);
  const escrowUsed = take.rows[0].escrow_used;
  const improvement = (Number(escrowUsed) - Number(trade.total_value)).toFixed(2);

  await post(client, trade.buyer_company_id, 'purchase', {
    balanceDelta: `-${trade.total_value}`,
    reservedDelta: `-${escrowUsed}`,
    amount: `-${trade.total_value}`,
    referenceId: trade.id,
    note: Number(improvement) > 0
      ? `Paid from escrow; $${improvement} price improvement returned to available funds`
      : 'Paid from escrow'
  });
  await post(client, trade.seller_company_id, 'sale', {
    balanceDelta: trade.net_value,
    amount: trade.net_value,
    referenceId: trade.id,
    note: 'Trade proceeds after 0.5% platform fee'
  });
}

module.exports = { InsufficientFundsError, ensureWallet, getWallet, deposit, withdraw, hold, releaseOrder, settleTrade };
