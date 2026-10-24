// HTTP application: auth, seller application, documents, business RPC,
// Super Admin review API, and static files. Built on node:http only.

import { readFile, writeFile, rename, unlink, mkdir, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, normalize, extname, resolve } from 'node:path';
import * as core from '../dist/api-core.js';
import { ApiError } from '../dist/errors.js';
import { RPC_METHODS, DEMO_RPC_METHODS } from '../dist/rpc.js';
import { ApplicationService, toAccountView, validateSignUp } from '../dist/application-service.js';
import { sniffMime, buildView, DOC_KIND_LABEL } from '../dist/application.js';
import { openDatabase } from './db.mjs';
import { createStore, rowToAccount } from './store.mjs';
import { hashPassword, verifyPassword, DUMMY_HASH, newToken, sha256, newId, sixDigitCode, safeEqual, createFieldCipher } from './security.mjs';

const SESSION_COOKIE = 'msp_session';
const SESSION_DAYS = 7;
const CODE_TTL_MS = 10 * 60_000;
const CODE_RESEND_MS = 30_000;
const CODE_MAX_SENDS_PER_HOUR = 5;
const CODE_MAX_ATTEMPTS = 5;
const LOCK_AFTER_FAILED = 5;
const LOCK_MS = 15 * 60_000;
const JSON_LIMIT = 64 * 1024;

const STATIC_TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.png': 'image/png', '.txt': 'text/plain; charset=utf-8', '.svg': 'image/svg+xml' };
const STATIC_ROOTS = ['dist/', 'assets/'];
const STATIC_FILES = ['styles.css', 'robots.txt'];

/**
 * @param {object} config
 * @param {string} config.rootDir      project root (for static files)
 * @param {string} config.dataDir      database and uploads
 * @param {Buffer} config.encryptionKey 32-byte key for field encryption and code hashing
 * @param {boolean} config.cookieSecure
 * @param {Map<string,string>} config.adminTokens token -> reviewer name
 * @param {(msg: {channel: string, to: string, code: string}) => void} config.deliverCode
 * @param {boolean} [config.demoTools]
 * @param {{signup?: number, signin?: number}} [config.rateLimits] per-IP limits (signups per hour, sign-ins per 15 minutes)
 * @param {(line: string) => void} [config.log]
 */
export function createApp(config) {
  const log = config.log ?? ((l) => console.log(l));
  const db = openDatabase(config.dataDir);
  const cipher = createFieldCipher(config.encryptionKey);
  const store = createStore(db, cipher);
  const service = new ApplicationService(store);
  const uploadsDir = join(config.dataDir, 'uploads');
  const adminTokenHashes = new Map([...config.adminTokens].map(([t, name]) => [sha256(t), name]));
  const ipHits = new Map();

  // ---------- helpers ----------
  const send = (res, status, body, headers = {}) => {
    const payload = body === undefined ? '' : JSON.stringify(body);
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
    res.end(payload);
  };
  const fail = (status, message, fieldErrors) => {
    throw new ApiError(status, message, fieldErrors ?? {});
  };

  function readBody(req, limit) {
    return new Promise((resolveBody, reject) => {
      const chunks = [];
      let size = 0;
      req.on('data', (c) => {
        size += c.length;
        if (size > limit) {
          reject(new ApiError(413, `Request is too large (limit ${Math.round(limit / 1024)} KB).`, { file: `Files must be ${limit / 1048576} MB or smaller.` }));
          req.destroy();
        } else chunks.push(c);
      });
      req.on('end', () => resolveBody(Buffer.concat(chunks)));
      req.on('error', reject);
    });
  }

  async function readJson(req) {
    if (!String(req.headers['content-type'] ?? '').startsWith('application/json')) fail(415, 'Send JSON.');
    const buf = await readBody(req, JSON_LIMIT);
    try {
      const v = JSON.parse(buf.toString('utf8') || '{}');
      if (!v || typeof v !== 'object') fail(400, 'Invalid request body.');
      return v;
    } catch (e) {
      if (e instanceof ApiError) throw e;
      fail(400, 'Invalid JSON.');
    }
  }

  function cookies(req) {
    const out = {};
    for (const part of String(req.headers.cookie ?? '').split(';')) {
      const i = part.indexOf('=');
      if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
    }
    return out;
  }

  const sessionCookie = (token, maxAgeSec) =>
    `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSec}${config.cookieSecure ? '; Secure' : ''}`;

  function startSession(userId) {
    const token = newToken();
    const now = Date.now();
    db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').run(
      sha256(token), userId, new Date(now).toISOString(), new Date(now + SESSION_DAYS * 86_400_000).toISOString(),
    );
    return sessionCookie(token, SESSION_DAYS * 86_400);
  }

  function currentUser(req) {
    const token = cookies(req)[SESSION_COOKIE];
    if (!token || token.length > 100) return null;
    const row = db.prepare('SELECT u.*, s.expires_at AS s_expires FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?').get(sha256(token));
    if (!row) return null;
    if (row.s_expires < new Date().toISOString()) {
      db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
      return null;
    }
    return row;
  }

  function requireUser(req) {
    const u = currentUser(req);
    if (!u) fail(401, 'Please sign in to continue.');
    return { row: u, acc: rowToAccount(u) };
  }

  function requireAdmin(req) {
    const m = /^Bearer (.+)$/.exec(String(req.headers.authorization ?? ''));
    const name = m ? adminTokenHashes.get(sha256(m[1])) : undefined;
    if (!name) fail(401, 'Admin authentication required.');
    return name; // reviewer identity comes from server configuration, never from the request
  }

  /** CSRF defence for cookie-authenticated writes: custom header + same-origin check (plus SameSite=Strict cookies). */
  function checkCsrf(req) {
    if (req.headers['x-requested-with'] !== 'seller-portal') fail(403, 'Request blocked.');
    const origin = req.headers.origin;
    if (origin) {
      const host = req.headers.host;
      if (origin !== `http://${host}` && origin !== `https://${host}`) fail(403, 'Request blocked.');
    }
  }

  function rateLimit(req, key, max, windowMs) {
    const ip = req.socket.remoteAddress ?? 'unknown';
    const k = `${key}:${ip}`;
    const now = Date.now();
    const hits = (ipHits.get(k) ?? []).filter((t) => now - t < windowMs);
    if (hits.length >= max) fail(429, 'Too many attempts. Please wait a few minutes and try again.');
    hits.push(now);
    ipHits.set(k, hits);
  }

  function issueCode(userRow, channel) {
    const now = Date.now();
    const existing = db.prepare('SELECT * FROM verification_codes WHERE user_id = ? AND channel = ?').get(userRow.id, channel);
    let windowStart = now;
    let sends = 1;
    if (existing) {
      if (now - Date.parse(existing.sent_at) < CODE_RESEND_MS) fail(429, 'Please wait 30 seconds before requesting another code.');
      if (now - Date.parse(existing.window_started_at) < 3_600_000) {
        if (existing.sends_in_window >= CODE_MAX_SENDS_PER_HOUR) fail(429, 'Too many codes requested. Try again in an hour.');
        windowStart = Date.parse(existing.window_started_at);
        sends = existing.sends_in_window + 1;
      }
    }
    const code = sixDigitCode();
    db.prepare(`INSERT INTO verification_codes (user_id, channel, code_hash, expires_at, attempts, sent_at, window_started_at, sends_in_window)
      VALUES (?, ?, ?, ?, 0, ?, ?, ?)
      ON CONFLICT(user_id, channel) DO UPDATE SET code_hash = excluded.code_hash, expires_at = excluded.expires_at, attempts = 0,
        sent_at = excluded.sent_at, window_started_at = excluded.window_started_at, sends_in_window = excluded.sends_in_window`).run(
      userRow.id, channel, cipher.hashCode(userRow.id, channel, code), new Date(now + CODE_TTL_MS).toISOString(), new Date(now).toISOString(), new Date(windowStart).toISOString(), sends,
    );
    config.deliverCode({ channel, to: channel === 'email' ? userRow.email : userRow.phone, code });
  }

  const userRowById = (id) => db.prepare('SELECT * FROM users WHERE id = ?').get(id);

  // ---------- routes ----------
  const routes = [];
  const route = (method, pattern, handler) => routes.push({ method, pattern, handler });

  route('GET', /^\/api\/health$/, () => ({ ok: true }));

  route('GET', /^\/api\/auth\/me$/, (req) => {
    const u = currentUser(req);
    return { account: u ? toAccountView(rowToAccount(u)) : null };
  });

  route('POST', /^\/api\/auth\/signup$/, async (req, res) => {
    checkCsrf(req);
    rateLimit(req, 'signup', config.rateLimits?.signup ?? 10, 3_600_000);
    const body = await readJson(req);
    const v = validateSignUp(body);
    if (Object.keys(v.errors).length) fail(422, 'Please fix the highlighted fields.', v.errors);
    const passwordHash = await hashPassword(v.password);
    const account = store.transaction(() => {
      if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(v.email)) fail(409, 'An account with this email already exists. Sign in instead.', { email: 'An account with this email already exists.' });
      if (db.prepare('SELECT 1 FROM users WHERE phone = ?').get(v.phone)) fail(409, 'This mobile number is already registered.', { phone: 'This mobile number is already registered.' });
      const id = newId('usr');
      const sellerId = newId('sel');
      db.prepare('INSERT INTO users (id, seller_id, full_name, email, phone, password_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
        id, sellerId, v.fullName, v.email, v.phone, passwordHash, new Date().toISOString(),
      );
      const acc = rowToAccount(userRowById(id));
      service.createForAccount(acc);
      store.audit({ actorType: 'seller', actorId: id, action: 'account.created', applicationId: null });
      return acc;
    });
    res.setHeader('Set-Cookie', startSession(account.userId));
    // Send both codes straight away; failures here don't undo the account.
    for (const ch of ['email', 'phone']) {
      try {
        issueCode(userRowById(account.userId), ch);
      } catch {
        /* the seller can request again */
      }
    }
    return { status: 201, body: { account: toAccountView(account) } };
  });

  route('POST', /^\/api\/auth\/send-code$/, async (req) => {
    checkCsrf(req);
    const { row } = requireUser(req);
    const { channel } = await readJson(req);
    if (channel !== 'email' && channel !== 'phone') fail(422, 'Unknown channel.');
    if ((channel === 'email' && row.email_verified_at) || (channel === 'phone' && row.phone_verified_at)) fail(409, 'Already verified.');
    issueCode(row, channel);
    return { sent: true };
  });

  route('POST', /^\/api\/auth\/verify$/, async (req) => {
    checkCsrf(req);
    const { row } = requireUser(req);
    const { channel, code } = await readJson(req);
    if (channel !== 'email' && channel !== 'phone') fail(422, 'Unknown channel.');
    const field = `${channel}Code`;
    const rec = db.prepare('SELECT * FROM verification_codes WHERE user_id = ? AND channel = ?').get(row.id, channel);
    if (!rec || rec.expires_at < new Date().toISOString()) fail(410, 'This code has expired. Send a new one.', { [field]: 'Code expired. Send a new one.' });
    if (rec.attempts >= CODE_MAX_ATTEMPTS) fail(429, 'Too many attempts. Send a new code.', { [field]: 'Too many attempts. Send a new code.' });
    if (!/^\d{6}$/.test(String(code)) || !safeEqual(cipher.hashCode(row.id, channel, String(code)), rec.code_hash)) {
      db.prepare('UPDATE verification_codes SET attempts = attempts + 1 WHERE user_id = ? AND channel = ?').run(row.id, channel);
      fail(422, 'That code is incorrect.', { [field]: 'That code is incorrect.' });
    }
    store.transaction(() => {
      db.prepare('DELETE FROM verification_codes WHERE user_id = ? AND channel = ?').run(row.id, channel);
      db.prepare(`UPDATE users SET ${channel === 'email' ? 'email_verified_at' : 'phone_verified_at'} = ? WHERE id = ?`).run(new Date().toISOString(), row.id);
      const app = store.getApplicationByUser(row.id);
      if (app) service.syncWorkspace(app);
      store.audit({ actorType: 'seller', actorId: row.id, action: `account.${channel}_verified`, applicationId: app?.id ?? null });
    });
    return { account: toAccountView(rowToAccount(userRowById(row.id))) };
  });

  route('POST', /^\/api\/auth\/signin$/, async (req, res) => {
    checkCsrf(req);
    rateLimit(req, 'signin', config.rateLimits?.signin ?? 20, 15 * 60_000);
    const { email, password } = await readJson(req);
    const row = db.prepare('SELECT * FROM users WHERE email = ?').get(String(email ?? '').trim().toLowerCase());
    const generic = () => fail(401, 'Email or password is incorrect.');
    if (!row) {
      await verifyPassword(String(password ?? ''), DUMMY_HASH);
      generic();
    }
    if (row.locked_until && row.locked_until > new Date().toISOString()) fail(429, 'Too many failed sign-in attempts. Try again in 15 minutes.');
    const ok = await verifyPassword(String(password ?? ''), row.password_hash);
    if (!ok) {
      const failed = row.failed_logins + 1;
      db.prepare('UPDATE users SET failed_logins = ?, locked_until = ? WHERE id = ?').run(
        failed >= LOCK_AFTER_FAILED ? 0 : failed, failed >= LOCK_AFTER_FAILED ? new Date(Date.now() + LOCK_MS).toISOString() : null, row.id,
      );
      generic();
    }
    db.prepare('UPDATE users SET failed_logins = 0, locked_until = NULL WHERE id = ?').run(row.id);
    res.setHeader('Set-Cookie', startSession(row.id));
    return { account: toAccountView(rowToAccount(row)) };
  });

  route('POST', /^\/api\/auth\/signout$/, (req, res) => {
    checkCsrf(req);
    const token = cookies(req)[SESSION_COOKIE];
    if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
    res.setHeader('Set-Cookie', sessionCookie('', 0));
    return { status: 204 };
  });

  // ----- seller application -----
  route('GET', /^\/api\/application$/, (req) => service.view(requireUser(req).acc));

  route('PUT', /^\/api\/application$/, async (req) => {
    checkCsrf(req);
    const { acc } = requireUser(req);
    const body = await readJson(req);
    const validate = body.validateStep === null || body.validateStep === undefined ? null : Number(body.validateStep);
    if (validate !== null && !(validate >= 1 && validate <= 8)) fail(422, 'Invalid step.');
    return service.saveDraft(acc, body.data, Number(body.nextStep), validate);
  });

  route('PUT', /^\/api\/application\/bank$/, async (req) => {
    checkCsrf(req);
    const { acc } = requireUser(req);
    const b = await readJson(req);
    return service.saveBank(acc, { holderName: String(b.holderName ?? ''), accountNumber: String(b.accountNumber ?? ''), accountNumberConfirm: String(b.accountNumberConfirm ?? ''), ifsc: String(b.ifsc ?? ''), bankName: String(b.bankName ?? '') });
  });

  route('POST', /^\/api\/application\/documents$/, async (req, _res, url) => {
    checkCsrf(req);
    const { acc } = requireUser(req);
    const kind = url.searchParams.get('kind') ?? '';
    const fileName = (url.searchParams.get('name') ?? 'document').slice(0, 200);
    const declared = Number(req.headers['content-length'] ?? 0);
    const limit = kind === 'logo' ? 2 * 1024 * 1024 : 5 * 1024 * 1024;
    if (declared > limit) fail(413, `Files must be ${limit / 1048576} MB or smaller.`, { file: `Files must be ${limit / 1048576} MB or smaller.` });
    const bytes = await readBody(req, limit);
    const cert = {};
    for (const k of ['certBody', 'certNumber', 'certIssueDate', 'certExpiryDate']) if (url.searchParams.has(k)) cert[k] = url.searchParams.get(k);
    const meta = { kind, fileName, sizeBytes: bytes.length, sniffedMime: sniffMime(bytes.subarray(0, 8)), ...(Object.keys(cert).length ? { cert } : {}) };
    const { documentId } = service.checkUpload(acc, meta);
    await mkdir(uploadsDir, { recursive: true, mode: 0o700 });
    const target = join(uploadsDir, documentId);
    const tmp = `${target}.part`;
    await writeFile(tmp, bytes, { mode: 0o600 });
    await rename(tmp, target);
    store.pendingSha.set(documentId, createHash('sha256').update(bytes).digest('hex'));
    try {
      return { status: 201, body: service.recordUpload(acc, meta, documentId) };
    } catch (e) {
      store.pendingSha.delete(documentId);
      await unlink(target).catch(() => {});
      throw e;
    }
  });

  route('POST', /^\/api\/application\/submit$/, async (req) => {
    checkCsrf(req);
    const { acc } = requireUser(req);
    const { idempotencyKey } = await readJson(req);
    return service.submit(acc, String(idempotencyKey ?? ''));
  });

  async function sendFile(res, doc) {
    const path = join(uploadsDir, doc.id);
    const data = await readFile(path).catch(() => null);
    if (!data) fail(404, 'File not found.');
    const safeName = doc.fileName.replace(/[^\w.\- ]/g, '_');
    res.writeHead(200, {
      'Content-Type': doc.mimeType,
      'Content-Length': data.length,
      'Content-Disposition': `inline; filename="${safeName}"`,
      'Cache-Control': 'private, no-store',
      'Content-Security-Policy': "sandbox; default-src 'none'; img-src 'self'; style-src 'unsafe-inline'",
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(data);
    return null;
  }

  route('GET', /^\/api\/documents\/([\w-]+)\/file$/, async (req, res, _url, [id]) => {
    const { acc } = requireUser(req);
    const app = store.getApplicationByUser(acc.userId);
    const doc = store.getDocument(id);
    // Same response for "missing" and "not yours", so other sellers' file IDs aren't revealed.
    if (!doc || !app || doc.applicationId !== app.id) fail(404, 'File not found.');
    return sendFile(res, doc);
  });

  // ----- business rules (catalogue, orders, earnings, …) -----
  route('POST', /^\/api\/rpc\/(\w+)$/, async (req, _res, _url, [name]) => {
    checkCsrf(req);
    const { acc, row } = requireUser(req);
    const write = Object.hasOwn(RPC_METHODS, name) ? RPC_METHODS[name] : config.demoTools && Object.hasOwn(DEMO_RPC_METHODS, name) ? DEMO_RPC_METHODS[name] : undefined;
    if (write === undefined) fail(404, 'Unknown operation.');
    const body = await readJson(req);
    if (body.args !== undefined && (!Array.isArray(body.args) || body.args.length > 6)) fail(400, 'Invalid request.');
    const args = body.args ?? [];
    const run = async () => {
      core._internal.setSession(acc.sellerId, row.full_name.split(' ').map((p, i) => (i ? `${p[0]}.` : p)).join(' '));
      try {
        return await core[name](...args);
      } catch (e) {
        if (e instanceof ApiError) throw e;
        // Malformed arguments from the network must not surface as server errors.
        log(`[rpc] ${name} rejected malformed input: ${e?.message ?? e}`);
        throw new ApiError(400, 'Invalid request.');
      }
    };
    return write ? store.transactionAsync(run) : run();
  });

  // ----- Super Admin review API (consumed by the Super Admin Portal) -----
  const adminSummary = (a) => {
    const u = userRowById(a.userId);
    return { id: a.id, referenceId: a.referenceId, status: a.status, shopName: a.data.shopName, ownerName: a.data.ownerName, email: u?.email, submittedAt: a.submittedAt, lastSubmittedAt: a.lastSubmittedAt, updatedAt: a.updatedAt };
  };

  route('GET', /^\/api\/admin\/applications$/, (req, _res, url) => {
    requireAdmin(req);
    const status = url.searchParams.get('status');
    const rows = status ? db.prepare('SELECT id FROM seller_applications WHERE status = ? ORDER BY updated_at DESC').all(status) : db.prepare('SELECT id FROM seller_applications ORDER BY updated_at DESC').all();
    return { applications: rows.map((r) => adminSummary(store.getApplicationById(r.id))) };
  });

  route('GET', /^\/api\/admin\/applications\/([\w-]+)$/, (req, _res, _url, [id]) => {
    requireAdmin(req);
    const app = store.getApplicationById(id);
    if (!app) fail(404, 'Application not found.');
    const u = userRowById(app.userId);
    return {
      ...buildView(app, store.listDocuments(app.id), store.getBank(app.id), store.getOrganic(app.id)),
      id: app.id,
      account: { email: u.email, phone: u.phone, fullName: u.full_name, emailVerified: !!u.email_verified_at, phoneVerified: !!u.phone_verified_at },
      audit: db.prepare('SELECT at, actor_type AS actorType, actor_id AS actorId, action, details_json AS details FROM audit_log WHERE application_id = ? ORDER BY id DESC LIMIT 100').all(app.id),
    };
  });

  route('GET', /^\/api\/admin\/applications\/([\w-]+)\/bank$/, (req, _res, _url, [id]) => {
    const reviewer = requireAdmin(req);
    const app = store.getApplicationById(id);
    if (!app) fail(404, 'Application not found.');
    const accountNumber = store.revealBankAccount(id);
    if (!accountNumber) fail(404, 'No bank account on file.');
    store.audit({ actorType: 'admin', actorId: reviewer, action: 'bank.revealed', applicationId: id });
    return { ...store.getBank(id), accountNumber };
  });

  route('POST', /^\/api\/admin\/applications\/([\w-]+)\/decision$/, async (req, _res, _url, [id]) => {
    const reviewer = requireAdmin(req);
    const b = await readJson(req);
    const app = service.adminDecide(id, String(b.action), reviewer, String(b.message ?? ''), Array.isArray(b.requestedItems) ? b.requestedItems : []);
    return adminSummary(app);
  });

  route('POST', /^\/api\/admin\/documents\/([\w-]+)\/review$/, async (req, _res, _url, [id]) => {
    const reviewer = requireAdmin(req);
    const b = await readJson(req);
    const doc = service.adminReviewDocument(id, b.decision, reviewer, String(b.note ?? ''));
    return { id: doc.id, kind: doc.kind, label: DOC_KIND_LABEL[doc.kind], status: doc.status };
  });

  route('GET', /^\/api\/admin\/documents\/([\w-]+)\/file$/, async (req, res, _url, [id]) => {
    const reviewer = requireAdmin(req);
    const doc = store.getDocument(id);
    if (!doc) fail(404, 'File not found.');
    store.audit({ actorType: 'admin', actorId: reviewer, action: 'document.viewed', applicationId: doc.applicationId, details: { documentId: id } });
    return sendFile(res, doc);
  });

  // ---------- static files ----------
  const rootDir = resolve(config.rootDir);
  let indexHtml = null;
  async function serveStatic(req, res, pathname) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return false;
    if (pathname === '/' || pathname === '/index.html') {
      indexHtml ??= (await readFile(join(rootDir, 'index.html'), 'utf8')).replace(
        '<meta name="robots"',
        `<meta name="seller-api" content="server" />${config.demoTools ? '<meta name="seller-demo-tools" content="on" />' : ''}\n    <meta name="robots"`,
      );
      res.writeHead(200, { 'Content-Type': STATIC_TYPES['.html'], 'Cache-Control': 'no-cache' });
      res.end(req.method === 'HEAD' ? undefined : indexHtml);
      return true;
    }
    const rel = normalize(decodeURIComponent(pathname)).replace(/^[/\\]+/, '');
    if (rel.includes('..') || rel.includes('\0')) return false;
    if (!STATIC_FILES.includes(rel) && !STATIC_ROOTS.some((r) => rel.startsWith(r))) return false;
    const type = STATIC_TYPES[extname(rel)];
    if (!type) return false;
    const full = join(rootDir, rel);
    if (!full.startsWith(rootDir)) return false;
    const st = await stat(full).catch(() => null);
    if (!st?.isFile()) return false;
    res.writeHead(200, { 'Content-Type': type, 'Content-Length': st.size, 'Cache-Control': 'no-cache' });
    res.end(req.method === 'HEAD' ? undefined : await readFile(full));
    return true;
  }

  // ---------- dispatcher ----------
  async function handle(req, res) {
    const started = Date.now();
    const url = new URL(req.url ?? '/', 'http://localhost');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'",
    );
    if (config.cookieSecure) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    try {
      if (url.pathname.startsWith('/api/')) {
        const r = routes.find((x) => x.method === req.method && x.pattern.test(url.pathname));
        if (!r) fail(404, 'Not found.');
        const params = r.pattern.exec(url.pathname).slice(1);
        const out = await r.handler(req, res, url, params);
        if (out === null) return; // handler streamed its own response
        if (out && typeof out === 'object' && 'status' in out && Object.keys(out).every((k) => k === 'status' || k === 'body')) send(res, out.status, out.status === 204 ? undefined : out.body);
        else send(res, 200, out);
      } else if (!(await serveStatic(req, res, url.pathname))) {
        send(res, 404, { error: { message: 'Not found.' } });
      }
    } catch (e) {
      if (res.headersSent) return res.end();
      if (e instanceof ApiError) send(res, e.status, { error: { message: e.message, ...(Object.keys(e.fieldErrors).length ? { fieldErrors: e.fieldErrors } : {}) } });
      else {
        log(`[error] ${req.method} ${url.pathname}: ${e?.stack ?? e}`);
        send(res, 500, { error: { message: 'Something went wrong on our side. Please try again.' } });
      }
    } finally {
      // Paths only: never query strings, bodies, cookies or headers.
      log(`${new Date().toISOString()} ${req.method} ${url.pathname} ${res.statusCode} ${Date.now() - started}ms`);
    }
  }

  return { handle, db, store, service, close: () => db.close() };
}
