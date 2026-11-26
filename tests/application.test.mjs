// Seller application rules: product categories and GSTIN state codes (run `npm test`).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CATEGORIES } from '../dist/data/seed.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { GST_STATE_CODES, INDIAN_STATES, STEPS, emptyApplicationData, fromEightSteps, validateStep, normaliseApplicationData } from '../dist/application.js';
import { MIGRATIONS, openDatabase } from '../server/db.mjs';

test('the seller categories are the nine storefront categories', () => {
  assert.deepEqual(CATEGORIES, ['Spinach', 'Vegetables', 'Fruits', 'Organic Groceries', 'Oil', 'Cosmetics', 'Fancy Items', 'Women Apparels', 'Fertilizers']);
});

test('old category names in saved applications move to the new ones; new Super Admin categories are kept', () => {
  // The Super Admin adds categories (e.g. Cattle Feed); the backend checks names against its list.
  const d = normaliseApplicationData({ ...emptyApplicationData(), productTypes: ['Women Apparel', 'Leafy Greens', 'Herbs', 'Exotic', 'Oil', 'Cattle Feed'] });
  assert.deepEqual(d.productTypes, ['Women Apparels', 'Spinach', 'Vegetables', 'Oil', 'Cattle Feed']);
});

test('every selectable state has a GST state code', () => {
  for (const s of INDIAN_STATES) assert.match(GST_STATE_CODES[s] ?? '', /^\d{2}$/, s);
});

const kyc = (state, gstin) => ({
  ...emptyApplicationData(),
  state,
  businessType: 'individual_farmer',
  gstStatus: 'registered',
  pan: 'ABCDE1234F',
  gstin,
});
const ctx = { documentKinds: [], bankProvided: false, emailVerified: true, phoneVerified: true };

test('GSTIN must carry the state code of the business address', () => {
  const errors = validateStep(5, kyc('Tamil Nadu', '27ABCDE1234F1Z5'), ctx);
  assert.match(errors.gstin, /starts with 27 \(Maharashtra\).*Tamil Nadu \(33\)/);
});

test('GSTIN from the same state is accepted', () => {
  const errors = validateStep(5, kyc('Tamil Nadu', '33ABCDE1234F1Z5'), ctx);
  assert.equal(errors.gstin, undefined);
});

test('state check waits until a state is chosen', () => {
  const errors = validateStep(5, kyc('', '27ABCDE1234F1Z5'), ctx);
  assert.equal(errors.gstin, undefined);
});

test('the seller application has 9 steps: Bank and Payout are separate', () => {
  assert.deepEqual(
    STEPS.map((s) => s.label),
    ['Account', 'Shop', 'Address', 'Products', 'KYC', 'Bank', 'Payout', 'Documents', 'Review'],
  );
  assert.deepEqual(STEPS.map((s) => s.n), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
});

test('Step 6 asks for the bank account, Step 7 for the payout frequency and bank proof, Step 8 for the organic answer', () => {
  const d = emptyApplicationData();
  assert.deepEqual(Object.keys(validateStep(6, d, ctx)), ['bank']);
  assert.equal(validateStep(6, d, { ...ctx, bankProvided: true }).bank, undefined);
  assert.deepEqual(Object.keys(validateStep(7, d, { ...ctx, bankProvided: true })).sort(), ['doc_bank_proof', 'payoutFrequency']);
  assert.deepEqual(validateStep(7, { ...d, payoutFrequency: 'fortnightly' }, { ...ctx, bankProvided: true, documentKinds: ['bank_proof'] }), {});
  assert.deepEqual(Object.keys(validateStep(8, d, ctx)), ['claimsOrganic']);
  assert.deepEqual(validateStep(9, d, ctx), {});
});

test('progress saved by the 8-step wizard moves to the 9-step numbering', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8].map(fromEightSteps), [1, 2, 3, 4, 5, 6, 8, 9]);
});

test('the portal server database moves saved progress to 9 steps and keeps bank details', () => {
  const dir = mkdtempSync(join(tmpdir(), 'seller-steps-'));
  try {
    // A database made before the change: only the first migration applied.
    const old = new DatabaseSync(join(dir, 'seller-portal.sqlite'));
    old.exec('PRAGMA foreign_keys = ON');
    old.exec(MIGRATIONS[0].sql);
    old.exec("CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL); INSERT INTO schema_migrations VALUES (1, 't')");
    old.exec("INSERT INTO users (id, seller_id, full_name, email, phone, password_hash, created_at) VALUES ('u1','s1','A','a@x','1','h','t'), ('u2','s2','B','b@x','2','h','t'), ('u3','s3','C','c@x','3','h','t')");
    const app = old.prepare("INSERT INTO seller_applications (id, user_id, seller_id, status, current_step, data_json, created_at, updated_at) VALUES (?, ?, ?, 'incomplete', ?, '{}', 't', 't')");
    app.run('a1', 'u1', 's1', 6);
    app.run('a2', 'u2', 's2', 7);
    app.run('a3', 'u3', 's3', 8);
    old.exec("INSERT INTO bank_accounts VALUES ('a2', 'B', 'enc', '1234', 'SBIN0001234', '', 'k1', 't')");
    old.close();

    const db = openDatabase(dir);
    assert.deepEqual(db.prepare('SELECT current_step FROM seller_applications ORDER BY id').all().map((r) => r.current_step), [6, 8, 9]);
    assert.deepEqual(db.prepare('SELECT application_id FROM bank_accounts').all().map((r) => r.application_id), ['a2']);
    assert.throws(() => db.prepare("UPDATE seller_applications SET current_step = 10 WHERE id = 'a1'").run());
    assert.equal(db.prepare('PRAGMA foreign_keys').get().foreign_keys, 1);
    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the payout frequency is weekly or every 15 days; anything else is cleared', () => {
  assert.equal(normaliseApplicationData({ payoutFrequency: 'weekly' }).payoutFrequency, 'weekly');
  assert.equal(normaliseApplicationData({ payoutFrequency: 'fortnightly' }).payoutFrequency, 'fortnightly');
  assert.equal(normaliseApplicationData({ payoutFrequency: 'monthly' }).payoutFrequency, '');
  assert.equal(normaliseApplicationData({}).payoutFrequency, '');
});
