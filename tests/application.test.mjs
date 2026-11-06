// Seller application rules: product categories and GSTIN state codes (run `npm test`).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CATEGORIES } from '../dist/data/seed.js';
import { GST_STATE_CODES, INDIAN_STATES, emptyApplicationData, validateStep, normaliseApplicationData } from '../dist/application.js';

test('existing categories are kept and the new ones are added', () => {
  for (const c of ['Fruits', 'Vegetables', 'Leafy Greens', 'Root Vegetables', 'Herbs', 'Exotic']) assert.ok(CATEGORIES.includes(c), c);
  for (const c of ['Women Apparel', 'Women Accessories', 'Others']) assert.ok(CATEGORIES.includes(c), c);
});

test('new categories survive application data normalisation', () => {
  const d = normaliseApplicationData({ ...emptyApplicationData(), productTypes: ['Women Apparel', 'Others', 'Not a category'] });
  assert.deepEqual(d.productTypes, ['Women Apparel', 'Others']);
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
