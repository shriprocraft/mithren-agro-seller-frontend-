// Integration tests for the Node backend: registration, verification, KYC,
// submission, review workflow and authorisation (scope §3.1–3.2).
// Runs a real HTTP server on an ephemeral port with a temporary data directory.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { createApp } from '../server/app.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ADMIN_TOKEN = 'test-admin-token-' + randomBytes(16).toString('hex');
const codes = [];
let dataDir, server, base, app;

before(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'seller-portal-test-'));
  app = createApp({
    rootDir: root,
    dataDir,
    encryptionKey: randomBytes(32),
    cookieSecure: false,
    adminTokens: new Map([[ADMIN_TOKEN, 'Test Reviewer']]),
    deliverCode: (m) => codes.push(m),
    rateLimits: { signup: 1000, signin: 1000 },
    log: (l) => l.startsWith('[error]') && console.error(l),
  });
  server = createServer((req, res) => void app.handle(req, res));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server.close();
  app.close();
  rmSync(dataDir, { recursive: true, force: true });
});

// ---------- helpers ----------
function client() {
  let cookie = '';
  const call = async (method, path, body, opts = {}) => {
    const headers = { 'X-Requested-With': 'seller-portal', ...(opts.headers ?? {}) };
    if (cookie) headers.cookie = cookie;
    let payload;
    if (opts.raw) {
      payload = opts.raw;
      headers['Content-Type'] = opts.type ?? 'application/octet-stream';
    } else if (body !== undefined) {
      payload = JSON.stringify(body);
      headers['Content-Type'] = 'application/json';
    }
    const res = await fetch(base + path, { method, headers, body: payload });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0].endsWith('=') ? '' : set.split(';')[0];
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = text;
    }
    return { status: res.status, json, text, headers: res.headers };
  };
  return { call, rpc: (name, ...args) => call('POST', `/api/rpc/${name}`, { args }), get cookie() { return cookie; }, set cookie(v) { cookie = v; } };
}

const admin = (method, path, body) =>
  fetch(base + path, { method, headers: { Authorization: `Bearer ${ADMIN_TOKEN}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));

const appIdFor = (email) => app.db.prepare('SELECT a.id FROM seller_applications a JOIN users u ON u.id = a.user_id WHERE u.email = ?').get(email).id;

const PDF = Buffer.from('%PDF-1.4\n%test document\n');
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
let phoneSeq = 0;

async function registerVerified(c, overrides = {}) {
  const n = ++phoneSeq;
  const email = overrides.email ?? `seller${n}-${randomBytes(3).toString('hex')}@farm.example`;
  const phone = overrides.phone ?? `98765${String(10000 + n).slice(-5)}`;
  const r = await c.call('POST', '/api/auth/signup', { fullName: 'Meera Joshi', email, phone, password: 'harvest2026x' });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  for (const ch of ['email', 'phone']) {
    const code = codes.filter((x) => x.channel === ch && (ch === 'email' ? x.to === email : x.to.endsWith(phone.slice(-10)))).at(-1).code;
    const v = await c.call('POST', '/api/auth/verify', { channel: ch, code });
    assert.equal(v.status, 200, JSON.stringify(v.json));
  }
  return { email, phone, password: 'harvest2026x' };
}

const goodData = {
  shopName: 'Joshi Family Farm', ownerName: 'Meera Joshi', contactName: '', businessEmail: 'hello@joshifarm.example',
  primaryPhone: '9876500001', altPhone: '', description: 'Small family farm growing leafy greens and herbs near Lonavala.',
  addressLine1: 'Gat 12, Old Highway', addressLine2: '', country: 'India', state: 'Maharashtra', district: 'Pune', city: 'Lonavala', pincode: '410401',
  serviceAreas: ['Lonavala', '410401'], productTypes: ['Leafy Greens', 'Herbs'], pickupSameAsBusiness: true, pickupAddress: '', pickupPincode: '',
  businessType: 'individual_farmer', gstStatus: 'exempt', gstin: '', pan: '', registrationNumber: '', claimsOrganic: false,
  certBody: '', certNumber: '', certIssueDate: '', certExpiryDate: '',
};

async function completeApplication(c, data = goodData) {
  for (let s = 2; s <= 4; s++) assert.equal((await c.call('PUT', '/api/application', { data, nextStep: s + 1, validateStep: s })).status, 200);
  assert.equal((await c.call('POST', '/api/application/documents?kind=address_proof&name=bill.pdf', undefined, { raw: PDF, type: 'application/pdf' })).status, 201);
  if (data.pan) assert.equal((await c.call('POST', '/api/application/documents?kind=pan&name=pan.pdf', undefined, { raw: PDF, type: 'application/pdf' })).status, 201);
  if (data.gstStatus === 'registered') assert.equal((await c.call('POST', '/api/application/documents?kind=gst&name=gst.pdf', undefined, { raw: PDF, type: 'application/pdf' })).status, 201);
  assert.equal((await c.call('PUT', '/api/application', { data, nextStep: 6, validateStep: 5 })).status, 200);
  assert.equal((await c.call('PUT', '/api/application/bank', { holderName: 'Meera Joshi', accountNumber: '123456789012', accountNumberConfirm: '123456789012', ifsc: 'SBIN0001234', bankName: 'SBI' })).status, 200);
  assert.equal((await c.call('POST', '/api/application/documents?kind=bank_proof&name=cheque.png', undefined, { raw: PNG, type: 'image/png' })).status, 201);
  assert.equal((await c.call('PUT', '/api/application', { data, nextStep: 7, validateStep: 6 })).status, 200);
  if (data.claimsOrganic) assert.equal((await c.call('POST', '/api/application/documents?kind=organic_cert&name=cert.pdf', undefined, { raw: PDF, type: 'application/pdf' })).status, 201);
  const r = await c.call('PUT', '/api/application', { data, nextStep: 8, validateStep: 7 });
  assert.equal(r.status, 200, JSON.stringify(r.json));
}

// ---------- 1. registration & verification ----------
test('seller can register, verify email and phone, sign out and sign back in', async () => {
  const c = client();
  const creds = await registerVerified(c);
  let me = await c.call('GET', '/api/auth/me');
  assert.equal(me.json.account.emailVerified, true);
  assert.equal(me.json.account.phoneVerified, true);
  assert.ok(!JSON.stringify(me.json).includes(creds.phone.slice(-10, -4)), 'phone is masked');
  assert.match(c.cookie, /^msp_session=/);
  assert.equal((await c.call('POST', '/api/auth/signout')).status, 204);
  me = await c.call('GET', '/api/auth/me');
  assert.equal(me.json.account, null);
  assert.equal((await c.call('GET', '/api/application')).status, 401);
  const bad = await c.call('POST', '/api/auth/signin', { email: creds.email, password: 'wrong-password1' });
  assert.equal(bad.status, 401);
  const ok = await c.call('POST', '/api/auth/signin', { email: creds.email.toUpperCase(), password: creds.password });
  assert.equal(ok.status, 200);
  assert.equal((await c.call('GET', '/api/application')).json.status, 'incomplete');
});

test('session cookie is HttpOnly and SameSite=Strict; passwords are hashed', async () => {
  const c = client();
  const r = await c.call('POST', '/api/auth/signup', { fullName: 'Cookie Test', email: 'cookie@farm.example', phone: '9811100001', password: 'harvest2026x' });
  const set = r.headers.get('set-cookie');
  assert.match(set, /HttpOnly/);
  assert.match(set, /SameSite=Strict/);
  const row = app.db.prepare('SELECT password_hash FROM users WHERE email = ?').get('cookie@farm.example');
  assert.match(row.password_hash, /^scrypt\$/);
  assert.ok(!row.password_hash.includes('harvest2026x'));
});

test('duplicate accounts are rejected (email case-insensitive, phone normalised)', async () => {
  const c = client();
  await c.call('POST', '/api/auth/signup', { fullName: 'Dup One', email: 'dup@farm.example', phone: '9822200001', password: 'harvest2026x' });
  const byEmail = await client().call('POST', '/api/auth/signup', { fullName: 'Dup Two', email: 'DUP@farm.example', phone: '9822200002', password: 'harvest2026x' });
  assert.equal(byEmail.status, 409);
  assert.ok(byEmail.json.error.fieldErrors.email);
  const byPhone = await client().call('POST', '/api/auth/signup', { fullName: 'Dup Three', email: 'dup3@farm.example', phone: '+91 98222 00001', password: 'harvest2026x' });
  assert.equal(byPhone.status, 409);
  assert.ok(byPhone.json.error.fieldErrors.phone);
});

test('signup validates input on the server', async () => {
  const r = await client().call('POST', '/api/auth/signup', { fullName: 'X', email: 'not-an-email', phone: '12345', password: 'short' });
  assert.equal(r.status, 422);
  assert.deepEqual(Object.keys(r.json.error.fieldErrors).sort(), ['email', 'fullName', 'password', 'phone']);
});

test('verification codes: wrong code counts attempts, then locks; codes are stored hashed', async () => {
  const c = client();
  await c.call('POST', '/api/auth/signup', { fullName: 'Otp Test', email: 'otp@farm.example', phone: '9833300001', password: 'harvest2026x' });
  const real = codes.filter((x) => x.to === 'otp@farm.example').at(-1).code;
  const stored = app.db.prepare("SELECT code_hash FROM verification_codes WHERE channel = 'email'").all().map((r) => r.code_hash);
  assert.ok(!stored.includes(real));
  const wrong = real === '000000' ? '111111' : '000000';
  for (let i = 0; i < 5; i++) assert.equal((await c.call('POST', '/api/auth/verify', { channel: 'email', code: wrong })).status, 422);
  assert.equal((await c.call('POST', '/api/auth/verify', { channel: 'email', code: real })).status, 429, 'locked after 5 wrong attempts');
  assert.equal((await c.call('POST', '/api/auth/send-code', { channel: 'email' })).status, 429, 'resend cooldown');
});

test('application steps cannot advance before account verification', async () => {
  const c = client();
  await c.call('POST', '/api/auth/signup', { fullName: 'Unverified', email: 'unver@farm.example', phone: '9844400001', password: 'harvest2026x' });
  const r = await c.call('PUT', '/api/application', { data: goodData, nextStep: 2, validateStep: 1 });
  assert.equal(r.status, 422);
  assert.ok(r.json.error.fieldErrors.emailCode && r.json.error.fieldErrors.phoneCode);
});

// ---------- 2. validation ----------
test('required and conditional tax fields validate on the server', async () => {
  const c = client();
  await registerVerified(c);
  const v = (data, step) => c.call('PUT', '/api/application', { data: { ...goodData, ...data }, nextStep: step + 1, validateStep: step });
  assert.equal((await v({ shopName: 'A', businessEmail: 'x' }, 2)).json.error.fieldErrors.shopName !== undefined, true);
  assert.equal((await v({ pincode: '012345' }, 3)).status, 422);
  // Individual farmer, GST exempt: no PAN or GSTIN required.
  let r = await v({}, 5);
  assert.equal(r.status, 422);
  assert.deepEqual(Object.keys(r.json.error.fieldErrors), ['doc_address_proof'], 'only the address proof is missing');
  // Company: PAN and CIN required.
  r = await v({ businessType: 'private_limited' }, 5);
  assert.ok(r.json.error.fieldErrors.pan && r.json.error.fieldErrors.registrationNumber);
  // GST registered: GSTIN required and must embed the PAN.
  r = await v({ gstStatus: 'registered', pan: 'ABCDE1234F', gstin: '27ZZZZZ9999Z1Z5' }, 5);
  assert.match(r.json.error.fieldErrors.gstin, /match the PAN/);
  // Organic claim needs a certificate; expired dates are rejected.
  r = await v({ claimsOrganic: true, certBody: 'Body', certExpiryDate: '2020-01-01' }, 7);
  assert.ok(r.json.error.fieldErrors.certExpiryDate && r.json.error.fieldErrors.doc_organic_cert);
  // Saving a draft without validation is allowed and preserved.
  r = await c.call('PUT', '/api/application', { data: { ...goodData, shopName: 'Draft Name' }, nextStep: 3, validateStep: null });
  assert.equal(r.json.data.shopName, 'Draft Name');
  assert.equal(r.json.currentStep, 3);
  r = await c.call('PUT', '/api/application', { data: { ...goodData, shopName: 'Draft Name' }, nextStep: 2, validateStep: null });
  assert.equal(r.json.currentStep, 3, 'going back keeps the furthest step reached');
});

test('uploads are checked by content, size and status', async () => {
  const c = client();
  await registerVerified(c);
  const up = (kind, raw, type = 'application/pdf') => c.call('POST', `/api/application/documents?kind=${kind}&name=f`, undefined, { raw, type });
  assert.equal((await up('pan', Buffer.from('MZ fake exe'), 'application/pdf')).status, 415, 'MIME is sniffed, not trusted');
  assert.equal((await up('pan', Buffer.alloc(5 * 1024 * 1024 + 10, 0x25))).status, 413);
  assert.equal((await up('logo', PDF)).status, 415, 'logos must be images');
  assert.equal((await up('logo', PNG, 'image/png')).status, 201);
  assert.equal((await up('nonsense', PDF)).status, 422);
  const files = readdirSync(join(dataDir, 'uploads'));
  assert.ok(files.length >= 1 && files.every((f) => !f.includes('.')), 'stored under random IDs without extensions');
});

// ---------- 3. persistence, submission, status ----------
test('application, documents and reference ID persist; duplicate submissions are prevented', async () => {
  const c = client();
  const creds = await registerVerified(c);
  // Submitting an incomplete application fails and points to the first incomplete step.
  const early = await c.call('POST', '/api/application/submit', { idempotencyKey: 'early-key-123' });
  assert.equal(early.status, 422);
  assert.equal(early.json.error.fieldErrors._step, '2');
  await completeApplication(c);
  const key = 'submit-' + randomBytes(6).toString('hex');
  const first = await c.call('POST', '/api/application/submit', { idempotencyKey: key });
  assert.equal(first.status, 200, JSON.stringify(first.json));
  assert.equal(first.json.status, 'pending');
  assert.match(first.json.referenceId, /^MA-\d{4}-\d{6}$/);
  assert.ok(first.json.submittedAt);
  const retry = await c.call('POST', '/api/application/submit', { idempotencyKey: key });
  assert.equal(retry.status, 200);
  assert.equal(retry.json.referenceId, first.json.referenceId, 'same key returns the same result');
  const dup = await c.call('POST', '/api/application/submit', { idempotencyKey: 'another-key-456' });
  assert.equal(dup.status, 409);
  // Sign out and back in: the real status is still there.
  await c.call('POST', '/api/auth/signout');
  await c.call('POST', '/api/auth/signin', { email: creds.email, password: creds.password });
  const again = await c.call('GET', '/api/application');
  assert.equal(again.json.status, 'pending');
  assert.equal(again.json.referenceId, first.json.referenceId);
  assert.ok(again.json.documents.length >= 2);
  assert.ok(again.json.documents.every((d) => d.status === 'unverified'));
  // Locked while pending.
  assert.equal((await c.call('PUT', '/api/application', { data: goodData, nextStep: 2, validateStep: null })).status, 409);
});

// ---------- 4. permissions ----------
test('sellers cannot change their own status, approve themselves, or reach internal functions', async () => {
  const c = client();
  await registerVerified(c);
  await completeApplication(c);
  await c.call('POST', '/api/application/submit', { idempotencyKey: 'self-approve-key' });
  // Status fields in the draft payload are ignored (and drafts are locked when pending anyway).
  const sneaky = await c.call('PUT', '/api/application', { data: { ...goodData, status: 'approved' }, nextStep: 8, validateStep: null });
  assert.equal(sneaky.status, 409);
  for (const name of ['_demoSetSellerStatus', 'resetDemoData', 'clearAllData', '_setSessionForTesting', '_internal', 'constructor', '__proto__']) {
    assert.equal((await c.rpc(name, 'approved')).status, 404, name);
  }
  assert.equal((await c.call('POST', '/api/admin/applications/x/decision', { action: 'approve' })).status, 401, 'admin API needs an admin token');
  assert.equal((await c.call('GET', '/api/application')).json.status, 'pending');
});

test('pending sellers cannot publish products; approval enables it; suspension blocks it; reinstatement restores it', async () => {
  const c = client();
  const { email } = await registerVerified(c);
  await completeApplication(c);
  const appId = appIdFor(email);
  await c.call('POST', '/api/application/submit', { idempotencyKey: 'publish-flow-key' });
  const product = {
    name: 'Fresh Coriander', slug: 'fresh-coriander', description: 'Fragrant coriander bunches with roots on, harvested daily.', category: 'Herbs', emoji: '🌿',
    variants: [{ id: 'v1', label: '1 bunch', sku: 'JF-COR-1B', packSize: 1, unit: 'bunch', price: 25, stock: 10 }],
    origin: 'Lonavala', seasonality: 'year_round', seasonMonths: [], storage: 'Refrigerate.', organicClaim: 'none', available: true, minQty: 1, maxQty: 10, lowStockThreshold: 3,
  };
  let r = await c.rpc('saveProduct', product, true);
  assert.equal(r.status, 403, 'pending seller cannot submit a listing for sale');
  r = await c.rpc('saveProduct', product, false);
  assert.equal(r.status, 200, 'drafts are allowed');
  const draftId = r.json.id;
  // Super Admin approves via the admin API.
  assert.equal((await admin('POST', `/api/admin/applications/${appId}/decision`, { action: 'approve', message: '' })).status, 200);
  r = await c.rpc('saveProduct', { ...product, id: draftId }, true);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.status, 'pending', 'listing goes to moderation');
  // Suspend: restricted operations are blocked.
  assert.equal((await admin('POST', `/api/admin/applications/${appId}/decision`, { action: 'suspend', message: 'Repeated late deliveries.' })).status, 200);
  assert.equal((await c.rpc('saveProduct', { ...product, id: draftId }, true)).status, 403);
  assert.equal((await c.rpc('adjustStock', draftId, 'v1', 5, 'restock', '')).status, 403);
  const status = await c.call('GET', '/api/application');
  assert.equal(status.json.status, 'suspended');
  assert.equal(status.json.reviewerMessage, 'Repeated late deliveries.');
  // Data is preserved while suspended.
  assert.equal((await c.rpc('getProduct', draftId)).status, 200);
  // Reinstate: back to approved.
  assert.equal((await admin('POST', `/api/admin/applications/${appId}/decision`, { action: 'reinstate', message: '' })).status, 200);
  assert.equal((await c.call('GET', '/api/application')).json.status, 'approved');
  assert.equal((await c.rpc('adjustStock', draftId, 'v1', 5, 'restock', '')).status, 200);
});

test('changes requested by a reviewer reach the seller, who can update and resubmit', async () => {
  const c = client();
  const { email } = await registerVerified(c);
  await completeApplication(c);
  await c.call('POST', '/api/application/submit', { idempotencyKey: 'changes-flow-key' });
  const appId = appIdFor(email);
  const listed = await admin('GET', '/api/admin/applications?status=pending');
  assert.ok(listed.json.applications.some((a) => a.id === appId));
  const bad = await admin('POST', `/api/admin/applications/${appId}/decision`, { action: 'request_changes', message: '' });
  assert.equal(bad.status, 422, 'a message is required');
  const ok = await admin('POST', `/api/admin/applications/${appId}/decision`, { action: 'request_changes', message: 'Your address proof is cropped.', requestedItems: ['Upload a full copy of the address proof'], reviewer: 'Someone Else' });
  assert.equal(ok.status, 200);
  // The decision is attributed to the configured reviewer, never to a name in the request.
  const detail = await admin('GET', `/api/admin/applications/${appId}`);
  assert.ok(detail.json.audit.some((a) => a.action === 'application.request_changes' && a.actorId === 'Test Reviewer'));
  assert.ok(!JSON.stringify(detail.json).includes('123456789012'), 'admin detail shows masked bank details only');
  const mine = await c.call('GET', '/api/application');
  assert.equal(mine.json.status, 'changes_requested');
  assert.equal(mine.json.reviewerMessage, 'Your address proof is cropped.');
  assert.deepEqual(mine.json.requestedItems, ['Upload a full copy of the address proof']);
  assert.equal(mine.json.editable, true);
  assert.equal((await c.call('POST', '/api/application/documents?kind=address_proof&name=full.pdf', undefined, { raw: PDF, type: 'application/pdf' })).status, 201);
  const re = await c.call('POST', '/api/application/submit', { idempotencyKey: 'resubmit-key-789' });
  assert.equal(re.status, 200);
  assert.equal(re.json.status, 'pending');
  assert.equal(re.json.referenceId, mine.json.referenceId, 'reference ID is kept on resubmission');
  assert.ok(re.json.lastSubmittedAt > re.json.submittedAt);
  // Invalid transitions are refused by the server.
  assert.equal((await admin('POST', `/api/admin/applications/${appId}/decision`, { action: 'reinstate', message: '' })).status, 409);
  assert.equal((await admin('POST', `/api/admin/applications/${appId}/decision`, { action: 'self-approve', message: '' })).status, 422);
});

test('organic certificate stays unverified until an authorised reviewer verifies it', async () => {
  const c = client();
  const { email } = await registerVerified(c);
  await completeApplication(c, { ...goodData, claimsOrganic: true, certBody: 'Demo Certification Body', certNumber: 'NPOP/123' });
  let v = await c.call('GET', '/api/application');
  assert.equal(v.json.organic.status, 'submitted');
  const certDoc = v.json.documents.find((d) => d.kind === 'organic_cert');
  assert.equal(certDoc.status, 'unverified');
  await c.call('POST', '/api/application/submit', { idempotencyKey: 'organic-flow-key' });
  const appId = appIdFor(email);
  await admin('POST', `/api/admin/applications/${appId}/decision`, { action: 'approve', message: '' });
  v = await c.call('GET', '/api/application');
  assert.equal(v.json.organic.status, 'submitted', 'approving the seller does not verify the certificate');
  const docs = await c.rpc('listDocuments');
  assert.equal(docs.json.find((d) => d.id === certDoc.id).status, 'pending', 'workspace shows it as not verified');
  assert.equal((await admin('POST', `/api/admin/documents/${certDoc.id}/review`, { decision: 'verified', note: '' })).status, 200);
  v = await c.call('GET', '/api/application');
  assert.equal(v.json.organic.status, 'verified');
});

// ---------- 5. privacy ----------
test('bank details are encrypted at rest, masked in every seller response and never logged', async () => {
  const c = client();
  const { email } = await registerVerified(c);
  await completeApplication(c);
  const v = await c.call('GET', '/api/application');
  assert.equal(v.json.bank.last4, '9012');
  assert.ok(!JSON.stringify(v.json).includes('123456789012'));
  const seller = await c.rpc('getSeller');
  assert.ok(!JSON.stringify(seller.json).includes('123456789012'));
  const raw = new DatabaseSync(join(dataDir, 'seller-portal.sqlite'));
  const rows = raw.prepare('SELECT account_number_enc FROM bank_accounts').all();
  raw.close();
  assert.ok(rows.length && rows.every((r) => !r.account_number_enc.includes('123456789012')));
  const dbBytes = readFileSync(join(dataDir, 'seller-portal.sqlite'));
  assert.ok(!dbBytes.includes(Buffer.from('123456789012')), 'plaintext account number never written to the database file');
  // Admin can reveal it for payouts, and that access is audited.
  const appId = appIdFor(email);
  const reveal = await admin('GET', `/api/admin/applications/${appId}/bank`);
  assert.equal(reveal.json.accountNumber, '123456789012');
  assert.ok(app.db.prepare("SELECT 1 FROM audit_log WHERE action = 'bank.revealed' AND application_id = ?").get(appId));
  assert.ok(!JSON.stringify(app.db.prepare('SELECT details_json FROM audit_log').all()).includes('123456789012'), 'audit log never holds the account number');
});

test('sellers cannot read each other’s documents or business records', async () => {
  const a = client();
  const b = client();
  await registerVerified(a);
  await registerVerified(b);
  const up = await a.call('POST', '/api/application/documents?kind=address_proof&name=a.pdf', undefined, { raw: PDF, type: 'application/pdf' });
  const docId = up.json.documents.find((d) => d.kind === 'address_proof').id;
  const own = await a.call('GET', `/api/documents/${docId}/file`);
  assert.equal(own.status, 200);
  assert.equal(own.headers.get('x-content-type-options'), 'nosniff');
  assert.equal((await b.call('GET', `/api/documents/${docId}/file`)).status, 404);
  const prod = await a.rpc('saveProduct', { name: 'Okra', slug: 'okra', description: '', category: 'Vegetables', emoji: '🫛', variants: [{ id: 'v1', label: '250 g', sku: 'AA-OKR-250', packSize: 250, unit: 'g', price: 40, stock: 5 }], origin: '', seasonality: 'year_round', seasonMonths: [], storage: '', organicClaim: 'none', available: true, minQty: 1, maxQty: 5, lowStockThreshold: 2 }, false);
  assert.equal(prod.status, 200);
  assert.equal((await b.rpc('getProduct', prod.json.id)).status, 404);
  assert.equal((await b.rpc('listProducts')).json.length, 0);
});

test('malformed business-API input is rejected cleanly, never as a server error', async () => {
  const c = client();
  await registerVerified(c);
  for (const args of [[null, null, null, null, null], [{ $where: 1 }], 'not-an-array', Array(10).fill(1)]) {
    const r = await c.call('POST', '/api/rpc/adjustStock', { args });
    assert.ok([400, 403, 404, 422].includes(r.status), `args ${JSON.stringify(args)} -> ${r.status}`);
  }
});

test('cookie-authenticated writes require the CSRF header and same origin', async () => {
  const c = client();
  await registerVerified(c);
  const noHeader = await fetch(base + '/api/application', { method: 'PUT', headers: { cookie: c.cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ data: goodData, nextStep: 2, validateStep: null }) });
  assert.equal(noHeader.status, 403);
  const crossOrigin = await fetch(base + '/api/application', { method: 'PUT', headers: { cookie: c.cookie, 'Content-Type': 'application/json', 'X-Requested-With': 'seller-portal', Origin: 'https://evil.example' }, body: JSON.stringify({ data: goodData, nextStep: 2, validateStep: null }) });
  assert.equal(crossOrigin.status, 403);
});

test('per-IP signup rate limit applies', async () => {
  const limited = createApp({ rootDir: root, dataDir: mkdtempSync(join(tmpdir(), 'seller-portal-rl-')), encryptionKey: randomBytes(32), cookieSecure: false, adminTokens: new Map(), deliverCode: () => {}, rateLimits: { signup: 2 }, log: () => {} });
  const srv = createServer((req, res) => void limited.handle(req, res));
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${srv.address().port}/api/auth/signup`;
  const statuses = [];
  for (let i = 0; i < 3; i++) {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'seller-portal' }, body: JSON.stringify({ fullName: 'Rate Limit', email: `rl${i}@farm.example`, phone: `990000000${i}`, password: 'harvest2026x' }) });
    statuses.push(r.status);
  }
  srv.close();
  limited.close();
  assert.deepEqual(statuses, [201, 201, 429]);
});

test('static serving never exposes data, server code or path traversal', async () => {
  for (const p of ['/.data/seller-portal.sqlite', '/server/app.mjs', '/dist/../server/app.mjs', '/%2e%2e/package.json', '/tests/server.test.mjs', '/src/api.ts']) {
    const r = await fetch(base + p);
    assert.equal(r.status, 404, p);
  }
  const index = await fetch(base + '/');
  assert.match(index.headers.get('content-security-policy'), /default-src 'self'/);
  assert.match(await index.text(), /<meta name="seller-api" content="server"/);
});
