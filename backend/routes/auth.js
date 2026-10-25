const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { pool, audit } = require('../db');
const { authMiddleware } = require('../middleware/auth');
const { sendMail } = require('../lib/mailer');
const { notifyUser } = require('../lib/notify');
const totp = require('../lib/totp');

const MAX_FAILED_LOGINS = 5;
const LOCKOUT_MINUTES = 15;
const VERIFY_TOKEN_HOURS = 24;
require('dotenv').config();

function appUrl(req) {
  return process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
}

function sha256(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

// Creates a single-use verification token, stores only its hash, and e-mails the link.
async function sendVerificationEmail(db, req, user) {
  const token = crypto.randomBytes(32).toString('hex');
  await db.query(
    `INSERT INTO auth.email_verifications (user_id, token_hash, expires_at)
     VALUES ($1, $2, NOW() + ($3 || ' hours')::interval)`,
    [user.id, sha256(token), String(VERIFY_TOKEN_HOURS)]
  );
  const link = `${appUrl(req)}/verify-email?token=${token}`;
  await sendMail(db, user.email, 'Verify your CarbonTrade e-mail address',
    `Hello ${user.full_name},\n\nPlease confirm your e-mail address by opening this link within ${VERIFY_TOKEN_HOURS} hours:\n${link}\n\nIf you did not create an account, you can ignore this message.`);
  return link;
}

// Marks the token's user as verified. Returns { ok, error }.
async function verifyEmailToken(token) {
  if (!/^[0-9a-f]{64}$/.test(String(token || ''))) return { ok: false, error: 'Invalid verification link.' };
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = await client.query(`
      UPDATE auth.email_verifications SET used_at = NOW()
      WHERE token_hash = $1 AND used_at IS NULL AND expires_at > NOW()
      RETURNING user_id
    `, [sha256(token)]);
    if (r.rows.length === 0) {
      await client.query('ROLLBACK');
      return { ok: false, error: 'This verification link is invalid, already used or expired.' };
    }
    await client.query('UPDATE auth.users SET is_verified = TRUE WHERE id = $1', [r.rows[0].user_id]);
    await client.query('COMMIT');
    await audit(client, r.rows[0].user_id, 'UPDATE', 'auth', 'users', r.rows[0].user_id);
    return { ok: true };
  } catch (err) {
    await client.query('ROLLBACK');
    return { ok: false, error: 'Verification failed.' };
  } finally {
    client.release();
  }
}

// POST /api/auth/register
router.post('/register', async (req, res) => {
  const { email, password, full_name, role, phone } = req.body;
  if (!email || !password || !full_name || !role) {
    return res.status(400).json({ error: 'email, password, full_name, and role are required.' });
  }
  if (!['buyer', 'seller'].includes(role)) {
    return res.status(400).json({ error: 'Role must be buyer or seller.' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Please enter a valid e-mail address.' });
  }

  const client = await pool.connect();
  try {
    const existing = await client.query('SELECT id FROM auth.users WHERE email = $1', [email.toLowerCase()]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Email already registered.' });
    }

    // Hash password with bcrypt (12 rounds to meet DB check length >= 60)
    const password_hash = await bcrypt.hash(password, 12);

    const result = await client.query(
      `INSERT INTO auth.users (email, password_hash, role, full_name, phone, is_verified)
       VALUES ($1, $2, $3, $4, $5, FALSE)
       RETURNING id, email, role, full_name, created_at`,
      [email.toLowerCase(), password_hash, role, full_name, phone || null]
    );
    const user = result.rows[0];
    const link = await sendVerificationEmail(client, req, user);

    await audit(client, user.id, 'INSERT', 'auth', 'users', user.id);
    const body = { message: 'Registration successful. Check your e-mail to verify your address.', user };
    // Without an SMTP server the link is returned in development so it can be opened directly
    if (process.env.NODE_ENV !== 'production') body.dev_verification_url = link;
    res.status(201).json(body);
  } catch (err) {
    console.error('Register error:', err.message);
    res.status(500).json({ error: 'Registration failed.' });
  } finally {
    client.release();
  }
});

// GET /api/auth/verify-email?token=... (JSON variant of the /verify-email link)
router.get('/verify-email', async (req, res) => {
  const r = await verifyEmailToken(req.query.token);
  if (!r.ok) return res.status(400).json({ error: r.error });
  res.json({ message: 'E-mail address verified.' });
});

// POST /api/auth/resend-verification (protected)
router.post('/resend-verification', authMiddleware, async (req, res) => {
  try {
    const u = await pool.query('SELECT id, email, full_name, is_verified FROM auth.users WHERE id = $1', [req.user.id]);
    if (u.rows[0].is_verified) return res.status(400).json({ error: 'Your e-mail address is already verified.' });
    const recent = await pool.query(
      `SELECT COUNT(*)::INT AS n FROM auth.email_verifications WHERE user_id = $1 AND created_at > NOW() - INTERVAL '1 hour'`,
      [req.user.id]
    );
    if (recent.rows[0].n >= 5) return res.status(429).json({ error: 'Too many verification e-mails. Try again later.' });
    const link = await sendVerificationEmail(pool, req, u.rows[0]);
    const body = { message: 'Verification e-mail sent.' };
    if (process.env.NODE_ENV !== 'production') body.dev_verification_url = link;
    res.json(body);
  } catch (err) {
    res.status(500).json({ error: 'Failed to send verification e-mail.' });
  }
});

// POST /api/auth/login  (body: email, password, optional mfa_code)
router.post('/login', async (req, res) => {
  const { email, password, mfa_code } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT id, email, password_hash, role, full_name, is_active, is_verified,
              failed_login_count, locked_until, mfa_enabled, mfa_secret
       FROM auth.users WHERE email = $1`,
      [String(email).toLowerCase()]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const user = result.rows[0];

    if (!user.is_active) {
      return res.status(403).json({ error: 'Account suspended. Contact support.' });
    }

    if (user.locked_until && new Date(user.locked_until) > new Date()) {
      return res.status(423).json({ error: 'Account temporarily locked. Try again later.' });
    }

    // Counts a failed attempt (bad password or bad two-factor code) and locks the
    // account after too many consecutive failures
    const recordFailure = async (message) => {
      const failed = await client.query(
        `UPDATE auth.users
         SET failed_login_count = failed_login_count + 1,
             locked_until = CASE WHEN failed_login_count + 1 >= $2
                                 THEN NOW() + ($3 || ' minutes')::interval
                                 ELSE locked_until END
         WHERE id = $1
         RETURNING failed_login_count`,
        [user.id, MAX_FAILED_LOGINS, String(LOCKOUT_MINUTES)]
      );
      await audit(client, user.id, 'LOGIN_FAILED', 'auth', 'users', user.id);
      if (failed.rows[0].failed_login_count >= MAX_FAILED_LOGINS) {
        return res.status(423).json({ error: `Too many failed attempts. Account locked for ${LOCKOUT_MINUTES} minutes.` });
      }
      return res.status(401).json({ error: message });
    };

    const passwordMatch = await bcrypt.compare(password, user.password_hash);
    if (!passwordMatch) return recordFailure('Invalid email or password.');

    if (user.mfa_enabled) {
      if (!mfa_code) {
        return res.status(401).json({ error: 'Enter the 6-digit code from your authenticator app.', mfa_required: true });
      }
      if (!totp.verifyTotp(user.mfa_secret, String(mfa_code).replace(/\s+/g, ''))) {
        return recordFailure('Invalid two-factor code.');
      }
    }

    // Reset failed login count on success
    await client.query(
      'UPDATE auth.users SET failed_login_count = 0, locked_until = NULL, last_login_at = NOW() WHERE id = $1',
      [user.id]
    );
    await audit(client, user.id, 'LOGIN', 'auth', 'users', user.id);

    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role, full_name: user.full_name },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '24h' }
    );

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        full_name: user.full_name,
        is_verified: user.is_verified,
        mfa_enabled: user.mfa_enabled
      }
    });
  } catch (err) {
    console.error('Login error:', err.message);
    res.status(500).json({ error: 'Login failed.' });
  } finally {
    client.release();
  }
});

// GET /api/auth/me  (protected)
router.get('/me', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT u.id, u.email, u.role, u.full_name, u.phone, u.is_verified, u.is_active, u.last_login_at, u.mfa_enabled,
              c.id AS company_id, c.legal_name, c.kyc_status, c.reliability_score, c.company_type
       FROM auth.users u
       LEFT JOIN registry.companies c ON c.user_id = u.id
       WHERE u.id = $1`,
      [req.user.id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch profile.' });
  }
});

// ── Two-factor login (TOTP authenticator apps) ───────────────────────────────

// POST /api/auth/mfa/setup - Create a new secret (not active until confirmed)
router.post('/mfa/setup', authMiddleware, async (req, res) => {
  try {
    const u = await pool.query('SELECT email, mfa_enabled FROM auth.users WHERE id = $1', [req.user.id]);
    if (u.rows[0].mfa_enabled) return res.status(409).json({ error: 'Two-factor login is already turned on.' });
    const secret = totp.generateSecret();
    await pool.query('UPDATE auth.users SET mfa_secret = $1 WHERE id = $2', [secret, req.user.id]);
    res.json({ secret, otpauth_url: totp.otpauthUrl(secret, u.rows[0].email) });
  } catch (err) {
    res.status(500).json({ error: 'Failed to start two-factor setup.' });
  }
});

// POST /api/auth/mfa/enable - Confirm the first code and turn two-factor login on
router.post('/mfa/enable', authMiddleware, async (req, res) => {
  try {
    const u = await pool.query('SELECT mfa_secret, mfa_enabled FROM auth.users WHERE id = $1', [req.user.id]);
    const { mfa_secret, mfa_enabled } = u.rows[0];
    if (mfa_enabled) return res.status(409).json({ error: 'Two-factor login is already turned on.' });
    if (!mfa_secret) return res.status(400).json({ error: 'Start the setup first.' });
    if (!totp.verifyTotp(mfa_secret, String(req.body.code || '').replace(/\s+/g, ''))) {
      return res.status(400).json({ error: 'That code is not correct. Check the time on your phone and try again.' });
    }
    await pool.query('UPDATE auth.users SET mfa_enabled = TRUE WHERE id = $1', [req.user.id]);
    await audit(pool, req.user.id, 'UPDATE', 'auth', 'users', req.user.id);
    await notifyUser(pool, req.user.id, 'security', 'Two-factor login turned on',
      'From now on you will need a code from your authenticator app to sign in.', 'security');
    res.json({ message: 'Two-factor login is now on.' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to enable two-factor login.' });
  }
});

// POST /api/auth/mfa/disable - Requires a valid current code
router.post('/mfa/disable', authMiddleware, async (req, res) => {
  try {
    const u = await pool.query('SELECT mfa_secret, mfa_enabled FROM auth.users WHERE id = $1', [req.user.id]);
    if (!u.rows[0].mfa_enabled) return res.status(400).json({ error: 'Two-factor login is not turned on.' });
    if (!totp.verifyTotp(u.rows[0].mfa_secret, String(req.body.code || '').replace(/\s+/g, ''))) {
      return res.status(400).json({ error: 'That code is not correct.' });
    }
    await pool.query('UPDATE auth.users SET mfa_enabled = FALSE, mfa_secret = NULL WHERE id = $1', [req.user.id]);
    await audit(pool, req.user.id, 'UPDATE', 'auth', 'users', req.user.id);
    await notifyUser(pool, req.user.id, 'security', 'Two-factor login turned off', null, 'security');
    res.json({ message: 'Two-factor login is now off.' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to disable two-factor login.' });
  }
});

module.exports = router;
module.exports.verifyEmailToken = verifyEmailToken;
