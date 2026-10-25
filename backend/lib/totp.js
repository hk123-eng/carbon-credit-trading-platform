// Time-based one-time passwords (RFC 6238) for two-factor login, compatible with
// Google Authenticator, Microsoft Authenticator and similar apps.
const crypto = require('crypto');

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const STEP_SECONDS = 30;
const DIGITS = 6;

function base32Encode(buf) {
  let bits = 0, value = 0, out = '';
  for (const byte of buf) {
    value = ((value << 8) | byte) & 0xffff;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(str) {
  const clean = String(str).replace(/=+$/, '').replace(/\s+/g, '').toUpperCase();
  let bits = 0, value = 0;
  const out = [];
  for (const ch of clean) {
    const idx = ALPHABET.indexOf(ch);
    if (idx < 0) throw new Error('Invalid base32 character');
    value = ((value << 5) | idx) & 0xffff;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

function generateSecret() {
  return base32Encode(crypto.randomBytes(20)); // 160-bit secret, as recommended by RFC 4226
}

function hotp(secret, counter, digits = DIGITS) {
  const key = Buffer.isBuffer(secret) ? secret : base32Decode(secret);
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac('sha1', key).update(msg).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code = (hmac.readUInt32BE(offset) & 0x7fffffff) % 10 ** digits;
  return String(code).padStart(digits, '0');
}

function totp(secret, timeMs = Date.now()) {
  return hotp(secret, Math.floor(timeMs / 1000 / STEP_SECONDS));
}

// Accepts the code for the current 30-second step and one step either side to
// tolerate clock drift between the phone and the server.
function verifyTotp(secret, code, timeMs = Date.now(), window = 1) {
  if (!secret || !/^\d{6}$/.test(String(code || ''))) return false;
  const counter = Math.floor(timeMs / 1000 / STEP_SECONDS);
  const given = Buffer.from(String(code));
  for (let i = -window; i <= window; i++) {
    if (crypto.timingSafeEqual(Buffer.from(hotp(secret, counter + i)), given)) return true;
  }
  return false;
}

function otpauthUrl(secret, account, issuer = 'CarbonTrade') {
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}` +
    `?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${DIGITS}&period=${STEP_SECONDS}`;
}

module.exports = { base32Encode, base32Decode, generateSecret, hotp, totp, verifyTotp, otpauthUrl };
