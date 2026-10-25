// Server configuration from environment variables (shared by the server and the dev seed script).

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const env = process.env;
export const production = env.NODE_ENV === 'production';
export const dataDir = resolve(env.DATA_DIR ?? join(root, '.data'));

export function encryptionKey() {
  if (env.DATA_ENCRYPTION_KEY) {
    const k = Buffer.from(env.DATA_ENCRYPTION_KEY, 'base64');
    if (k.length !== 32) throw new Error('DATA_ENCRYPTION_KEY must decode to exactly 32 bytes.');
    return k;
  }
  if (production) throw new Error('DATA_ENCRYPTION_KEY is required in production.');
  const file = join(dataDir, 'dev-encryption.key');
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  if (!existsSync(file)) writeFileSync(file, randomBytes(32).toString('base64'), { mode: 0o600 });
  console.warn(`[warn] Using a development encryption key from ${file}. Set DATA_ENCRYPTION_KEY in production.`);
  return Buffer.from(readFileSync(file, 'utf8').trim(), 'base64');
}

function adminTokens() {
  const map = new Map();
  for (const pair of String(env.ADMIN_API_TOKENS ?? '').split(';').filter(Boolean)) {
    const i = pair.indexOf(':');
    const token = pair.slice(0, i).trim();
    const name = pair.slice(i + 1).trim();
    if (i < 0 || token.length < 32 || !name) throw new Error('ADMIN_API_TOKENS entries must be "token:Reviewer Name" with tokens of at least 32 characters.');
    map.set(token, name);
  }
  if (!map.size) console.warn('[warn] ADMIN_API_TOKENS is not set: the Super Admin review API is disabled.');
  return map;
}

function codeDelivery() {
  const mode = env.CODE_DELIVERY ?? (production ? '' : 'console');
  if (mode === 'console') {
    if (production) throw new Error('CODE_DELIVERY=console is not allowed in production. Configure an email/SMS provider.');
    console.warn('[warn] Verification codes are printed to this console (no email/SMS provider configured).');
    return ({ channel, to, code }) => console.log(`[verification] ${channel} code for ${channel === 'email' ? to : `${to.slice(0, 3)}••••••${to.slice(-4)}`}: ${code}`);
  }
  throw new Error('No verification code delivery is configured. Set CODE_DELIVERY=console for development, or integrate an email/SMS provider in server/index.mjs.');
}

if (production && env.DEMO_TOOLS === '1') throw new Error('DEMO_TOOLS must not be enabled in production.');


/** Options for createApp(), validated from the environment. */
export function loadAppConfig() {
  return {
    rootDir: root,
    dataDir,
    encryptionKey: encryptionKey(),
    cookieSecure: env.COOKIE_SECURE ? env.COOKIE_SECURE === 'true' : production,
    adminTokens: adminTokens(),
    deliverCode: codeDelivery(),
    demoTools: env.DEMO_TOOLS === '1',
  };
}
