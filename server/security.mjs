// Cryptography helpers: password hashing, token hashing, field encryption.

import { scrypt, randomBytes, createHash, createHmac, createCipheriv, createDecipheriv, timingSafeEqual, randomInt, hkdfSync } from 'node:crypto';

const SCRYPT = { N: 32768, r: 8, p: 1, keyLen: 32, maxmem: 64 * 1024 * 1024 };

export function hashPassword(password) {
  const salt = randomBytes(16);
  return new Promise((resolve, reject) => {
    scrypt(password, salt, SCRYPT.keyLen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, maxmem: SCRYPT.maxmem }, (err, key) => {
      if (err) return reject(err);
      resolve(`scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${key.toString('base64')}`);
    });
  });
}

export function verifyPassword(password, stored) {
  const [alg, N, r, p, saltB64, keyB64] = String(stored).split('$');
  if (alg !== 'scrypt') return Promise.resolve(false);
  const expected = Buffer.from(keyB64, 'base64');
  return new Promise((resolve) => {
    scrypt(password, Buffer.from(saltB64, 'base64'), expected.length, { N: Number(N), r: Number(r), p: Number(p), maxmem: SCRYPT.maxmem }, (err, key) => {
      resolve(!err && key.length === expected.length && timingSafeEqual(key, expected));
    });
  });
}

/** A real hash to spend time on when the account doesn't exist, so timing doesn't reveal it. */
export const DUMMY_HASH = `scrypt$32768$8$1$${Buffer.alloc(16).toString('base64')}$${Buffer.alloc(32).toString('base64')}`;

export const newToken = () => randomBytes(32).toString('base64url');
export const sha256 = (v) => createHash('sha256').update(v).digest('hex');
export const newId = (prefix) => `${prefix}_${randomBytes(12).toString('base64url')}`;
export const sixDigitCode = () => String(randomInt(0, 1_000_000)).padStart(6, '0');

export function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Field encryption (AES-256-GCM). The ciphertext is bound to its row via AAD. */
export function createFieldCipher(masterKey) {
  if (!Buffer.isBuffer(masterKey) || masterKey.length !== 32) throw new Error('DATA_ENCRYPTION_KEY must be 32 bytes (base64).');
  const fieldKey = Buffer.from(hkdfSync('sha256', masterKey, Buffer.alloc(0), 'mithren-seller-portal:field-encryption:v1', 32));
  const codeKey = Buffer.from(hkdfSync('sha256', masterKey, Buffer.alloc(0), 'mithren-seller-portal:verification-codes:v1', 32));
  return {
    keyVersion: 'v1',
    encrypt(plaintext, aad) {
      const iv = randomBytes(12);
      const c = createCipheriv('aes-256-gcm', fieldKey, iv);
      c.setAAD(Buffer.from(aad));
      const ct = Buffer.concat([c.update(plaintext, 'utf8'), c.final()]);
      return Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64');
    },
    decrypt(blob, aad) {
      const buf = Buffer.from(blob, 'base64');
      const d = createDecipheriv('aes-256-gcm', fieldKey, buf.subarray(0, 12));
      d.setAAD(Buffer.from(aad));
      d.setAuthTag(buf.subarray(12, 28));
      return Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString('utf8');
    },
    hashCode(userId, channel, code) {
      return createHmac('sha256', codeKey).update(`${userId}:${channel}:${code}`).digest('hex');
    },
  };
}
