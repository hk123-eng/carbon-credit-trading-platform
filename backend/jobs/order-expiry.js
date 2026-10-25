// Background job: marks open orders whose expiry time has passed as 'expired',
// returns any escrow held by expired buy orders, and notifies the owners.
const { releaseOrder } = require('../lib/wallet');
const { notifyCompany } = require('../lib/notify');
const { audit } = require('../db');

async function expireOrders(pool) {
  const client = await pool.connect();
  let expired = [];
  try {
    await client.query('BEGIN');
    const due = await client.query(`
      SELECT o.id, o.company_id, o.order_type, o.quantity, o.filled_qty, cc.serial_number
      FROM trading.orders o
      JOIN registry.carbon_credits cc ON cc.id = o.credit_id
      WHERE o.status IN ('open','partially_filled')
        AND o.order_expiry IS NOT NULL AND o.order_expiry <= NOW()
      FOR UPDATE OF o SKIP LOCKED
    `);
    for (const o of due.rows) {
      await client.query(`UPDATE trading.orders SET status = 'expired' WHERE id = $1`, [o.id]);
      if (o.order_type === 'buy') await releaseOrder(client, o.id, 'Order expired');
    }
    await client.query('COMMIT');
    expired = due.rows;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  for (const o of expired) {
    const left = Number(o.quantity) - Number(o.filled_qty);
    await notifyCompany(pool, o.company_id, 'order_expired', `Your ${o.order_type} order for ${o.serial_number} expired`,
      `${left} tCO2e were still unfilled when the order expired.`, 'trading');
    await audit(pool, null, 'UPDATE', 'trading', 'orders', o.id);
  }
  return expired.length;
}

function startOrderExpiryScheduler(pool, intervalMs = 60000) {
  const timer = setInterval(() => {
    expireOrders(pool)
      .then((n) => { if (n > 0) console.log(`[jobs] expired ${n} order(s)`); })
      .catch((err) => console.error('[jobs] order expiry failed:', err.message));
  }, intervalMs);
  timer.unref();
  return timer;
}

module.exports = { expireOrders, startOrderExpiryScheduler };
