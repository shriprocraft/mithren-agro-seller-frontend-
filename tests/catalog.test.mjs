// Category-specific product rules and the K3 paise guard (run `npm test`).
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import * as api from '../dist/api-core.js';
import { SELLER_A } from '../dist/data/seed.js';
import { categoryKind, rupeesToPaise, APPAREL_SIZES } from '../dist/catalog.js';

beforeEach(() => {
  api.resetDemoData();
  api._setSessionForTesting(SELLER_A, 'Seller A');
});

test('categories map to the right form', () => {
  assert.equal(categoryKind('Women Apparel'), 'apparel');
  assert.equal(categoryKind('Women Accessories'), 'apparel');
  for (const c of ['Fruits', 'Vegetables', 'Leafy Greens', 'Root Vegetables', 'Herbs', 'Exotic']) assert.equal(categoryKind(c), 'produce', c);
  assert.equal(categoryKind('Others'), 'other');
  assert.deepEqual([...APPAREL_SIZES], ['S', 'M', 'L', 'XL', 'XXL', 'Free Size']);
});

test('rupees convert to whole paise exactly, or not at all', () => {
  assert.equal(rupeesToPaise(349), 34900);
  assert.equal(rupeesToPaise(349.5), 34950);
  assert.equal(rupeesToPaise(0.1 + 0.2), 30); // floating-point noise is not a third decimal
  assert.equal(rupeesToPaise(19.99), 1999);
  assert.equal(rupeesToPaise(12.345), null);
  assert.equal(rupeesToPaise(-1), null);
  assert.equal(rupeesToPaise(Number.NaN), null);
  assert.equal(rupeesToPaise(Infinity), null);
});

const kurti = (overrides = {}) => ({
  name: 'Cotton Kurti',
  slug: 'cotton-kurti',
  description: 'Hand block printed cotton kurti, breathable for summer.',
  category: 'Women Apparel',
  emoji: '👗',
  variants: [
    { id: 'v1', label: 'Size M', sku: 'GV-KRT-M', packSize: 1, unit: 'piece', size: 'M', price: 799, stock: 5 },
    { id: 'v2', label: 'Size L', sku: 'GV-KRT-L', packSize: 1, unit: 'piece', size: 'L', price: 799, stock: 3 },
  ],
  origin: '',
  seasonality: 'year_round',
  seasonMonths: [],
  storage: '',
  organicClaim: 'none',
  available: true,
  minQty: 1,
  maxQty: 5,
  lowStockThreshold: 2,
  ...overrides,
});

test('apparel can be submitted without origin, storage or organic details', async () => {
  const saved = await api.saveProduct(kurti(), true);

  assert.equal(saved.status, 'pending');
  assert.deepEqual(saved.variants.map((v) => v.size), ['M', 'L']);
});

test('apparel variants need a size, each listed once', async () => {
  const noSize = kurti({ variants: [{ ...kurti().variants[0], size: undefined }] });
  await assert.rejects(api.saveProduct(noSize, false), (e) => e.status === 422 && 'variant_0_size' in e.fieldErrors);

  const twice = kurti({ variants: [kurti().variants[0], { ...kurti().variants[1], size: 'M' }] });
  await assert.rejects(api.saveProduct(twice, false), (e) => e.status === 422 && 'variant_1_size' in e.fieldErrors);
});

test('apparel cannot carry an organic claim', async () => {
  await assert.rejects(api.saveProduct(kurti({ organicClaim: 'certified' }), true), (e) => e.status === 422 && 'organicClaim' in e.fieldErrors);
});

test('produce still requires origin and storage to submit', async () => {
  const mango = kurti({ name: 'Mango', slug: 'mango-test', category: 'Fruits', variants: [{ id: 'v1', label: '1 kg', sku: 'GV-MNG-T1', packSize: 1, unit: 'kg', price: 349, stock: 2 }] });
  await assert.rejects(api.saveProduct(mango, true), (e) => e.status === 422 && 'origin' in e.fieldErrors && 'storage' in e.fieldErrors);
});

test('prices with more than two decimals are rejected before reaching the backend', async () => {
  const bad = kurti({ variants: [{ ...kurti().variants[0], price: 799.995 }] });
  await assert.rejects(api.saveProduct(bad, false), (e) => e.status === 422 && /2 decimal/.test(e.fieldErrors.variant_0_price));
});
