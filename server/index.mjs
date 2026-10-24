// Start the Seller Portal server.  Usage: npm run build && npm start
//
// Environment:
//   PORT                 default 8787
//   HOST                 default 127.0.0.1
//   DATA_DIR             default ./.data (database + private uploads; keep out of web roots and backups you don't control)
//   DATA_ENCRYPTION_KEY  base64 32 bytes. Required when NODE_ENV=production.
//   COOKIE_SECURE        "true" behind HTTPS (default: true in production)
//   ADMIN_API_TOKENS     "token1:Reviewer Name;token2:Other Reviewer" (tokens ≥ 32 chars) for the Super Admin Portal
//   CODE_DELIVERY        "console" (development only) — no email/SMS provider is configured yet
//   DEMO_TOOLS           "1" to enable checkout/delivery simulators (never in production)

import { createServer } from 'node:http';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const env = process.env;
const production = env.NODE_ENV === 'production';
const dataDir = resolve(env.DATA_DIR ?? join(root, '.data'));

function encryptionKey() {
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

const app = createApp({
  rootDir: root,
  dataDir,
  encryptionKey: encryptionKey(),
  cookieSecure: env.COOKIE_SECURE ? env.COOKIE_SECURE === 'true' : production,
  adminTokens: adminTokens(),
  deliverCode: codeDelivery(),
  demoTools: env.DEMO_TOOLS === '1',
});

const port = Number(env.PORT ?? 8787);
const host = env.HOST ?? '127.0.0.1';
createServer((req, res) => void app.handle(req, res)).listen(port, host, () => {
  console.log(`Mithren Agro Seller Portal listening on http://${host}:${port}`);
});
