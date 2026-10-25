const express = require('express');
const router = express.Router();
const { pool, audit } = require('../db');
const { authMiddleware } = require('../middleware/auth');
const wallet = require('../lib/wallet');

const MAX_SINGLE_TRANSFER = 1000000;

async function getCompany(db, userId) {
  const r = await db.query('SELECT id, kyc_status FROM registry.companies WHERE user_id = $1', [userId]);
  return r.rows[0] || null;
}

function parseAmount(raw) {
  const amount = Number(raw);
  if (!Number.isFinite(amount) || amount <= 0) return { error: 'Amount must be a positive number.' };
  if (amount > MAX_SINGLE_TRANSFER) return { error: `A single transfer cannot exceed $${MAX_SINGLE_TRANSFER.toLocaleString('en-US')}.` };
  if (Math.round(amount * 100) !== amount * 100) return { error: 'Amount can have at most 2 decimal places.' };
  return { amount: amount.toFixed(2) };
}

// GET /api/wallet - Balance, escrow and recent ledger entries
router.get('/', authMiddleware, async (req, res) => {
  try {
    const company = await getCompany(pool, req.user.id);
    if (!company) return res.status(404).json({ error: 'Company not found.' });
    const w = await wallet.getWallet(pool, company.id);
    const ledger = await pool.query(`
      SELECT id, entry_type, amount, balance_after, reserved_after, reference_id, note, created_at
      FROM trading.wallet_ledger WHERE company_id = $1 ORDER BY id DESC LIMIT 100
    `, [company.id]);
    res.json({ ...w, ledger: ledger.rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch wallet.' });
  }
});

// Deposits use a sandbox payment step: no real card or bank transfer is
// processed. A payment gateway would be called here before crediting funds.
async function transfer(req, res, kind) {
  const parsed = parseAmount(req.body.amount);
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const company = await getCompany(client, req.user.id);
    if (!company) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Company not found.' }); }
    if (company.kyc_status !== 'approved') {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'KYC approval required before moving funds.' });
    }
    const after = kind === 'deposit'
      ? await wallet.deposit(client, company.id, parsed.amount, 'Sandbox deposit')
      : await wallet.withdraw(client, company.id, parsed.amount, 'Withdrawal to registered bank account (sandbox)');
    await client.query('COMMIT');
    await audit(client, req.user.id, 'UPDATE', 'trading', 'wallets', company.id);
    res.status(201).json({
      message: kind === 'deposit' ? 'Funds added.' : 'Withdrawal recorded.',
      balance: after.balance, reserved: after.reserved
    });
  } catch (err) {
    await client.query('ROLLBACK');
    if (err instanceof wallet.InsufficientFundsError) return res.status(400).json({ error: err.message });
    console.error('Wallet error:', err.message);
    res.status(500).json({ error: 'Wallet operation failed.' });
  } finally {
    client.release();
  }
}

router.post('/deposit', authMiddleware, (req, res) => transfer(req, res, 'deposit'));
router.post('/withdraw', authMiddleware, (req, res) => transfer(req, res, 'withdraw'));

module.exports = router;
