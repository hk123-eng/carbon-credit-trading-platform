const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME || 'carbon_credit_platform',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

pool.on('connect', () => {
  console.log('✅ Connected to PostgreSQL database');
});

pool.on('error', (err) => {
  console.error('❌ PostgreSQL pool error:', err.message);
});

// Helper: write an audit log entry using the given client or pool. Call it
// outside any open transaction (e.g. after COMMIT). Never throws, so a logging
// failure can't break a request.
async function audit(db, userId, action, schemaName, tableName, recordId = null) {
  try {
    await db.query(
      `INSERT INTO auth.audit_log (user_id, action, schema_name, table_name, record_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [userId || null, action, schemaName, tableName, recordId ? String(recordId) : null]
    );
  } catch (err) {
    console.error('Audit log error:', err.message);
  }
}

module.exports = { pool, audit };
