// Browser test of the registration → review workflow against the real Node backend.
// Usage: npm run build && node tests/e2e-server.cjs [screenshotDir]
const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const assert = require('node:assert/strict');

const ROOT = resolve(__dirname, '..');
const SHOTS = process.argv[2];
const PORT = 8800 + Math.floor(Math.random() * 100);
const BASE = `http://127.0.0.1:${PORT}/`;
const ADMIN = 'e2e-admin-token-0123456789abcdef0123456789';
const PDF = { name: 'document.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n%e2e\n') };
const PNG = { name: 'cheque.png', mimeType: 'image/png', buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]) };

(async () => {
  const dataDir = process.env.E2E_DATA_DIR ?? mkdtempSync(join(tmpdir(), 'seller-portal-e2e-'));
  const serverLog = require('node:fs').createWriteStream(join(dataDir, 'server-stdout.log'));
  const codes = [];
  const srv = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server/index.mjs'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), DATA_DIR: dataDir, ADMIN_API_TOKENS: `${ADMIN}:E2E Reviewer`, CODE_DELIVERY: 'console' },
  });
  srv.stdout.pipe(serverLog);
  srv.stderr.pipe(serverLog);
  // Read whole lines: a chunk can end mid-line.
  let pending = '';
  srv.stdout.on('data', (d) => {
    pending += String(d);
    const lines = pending.split('\n');
    pending = lines.pop() ?? '';
    for (const line of lines) {
      const m = /\[verification\] (email|phone) code for \S+: (\d{6})/.exec(line);
      if (m) codes.push({ channel: m[1], code: m[2] });
    }
  });
  await new Promise((r) => srv.stdout.once('data', r));
  await new Promise((r) => setTimeout(r, 300));

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.setDefaultTimeout(8000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !/40[139]|422/.test(m.text()) && errors.length < 20 && errors.push(m.text()));
  const admin = (method, path, body) => fetch(BASE.slice(0, -1) + path, { method, headers: { Authorization: `Bearer ${ADMIN}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }).then((r) => r.json());
  const expectText = async (sel, re, timeout = 8000) => {
    const end = Date.now() + timeout;
    let last = '';
    while (Date.now() < end) {
      last = (await page.textContent(sel).catch(() => '')) ?? '';
      if (re.test(last)) return;
      await page.waitForTimeout(150);
    }
    assert.match(last, re);
  };
  const shot = async (name) => SHOTS && page.screenshot({ path: `${SHOTS}/srv-${name}.png`, fullPage: true });
  const next = async () => {
    await page.click('form[data-role=step] [type=submit]');
    await page.waitForTimeout(400);
  };
  let failed = false;
  const step = async (name, fn) => {
    try {
      await fn();
      console.log('ok  -', name);
    } catch (e) {
      failed = true;
      console.log('FAIL-', name, '\n      ', String(e.message).split('\n').slice(0, 4).join('\n       '));
      await shot('fail-' + name.replace(/\W+/g, '_'));
    }
  };

  await step('signed-out visitors are sent to sign-in', async () => {
    await page.goto(BASE + '#/seller/dashboard');
    await page.waitForTimeout(800);
    assert.ok(page.url().includes('#/seller/sign-in'));
    await shot('sign-in');
  });

  await step('register: create account with validation', async () => {
    await page.click('a[href="#/seller/register"]');
    await page.waitForSelector('#f_fullName');
    await next();
    assert.ok(await page.isVisible('#f_fullName_err'));
    await page.fill('#f_fullName', 'Kavita Rao');
    await page.fill('#f_email', 'kavita@raofarms.example');
    await page.fill('#f_phone', '9876512345');
    await page.fill('#f_password', 'greenfields2026');
    await page.fill('#f_password2', 'greenfields2026');
    await shot('step1-create');
    await next();
    await page.waitForSelector('[data-verify=email]');
  });

  await step('register: verify email and phone with codes from the server', async () => {
    await page.fill('#f_emailCode', '000000');
    await page.click('[data-verify=email]');
    await expectText('#f_emailCode_err', /incorrect/);
    await page.fill('#f_emailCode', codes.filter((c) => c.channel === 'email').at(-1).code);
    await page.click('[data-verify=email]');
    await expectText('form[data-role=step]', /Email verified/);
    await page.fill('#f_phoneCode', codes.filter((c) => c.channel === 'phone').at(-1).code);
    await page.click('[data-verify=phone]');
    await expectText('form[data-role=step]', /Mobile number verified/);
    await shot('step1-verified');
    await next();
    await page.waitForSelector('#f_shopName');
  });

  await step('register: shop details validate and progress persists', async () => {
    await page.fill('#f_shopName', 'R');
    await next();
    assert.ok(await page.isVisible('#f_shopName_err'));
    await page.fill('#f_shopName', 'Rao Organic Farms');
    await page.fill('#f_description', 'Third-generation farm growing vegetables and fruit in Tumakuru.');
    await page.setInputFiles('[data-upload=logo]', { ...PNG, name: 'logo.png' });
    await expectText('#f_doc_logo', /logo\.png/);
    await shot('step2-shop');
    await next();
    await page.waitForSelector('#f_addressLine1');
    // Reload mid-way: the server remembers the step and data.
    await page.reload();
    await page.waitForSelector('#f_addressLine1');
    await page.click('[data-action=prev]');
    await page.waitForSelector('#f_shopName');
    assert.equal(await page.inputValue('#f_shopName'), 'Rao Organic Farms');
    await next();
  });

  await step('register: address and service area', async () => {
    await page.fill('#f_addressLine1', 'Survey 88, Gubbi Road');
    await page.selectOption('#f_state', 'Karnataka');
    await page.fill('#f_district', 'Tumakuru');
    await page.fill('#f_city', 'Gubbi');
    await page.fill('#f_pincode', '572216');
    await page.fill('#f_serviceAreas', 'Tumakuru, Gubbi, 572216');
    await next();
    await page.waitForSelector('[name=productTypes]');
  });

  await step('register: products and pickup', async () => {
    await page.click('label.chip:has-text("Vegetables")');
    await page.click('label.chip:has-text("Fruits")');
    await page.uncheck('[name=pickupSameAsBusiness]');
    await page.fill('#f_pickupAddress', 'Packhouse, Survey 88, Gubbi Road');
    await page.fill('#f_pickupPincode', '572216');
    await next();
    await page.waitForSelector('#f_businessType');
  });

  await step('register: conditional KYC fields and documents', async () => {
    await page.selectOption('#f_businessType', 'individual_farmer');
    await page.selectOption('#f_gstStatus', 'exempt');
    await page.waitForTimeout(200);
    assert.equal(await page.locator('#f_gstin').count(), 0, 'no GSTIN for GST-exempt farmers');
    await next();
    await expectText('#f_doc_address_proof_err', /Upload/);
    await page.selectOption('#f_gstStatus', 'registered');
    await page.waitForSelector('#f_gstin');
    await page.fill('#f_pan', 'ABCDE1234F');
    await page.fill('#f_gstin', '29ABCDE1234F1Z5');
    await page.setInputFiles('[data-upload=address_proof]', PDF);
    await expectText('#f_doc_address_proof', /document\.pdf/);
    await page.setInputFiles('[data-upload=pan]', PDF);
    await expectText('#f_doc_pan', /document\.pdf/);
    await page.setInputFiles('[data-upload=gst]', PDF);
    await expectText('#f_doc_gst', /Unverified/);
    await shot('step5-kyc');
    await next();
    await page.waitForSelector('#f_holderName');
  });

  await step('register: bank details are saved masked', async () => {
    await page.fill('#f_holderName', 'Kavita Rao');
    await page.fill('#f_accountNumber', '50100234567890');
    await page.fill('#f_accountNumberConfirm', '50100234567899');
    await page.fill('#f_ifsc', 'HDFC0001234');
    await page.click('[data-action=save-bank]');
    await expectText('#f_accountNumberConfirm_err', /match/);
    await page.fill('#f_accountNumberConfirm', '50100234567890');
    await page.click('[data-action=save-bank]');
    await expectText('.bank-saved', /7890/);
    assert.ok(!(await page.content()).includes('50100234567890'), 'full number not in the page');
    await page.setInputFiles('[data-upload=bank_proof]', PNG);
    await expectText('#f_doc_bank_proof', /cheque\.png/);
    await shot('step6-bank');
    await next();
    await page.waitForSelector('[name=claimsOrganic]');
  });

  await step('register: organic certificate starts unverified', async () => {
    await page.check('[name=claimsOrganic][value=yes]');
    await page.fill('#f_certBody', 'Demo Organic Certification Agency');
    await page.fill('#f_certNumber', 'NPOP/KA/2026/0042');
    await page.setInputFiles('[data-upload=organic_cert]', PDF);
    await expectText('#organic-wrap', /Submitted for review/);
    await shot('step7-organic');
    await next();
    await page.waitForSelector('[name=consent]');
  });

  let reference = '';
  await step('register: review, submit once, see pending status with reference ID', async () => {
    await shot('step8-review');
    await next();
    await expectText('#f_consent_err', /confirm/);
    await page.check('[name=consent]');
    await page.click('form[data-role=step] [type=submit]');
    await page.waitForFunction(() => location.hash === '#/seller');
    await expectText('main', /awaiting review/);
    reference = (await page.textContent('dd.mono')).trim();
    assert.match(reference, /^MA-\d{4}-\d{6}$/);
    await shot('status-pending');
  });

  await step('status persists after signing out and back in', async () => {
    await page.click('[data-action=account]');
    await page.click('[data-action=sign-out]');
    await page.waitForFunction(() => location.hash.startsWith('#/seller/sign-in'));
    await page.fill('#f_email', 'kavita@raofarms.example');
    await page.fill('#f_password', 'wrong-password-1');
    await page.click('[data-role=sign-in] [type=submit]');
    await expectText('.form-error', /incorrect/);
    await page.fill('#f_password', 'greenfields2026');
    await page.click('[data-role=sign-in] [type=submit]');
    await page.waitForFunction(() => location.hash === '#/seller');
    await expectText('main', new RegExp(reference));
    await expectText('main', /Pending review/);
  });

  await step('pending seller cannot publish products (UI and server)', async () => {
    await page.evaluate(() => (location.hash = '/seller/products/new'));
    await page.waitForSelector('[data-submit=submit]');
    assert.ok(await page.isDisabled('[data-submit=submit]'));
    const r = await page.evaluate(async () => {
      const res = await fetch('/api/rpc/saveProduct', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'seller-portal' }, body: JSON.stringify({ args: [{ name: 'Tomatoes', slug: 'tomatoes', description: 'Heirloom tomatoes from our farm, vine ripened.', category: 'Vegetables', emoji: '🍅', variants: [{ id: 'v1', label: '1 kg', sku: 'RO-TOM-1K', packSize: 1, unit: 'kg', price: 80, stock: 5 }], origin: 'Gubbi', seasonality: 'year_round', seasonMonths: [], storage: 'Room temperature', organicClaim: 'none', available: true, minQty: 1, maxQty: 5, lowStockThreshold: 1 }, true] }) });
      return res.status;
    });
    assert.equal(r, 403);
  });

  let appId = '';
  await step('reviewer requests changes; seller sees the message and resubmits', async () => {
    appId = (await admin('GET', '/api/admin/applications?status=pending')).applications[0].id;
    await admin('POST', `/api/admin/applications/${appId}/decision`, { action: 'request_changes', message: 'The address proof is a cropped scan.', requestedItems: ['Upload a complete copy of the address proof'] });
    await page.evaluate(() => (location.hash = '/seller'));
    await page.reload();
    await expectText('main', /Additional information is required/);
    await expectText('main', /cropped scan/);
    await expectText('main', /Upload a complete copy/);
    await shot('status-changes');
    await page.click('a[href="#/seller/register"]');
    await page.waitForSelector('form[data-role=step]');
    await expectText('.register', /cropped scan/);
    await page.click('[data-goto="5"]');
    await page.waitForSelector('[data-upload=address_proof]');
    await page.setInputFiles('[data-upload=address_proof]', { ...PDF, name: 'address-full.pdf' });
    await expectText('#f_doc_address_proof', /address-full\.pdf/);
    await page.click('[data-goto="8"]');
    await page.waitForSelector('[name=consent]');
    await page.check('[name=consent]');
    await page.click('form[data-role=step] [type=submit]');
    await page.waitForFunction(() => location.hash === '#/seller');
    await expectText('main', /awaiting review/);
  });

  await step('approval unlocks the dashboard; organic stays unverified until reviewed', async () => {
    await admin('POST', `/api/admin/applications/${appId}/decision`, { action: 'approve', message: '' });
    await page.reload();
    await page.waitForFunction(() => location.hash === '#/seller/dashboard');
    await page.evaluate(() => (location.hash = '/seller?view=status'));
    await expectText('main', /has been approved/);
    await expectText('main', /Submitted for review/);
    await shot('status-approved');
    const detail = await admin('GET', `/api/admin/applications/${appId}`);
    const cert = detail.documents.find((d) => d.kind === 'organic_cert');
    await admin('POST', `/api/admin/documents/${cert.id}/review`, { decision: 'verified', note: '' });
    await page.reload();
    await expectText('main', /Verified by reviewer/);
  });

  await step('suspension restricts selling and shows the message', async () => {
    await admin('POST', `/api/admin/applications/${appId}/decision`, { action: 'suspend', message: 'Quality complaints under investigation.' });
    await page.evaluate(() => (location.hash = '/seller/products'));
    await page.reload();
    await expectText('main', /suspended/i);
    await expectText('main', /Quality complaints/);
    await expectText('main', /No products/); // page finished loading
    assert.equal(await page.locator('a[href="#/seller/products/new"].btn-primary').count(), 0);
  });

  await step('mobile layout of the wizard has no horizontal scroll', async () => {
    await admin('POST', `/api/admin/applications/${appId}/decision`, { action: 'reinstate', message: '' });
    const m = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await m.goto(BASE + '#/seller/register');
    await m.waitForSelector('#f_fullName');
    const overflow = await m.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    if (SHOTS) await m.screenshot({ path: `${SHOTS}/srv-mobile-register.png`, fullPage: true });
    await m.close();
    assert.equal(overflow, false);
  });

  await step('no unexpected browser errors', async () => assert.deepEqual(errors, [], JSON.stringify(errors)));

  await browser.close();
  srv.kill();
  if (!process.env.E2E_DATA_DIR) rmSync(dataDir, { recursive: true, force: true });
  process.exitCode = failed ? 1 : 0;
})();
