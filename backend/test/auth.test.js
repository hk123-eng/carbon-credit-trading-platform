const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup, SEED } = require('./helpers');
const totp = require('../lib/totp');

let t;
before(async () => { t = await setup('auth'); });
after(async () => { await t.close(); });

const email = `new.buyer.${Date.now()}@example.com`;
let verifyUrl;

test('registration rejects missing fields, short passwords, bad e-mail and the admin role', async () => {
  assert.equal((await t.api('POST', '/api/auth/register', null, { email })).status, 400);
  assert.equal((await t.api('POST', '/api/auth/register', null, { email, password: 'short', full_name: 'A', role: 'buyer' })).status, 400);
  assert.equal((await t.api('POST', '/api/auth/register', null, { email: 'not-an-email', password: 'Long@12345', full_name: 'A', role: 'buyer' })).status, 400);
  assert.equal((await t.api('POST', '/api/auth/register', null, { email, password: 'Long@12345', full_name: 'A', role: 'admin' })).status, 400);
});

test('registration succeeds and sends a verification e-mail to the outbox', async () => {
  const r = await t.api('POST', '/api/auth/register', null, { email, password: 'Long@12345', full_name: 'New Buyer', role: 'buyer' });
  assert.equal(r.status, 201);
  assert.match(r.body.dev_verification_url, /\/verify-email\?token=[0-9a-f]{64}$/);
  verifyUrl = r.body.dev_verification_url;
  const mail = await t.db.query('SELECT subject FROM auth.outbox_emails WHERE to_address = $1', [email]);
  assert.equal(mail.rows.length, 1);
  // only the hash of the token is stored
  const token = new URL(verifyUrl).searchParams.get('token');
  const stored = await t.db.query('SELECT token_hash FROM auth.email_verifications');
  assert.ok(stored.rows.every((row) => row.token_hash !== token));
});

test('duplicate e-mail is rejected', async () => {
  const r = await t.api('POST', '/api/auth/register', null, { email, password: 'Long@12345', full_name: 'X', role: 'buyer' });
  assert.equal(r.status, 409);
});

test('an unverified user cannot register a company', async () => {
  const token = await t.login({ email, password: 'Long@12345' });
  const r = await t.api('POST', '/api/companies', token, { legal_name: 'Unverified Co', company_type: 'buyer', registration_number: 'U-1', country: 'IN', industry_sector: 'energy' });
  assert.equal(r.status, 403);
});

test('verification link works once; a reused or forged link fails', async () => {
  const token = new URL(verifyUrl).searchParams.get('token');
  assert.equal((await t.api('GET', `/api/auth/verify-email?token=${'0'.repeat(64)}`)).status, 400);
  assert.equal((await t.api('GET', `/api/auth/verify-email?token=${token}`)).status, 200);
  assert.equal((await t.api('GET', `/api/auth/verify-email?token=${token}`)).status, 400);
  const me = await t.api('GET', '/api/auth/me', await t.login({ email, password: 'Long@12345' }));
  assert.equal(me.body.is_verified, true);
});

test('the browser link redirects back to the app', async () => {
  const res = await fetch(t.base + '/verify-email?token=bad', { redirect: 'manual' });
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), '/?verified=0');
});

test('login rejects a wrong password and accepts the right one', async () => {
  assert.equal((await t.api('POST', '/api/auth/login', null, { email: SEED.steel.email, password: 'wrong' })).status, 401);
  const r = await t.api('POST', '/api/auth/login', null, SEED.steel);
  assert.equal(r.status, 200);
  assert.ok(r.body.token);
});

test('requests without a token or with a tampered token are refused', async () => {
  assert.equal((await t.api('GET', '/api/market/credits')).status, 401);
  const token = await t.login(SEED.steel);
  assert.equal((await t.api('GET', '/api/market/credits', token.slice(0, -3) + 'abc')).status, 403);
});

test('role-based access control blocks buyers from admin functions', async () => {
  const token = await t.login(SEED.steel);
  assert.equal((await t.api('GET', '/api/companies/admin/all', token)).status, 403);
  assert.equal((await t.api('GET', '/api/admin/stats', token)).status, 403);
  assert.equal((await t.api('POST', '/api/trading/execute', token, {})).status, 403);
  assert.equal((await t.api('POST', '/api/admin/jobs/expire-orders', token)).status, 403);
});

test('two-factor login: setup, wrong code, enable, login with code, disable', async () => {
  const token = await t.login(SEED.air);
  const setupRes = await t.api('POST', '/api/auth/mfa/setup', token);
  assert.equal(setupRes.status, 200);
  assert.match(setupRes.body.otpauth_url, /^otpauth:\/\/totp\//);
  const secret = setupRes.body.secret;

  assert.equal((await t.api('POST', '/api/auth/mfa/enable', token, { code: '000000' })).status, 400);
  assert.equal((await t.api('POST', '/api/auth/mfa/enable', token, { code: totp.totp(secret) })).status, 200);

  const noCode = await t.api('POST', '/api/auth/login', null, SEED.air);
  assert.equal(noCode.status, 401);
  assert.equal(noCode.body.mfa_required, true);
  assert.equal((await t.api('POST', '/api/auth/login', null, { ...SEED.air, mfa_code: '123456' === totp.totp(secret) ? '654321' : '123456' })).status, 401);
  const ok = await t.api('POST', '/api/auth/login', null, { ...SEED.air, mfa_code: totp.totp(secret) });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.user.mfa_enabled, true);

  assert.equal((await t.api('POST', '/api/auth/mfa/disable', ok.body.token, { code: totp.totp(secret) })).status, 200);
  assert.equal((await t.api('POST', '/api/auth/login', null, SEED.air)).status, 200);
});

test('five failed attempts lock the account', async () => {
  let r;
  for (let i = 0; i < 5; i++) r = await t.api('POST', '/api/auth/login', null, { email, password: 'wrong-password' });
  assert.equal(r.status, 423);
  assert.equal((await t.api('POST', '/api/auth/login', null, { email, password: 'Long@12345' })).status, 423);
});
