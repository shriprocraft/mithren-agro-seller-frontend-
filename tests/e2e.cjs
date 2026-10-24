// End-to-end workflow checks in Chromium. Usage: node tests/e2e.cjs [baseUrl] [screenshotDir]
// Requires the prototype to be served (npm run serve).
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const BASE = process.argv[2] || 'http://localhost:5173/';
const SHOTS = process.argv[3];

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.setDefaultTimeout(6000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  const go = async (hash) => {
    await page.evaluate((h) => (location.hash = h), hash);
    await page.waitForTimeout(700);
  };
  // Poll until the element's text matches, since the mock API has random latency.
  const expectText = async (sel, re, timeout = 6000) => {
    const end = Date.now() + timeout;
    let last = '';
    while (Date.now() < end) {
      last = (await page.textContent(sel).catch(() => '')) ?? '';
      if (re.test(last)) return;
      await page.waitForTimeout(150);
    }
    assert.match(last, re);
  };
  const step = async (name, fn) => {
    try {
      await fn();
      console.log('ok  -', name);
    } catch (e) {
      console.log('FAIL-', name, '\n     ', e.message.split('\n').slice(0, 6).join('\n       '));
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/fail-${name.replace(/\W+/g, '_')}.png`, fullPage: true });
      process.exitCode = 1;
    }
  };

  await page.goto(BASE + '#/seller/dashboard');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForTimeout(1000);

  await step('fresh start shows an empty dashboard', async () => {
    await expectText('.metrics', /Sales\s*₹0/);
    await expectText('main', /No orders yet/);
  });

  // The workflow checks below need the sample dataset.
  await page.keyboard.press('Alt+Shift+KeyP');
  await page.click('[data-p=reset]');
  await page.waitForTimeout(1200);

  await step('dashboard range filter updates metrics', async () => {
    const before = await page.textContent('.metric-value');
    await page.selectOption('#range', '7');
    await page.waitForFunction((b) => document.querySelector('.metric-value')?.textContent !== b, before, { timeout: 6000 });
    assert.ok(page.url().includes('range=7'));
  });

  await step('metric definition tooltip is keyboard accessible', async () => {
    await page.focus('.info-btn');
    await page.waitForTimeout(100);
    assert.ok(await page.isVisible('#global-tooltip'));
    await expectText('#global-tooltip', /sub-orders/);
  });

  await step('accept order from list, then fulfil to delivered', async () => {
    await go('/seller/orders?status=awaiting_confirmation');
    const id = await page.getAttribute('[data-action=accept]', 'data-id');
    await page.click('[data-action=accept]');
    await page.waitForTimeout(900);
    await go(`/seller/orders/${id}`);
    await expectText('.page-header', /Accepted/);
    await page.click('[data-to=packed]');
    await page.waitForTimeout(900);
    await page.click('[data-to=ready_for_pickup]');
    await page.waitForTimeout(900);
    await page.click('[data-action=sim-delivery]');
    await page.waitForTimeout(900);
    await page.click('[data-action=sim-delivery]');
    await page.waitForTimeout(900);
    await expectText('.page-header', /Delivered/);
    await go('/seller/earnings?range=30');
    await page.waitForSelector(`a[href="#/seller/orders/${id}"]`, { timeout: 6000 }); // ledger shows the delivered order
    await expectText('#bd-h + * + p, .ok-text', /reconcile/);
  });

  await step('reject requires a reason; Esc closes the dialog', async () => {
    await page.keyboard.press('Alt+Shift+KeyP');
    await page.waitForTimeout(300);
    await page.click('[data-p=order]');
    await page.waitForTimeout(1200);
    await page.click('[data-to=rejected]');
    await page.waitForTimeout(200);
    await page.click('.modal [type=submit]');
    await expectText('#f_reason_err', /reason/);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    assert.equal(await page.locator('.modal').count(), 0);
    await page.click('[data-to=rejected]');
    await page.fill('#f_reason', 'Harvest damaged by rain');
    await page.click('.modal [type=submit]');
    await page.waitForTimeout(900);
    await expectText('.page-header', /Rejected/);
    await expectText('.timeline', /Harvest damaged by rain/);
  });

  await step('product form shows field errors, then submits for approval', async () => {
    await go('/seller/products/new');
    await page.click('[data-submit=submit]');
    await page.waitForTimeout(700);
    assert.ok(await page.isVisible('#f_name_err'));
    assert.ok(await page.isVisible('#form-error'));
    await page.fill('#f_name', 'Purple Cabbage');
    await page.selectOption('#f_category', 'Vegetables');
    await page.fill('#f_description', 'Crisp purple cabbage grown without synthetic inputs.');
    await page.fill('#f_variant_0_label', '1 piece');
    await page.fill('#f_variant_0_sku', 'GV-CAB-1P');
    await page.fill('#f_variant_0_price', '55');
    await page.fill('#f_variant_0_stock', '30');
    await page.fill('#f_origin', 'Mulshi, Pune');
    await page.fill('#f_storage', 'Refrigerate up to a week.');
    assert.equal(await page.inputValue('#f_slug'), 'purple-cabbage');
    await page.click('[data-submit=submit]');
    await page.waitForTimeout(1200);
    await expectText('.page-header', /Pending approval/);
  });

  await step('network failure keeps form data and shows an error', async () => {
    await page.keyboard.press('Alt+Shift+KeyP');
    await page.waitForTimeout(300);
    await page.check('#proto-fail');
    await page.click('.modal [data-close]');
    await go('/seller/products/p_carrot');
    await page.fill('#f_variant_0_price', '51');
    await page.click('[data-submit=submit]');
    await page.waitForTimeout(900);
    await expectText('#form-error', /Network error/);
    assert.equal(await page.inputValue('#f_variant_0_price'), '51');
    await page.keyboard.press('Alt+Shift+KeyP');
    await page.waitForTimeout(300);
    await page.uncheck('#proto-fail');
    await page.click('.modal [data-close]');
    await page.click('[data-submit=submit]');
    await page.waitForTimeout(1200);
    assert.match(await page.textContent('.page-header'), /Approved/, 'price-only change keeps listing live');
  });

  await step('inventory damage adjustment needs a note and is logged', async () => {
    await go('/seller/inventory');
    await page.click('[data-action=adjust]');
    await page.fill('#f_delta', '2');
    await page.selectOption('#f_reason', 'damage');
    await page.click('.modal [type=submit]');
    await page.waitForTimeout(700);
    await expectText('.modal .form-error', /note/i);
    await page.fill('#f_note', 'Crushed in transit');
    await page.click('.modal [type=submit]');
    await page.waitForFunction(() => document.querySelector('section:has(#log-h) tbody tr')?.textContent.includes('Crushed in transit'));
  });

  await step('CSV import reports invalid rows', async () => {
    await page.click('[data-action=import]');
    await page.setInputFiles('#csv-file', { name: 'stock.csv', mimeType: 'text/csv', buffer: Buffer.from('sku,stock\nGV-TOM-500,70\nSR-KAL-200,5\nGV-CAR-1K,abc\n') });
    await page.waitForTimeout(400);
    const report = await page.textContent('#csv-report');
    assert.match(report, /1\s*valid row/);
    assert.match(report, /SR-KAL-200 does not match/);
    await page.click('[data-action=apply]');
    await page.waitForTimeout(1200);
  });

  await step('isolation: another seller’s records are not found', async () => {
    await go('/seller/products/p_sr_kale');
    await page.waitForSelector('main h3');
    await expectText('main', /Product not found/);
    await go('/seller/orders/SO-48300-SR');
    await page.waitForSelector('main h3');
    await expectText('main', /Order not found/);
  });

  await step('review reply posts', async () => {
    await go('/seller/reviews?filter=unanswered');
    await page.fill('.reply-form textarea', 'Thanks — sorry about that, we have fixed it.');
    await page.click('.reply-form [type=submit]');
    await page.waitForTimeout(1000);
    await go('/seller/reviews');
    assert.ok((await page.textContent('.review-list')).includes('Thanks — sorry about that'));
  });

  await step('settings validation and save', async () => {
    await go('/seller/store-settings');
    await page.fill('#f_acceptWindowMins', '500');
    await page.click('#fulfilment [type=submit]');
    await page.waitForTimeout(700);
    assert.ok(await page.isVisible('#f_acceptWindowMins_err'));
    await page.fill('#f_acceptWindowMins', '25');
    await page.click('#fulfilment [type=submit]');
    await page.waitForTimeout(700);
    await expectText('#fulfilment .save-status', /Saved/);
  });

  await step('payout request', async () => {
    await go('/seller/settlements');
    await page.click('[data-action=request]');
    await page.fill('#f_amount', '600');
    await page.click('.modal [type=submit]');
    await page.waitForTimeout(1000);
    await expectText('#pr-h ~ .table-wrap', /Awaiting review/);
  });

  await step('document upload rejects wrong file type', async () => {
    await go('/seller/documents');
    await page.click('[data-action=upload][data-kind=additional]');
    await page.setInputFiles('#f_file', { name: 'malware.exe', mimeType: 'application/x-msdownload', buffer: Buffer.from('x') });
    await page.click('.modal [type=submit]');
    await expectText('#f_file_err', /PDF, JPG or PNG/);
    await page.keyboard.press('Escape');
  });

  await step('suspended account is read-only (preview reviewer stand-in)', async () => {
    await page.keyboard.press('Alt+Shift+KeyP');
    await page.fill('#proto-msg', 'Quality complaints under investigation.');
    await page.click('[data-decide=suspend]');
    await page.waitForTimeout(1200);
    await go('/seller/products');
    await expectText('main', /suspended/i);
    assert.equal(await page.locator('a[href="#/seller/products/new"].btn-primary').count(), 0);
    await page.keyboard.press('Alt+Shift+KeyP');
    await page.click('[data-decide=reinstate]');
    await page.waitForTimeout(1200);
  });

  await step('preview: sign out, register a new seller through all 8 steps and submit', async () => {
    await page.click('[data-action=account]');
    await page.click('[data-action=sign-out]');
    await page.waitForFunction(() => location.hash.startsWith('#/seller/sign-in'));
    await page.click('a[href="#/seller/register"]');
    await page.fill('#f_fullName', 'Meera Joshi');
    await page.fill('#f_email', 'meera@farm.example');
    await page.fill('#f_phone', '9876543210');
    await page.fill('#f_password', 'harvest2026x');
    await page.fill('#f_password2', 'harvest2026x');
    await page.click('form[data-role=step] [type=submit]');
    await page.waitForSelector('[data-verify=email]');
    await expectText('#f_emailCode_hint', /your code is \d{6}/);
    for (const ch of ['email', 'phone']) {
      const code = (await page.textContent(`#f_${ch}Code_hint`)).match(/(\d{6})/)[1];
      await page.fill(`#f_${ch}Code`, code);
      await page.click(`[data-verify=${ch}]`);
      await page.waitForTimeout(400);
    }
    await expectText('form[data-role=step]', /Mobile number verified/);
    const next = () => page.click('form[data-role=step] [type=submit]').then(() => page.waitForTimeout(500));
    await next();
    await page.fill('#f_shopName', 'Joshi Family Farm');
    await page.fill('#f_description', 'Small family farm growing leafy greens and herbs near Lonavala.');
    await next();
    await page.fill('#f_addressLine1', 'Gat 12, Old Highway');
    await page.selectOption('#f_state', 'Maharashtra');
    await page.fill('#f_district', 'Pune');
    await page.fill('#f_city', 'Lonavala');
    await page.fill('#f_pincode', '410401');
    await page.fill('#f_serviceAreas', 'Lonavala, Khandala');
    await next();
    await page.click('label.chip:has-text("Herbs")');
    await next();
    await page.selectOption('#f_businessType', 'proprietorship');
    await page.selectOption('#f_gstStatus', 'not_registered');
    await page.waitForSelector('#f_pan');
    await page.fill('#f_pan', 'ABCDE1234F');
    const pdf = (name) => ({ name, mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4') });
    await page.setInputFiles('[data-upload=address_proof]', pdf('address.pdf'));
    await expectText('#f_doc_address_proof', /address\.pdf/);
    await page.setInputFiles('[data-upload=pan]', pdf('pan.pdf'));
    await expectText('#f_doc_pan', /pan\.pdf/);
    await next();
    await page.fill('#f_holderName', 'Meera Joshi');
    await page.fill('#f_accountNumber', '123456789012');
    await page.fill('#f_accountNumberConfirm', '123456789012');
    await page.fill('#f_ifsc', 'SBIN0001234');
    await page.click('[data-action=save-bank]');
    await expectText('.bank-saved', /9012/);
    await page.setInputFiles('[data-upload=bank_proof]', pdf('cheque.pdf'));
    await expectText('#f_doc_bank_proof', /cheque\.pdf/);
    await next();
    await page.check('[name=claimsOrganic][value=no]');
    await next();
    await page.check('[name=consent]');
    await page.click('form[data-role=step] [type=submit]');
    await page.waitForFunction(() => location.hash === '#/seller');
    await expectText('main', /awaiting review/);
    await expectText('main', /MA-\d{4}-\d{6}/);
    await expectText('.topbar', /Joshi Family Farm/);
  });

  await step('no runtime errors', async () => assert.deepEqual(errors, []));
  await browser.close();
})();
