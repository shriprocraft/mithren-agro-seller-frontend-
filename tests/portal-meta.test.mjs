// The portal's listing details that are stored on the backend (run `npm test`).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyPortalMeta, hasPortalMeta, portalMetaOf, portalStateOf } from '../dist/portal-meta.js';

const product = () => ({
  id: 'p1', sellerId: 's1', name: 'Mango', slug: 'mango', description: '', category: 'Fruits', emoji: '🥭', variants: [],
  origin: 'Ratnagiri', seasonality: 'seasonal', seasonMonths: [4, 5, 13], harvestDate: '2026-04-01', packedDate: 'soon', storage: 'Cool, dry place',
  organicClaim: 'none', status: 'approved', available: true, minQty: 1, maxQty: 5, lowStockThreshold: 3, archived: false, updatedAt: '',
});

test('the stored details cover what other devices need, within the backend limits', () => {
  const meta = portalMetaOf(product());
  assert.deepEqual(meta, {
    origin: 'Ratnagiri', seasonality: 'seasonal', season_months: [4, 5], harvest_date: '2026-04-01', storage: 'Cool, dry place',
    organic_claim: 'none', status: 'approved', available: true, archived: false, min_qty: 1, max_qty: 5, low_stock_threshold: 3, emoji: '🥭',
  });
  assert.equal(portalMetaOf({ ...product(), origin: 'x'.repeat(200) }).origin.length, 120);
  assert.deepEqual(portalStateOf(product()), { status: 'approved', available: true, archived: false });
});

test('another device takes over the stored details; fields not stored stay', () => {
  const other = { ...product(), origin: '', storage: '', status: 'draft', archived: false, available: true, name: 'Kept' };
  applyPortalMeta(other, { origin: 'Ratnagiri', status: 'approved', archived: true, available: false, low_stock_threshold: 8 });
  assert.equal(other.origin, 'Ratnagiri');
  assert.equal(other.status, 'approved');
  assert.equal(other.archived, true);
  assert.equal(other.available, false);
  assert.equal(other.lowStockThreshold, 8);
  assert.equal(other.storage, '');
  assert.equal(other.name, 'Kept');
  assert.equal(hasPortalMeta({}), false);
  assert.equal(hasPortalMeta(undefined), false);
  assert.equal(hasPortalMeta({ archived: true }), true);
});
