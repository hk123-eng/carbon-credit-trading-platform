const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(cors({
  origin: process.env.FRONTEND_URL || '*',
  credentials: true
}));
app.use(express.json({ limit: '8mb' })); // room for a 5 MB KYC document sent as base64
app.use(express.urlencoded({ extended: true }));

// Rate limiting
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: parseInt(process.env.RATE_LIMIT_MAX) || 200, message: { error: 'Too many requests.' } });
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: parseInt(process.env.AUTH_RATE_LIMIT_MAX) || 20, message: { error: 'Too many login attempts.' } });
app.use('/api/', limiter);
app.use('/api/auth/login', authLimiter);

// ── API Routes ────────────────────────────────────────────────────────────────
const authRoutes = require('./routes/auth');
app.use('/api/auth',          authRoutes);
app.use('/api/market',        require('./routes/market'));
app.use('/api/trading',       require('./routes/trading'));
app.use('/api/companies',     require('./routes/companies'));
app.use('/api/compliance',    require('./routes/compliance'));
app.use('/api/wallet',        require('./routes/wallet'));
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api/admin',         require('./routes/admin'));

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/api/health', async (req, res) => {
  try {
    const { pool } = require('./db');
    await pool.query('SELECT 1');
    res.json({ status: 'ok', database: 'connected', timestamp: new Date().toISOString() });
  } catch (err) {
    res.status(503).json({ status: 'error', database: 'disconnected' });
  }
});

// ── E-mail verification link (opened from the e-mail, outside the SPA) ───────
app.get('/verify-email', async (req, res) => {
  const result = await authRoutes.verifyEmailToken(req.query.token);
  res.redirect(result.ok ? '/?verified=1' : '/?verified=0');
});

// ── Serve frontend static files ───────────────────────────────────────────────
const frontendPath = path.join(__dirname, '..', 'frontend');
app.use(express.static(frontendPath));

// SPA fallback — any unmatched route serves index.html
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'API endpoint not found.' });
  }
  res.sendFile(path.join(frontendPath, 'index.html'));
});

// ── Start (only when run directly, so tests can import the app) ──────────────
if (require.main === module) {
  const { pool } = require('./db');
  const { startOrderExpiryScheduler } = require('./jobs/order-expiry');
  app.listen(PORT, () => {
    console.log(`\n🌱 Carbon Credit Platform`);
    console.log(`   API:      http://localhost:${PORT}/api`);
    console.log(`   Frontend: http://localhost:${PORT}`);
    console.log(`   Health:   http://localhost:${PORT}/api/health\n`);
  });
  startOrderExpiryScheduler(pool, parseInt(process.env.ORDER_EXPIRY_INTERVAL_MS) || 60000);
}

module.exports = app;
