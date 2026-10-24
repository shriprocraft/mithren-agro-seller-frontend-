// Business-rule tests against the compiled mock API (run `npm test`).
// These mirror the scope doc's acceptance criteria (§13) for the frontend phase.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import * as api from '../dist/api.js';
import { SELLER_A, SELLER_B, round2 } from '../dist/data/seed.js';
import { validateInventoryCsv, toCsv, parseCsv, canSellerTransition, validateUpload, GSTIN_RE, PAN_RE } from '../dist/lib.js';

beforeEach(() => {
  api.resetDemoData();
  api._setSessionForTesting(SELLER_A, 'Seller A');
});

const rejects404 = (p) => assert.rejects(p, (e) => e instanceof api.ApiError && e.status === 404);

test('Seller A cannot read or edit Seller B products, orders or reviews', async () => {
  await rejects404(api.getProduct('p_sr_kale'));
  await rejects404(api.adjustStock('p_sr_kale', 'v1', 5, 'restock', ''));
  await rejects404(api.archiveProduct('p_sr_kale'));
  await rejects404(api.getOrder('SO-48300-SR'));
  await rejects404(api.transitionOrder('SO-48300-SR', 'packed'));
  await rejects404(api.replyToReview('rv_sr1', 'Thanks a lot!'));
  const products = await api.listProducts({ includeArchived: true });
  assert.ok(products.every((p) => p.sellerId === SELLER_A));
  const orders = await api.listOrders();
  assert.ok(orders.length > 0 && orders.every((o) => o.sellerId === SELLER_A));
  const ledger = await api.getLedger();
  assert.ok(ledger.every((l) => l.sellerId === SELLER_A));
});

test('Seller B sees only their own data', async () => {
  api._setSessionForTesting(SELLER_B, 'Seller B');
  const products = await api.listProducts({ includeArchived: true });
  assert.deepEqual(products.map((p) => p.id), ['p_sr_kale']);
  await rejects404(api.getProduct('p_alphonso'));
  assert.equal((await api.getLedger()).length, 0);
});

test('CSV import only touches the signed-in seller’s SKUs', async () => {
  // Even if a crafted payload includes another seller's SKU, nothing changes for them.
  await api.applyInventoryCsv([{ sku: 'SR-KAL-200', stock: 999 }]);
  api._setSessionForTesting(SELLER_B, 'Seller B');
  const kale = await api.getProduct('p_sr_kale');
  assert.equal(kale.variants[0].stock, 30);
});

test('Unapproved sellers cannot submit listings or act on orders', async () => {
  await api._demoSetSellerStatus('under_review');
  const p = await api.getProduct('p_microgreens');
  await assert.rejects(api.saveProduct({ ...p, description: 'Crunchy sunflower microgreens, harvested at 9 days.', origin: 'Pune', storage: 'Refrigerate' }, true), (e) => e.status === 403);
  // Drafts are still allowed
  const saved = await api.saveProduct({ ...p, description: 'Draft text' }, false);
  assert.equal(saved.status, 'draft');
  const [o] = await api.listOrders({ status: 'awaiting_confirmation' });
  await assert.rejects(api.transitionOrder(o.id, 'accepted'), (e) => e.status === 403);
});

test('Organic claims require a linked certificate', async () => {
  const p = await api.getProduct('p_carrot');
  await assert.rejects(api.saveProduct({ ...p, organicClaim: 'certified', certificateId: undefined }, true), (e) => e.status === 422 && 'certificateId' in e.fieldErrors);
});

test('Seller order transitions follow the configured flow', async () => {
  assert.ok(canSellerTransition('awaiting_confirmation', 'accepted'));
  assert.ok(!canSellerTransition('awaiting_confirmation', 'delivered'));
  assert.ok(!canSellerTransition('ready_for_pickup', 'in_transit'), 'in transit is set by the delivery partner');
  const [o] = await api.listOrders({ status: 'awaiting_confirmation' });
  await assert.rejects(api.transitionOrder(o.id, 'delivered'), (e) => e.status === 409);
  await assert.rejects(api.transitionOrder(o.id, 'rejected', ''), (e) => e.status === 422);
});

test('Rejecting an order restores stock with an audit entry', async () => {
  const [o] = await api.listOrders({ status: 'awaiting_confirmation' });
  const item = o.items[0];
  const before = (await api.getProduct(item.productId)).variants.find((v) => v.id === item.variantId).stock;
  await api.transitionOrder(o.id, 'rejected', 'Out of stock after harvest');
  const after = (await api.getProduct(item.productId)).variants.find((v) => v.id === item.variantId).stock;
  assert.equal(after - before, o.items.filter((i) => i.productId === item.productId && i.variantId === item.variantId).reduce((s, i) => s + i.qty, 0));
  const log = await api.listAdjustments(item.productId);
  assert.equal(log[0].reason, 'order_cancelled');
  const updated = await api.getOrder(o.id);
  assert.equal(updated.status, 'rejected');
  assert.notEqual(updated.paymentStatus, 'paid', 'refund is requested, never kept as paid');
});

test('Delivering an order adds a ledger entry whose numbers reconcile', async () => {
  const o = await api._demoSimulateNewOrder();
  await api.transitionOrder(o.id, 'accepted');
  await api.transitionOrder(o.id, 'packed');
  await api.transitionOrder(o.id, 'ready_for_pickup');
  await api._demoAdvanceDelivery(o.id);
  await api._demoAdvanceDelivery(o.id);
  const entry = (await api.getLedger()).find((l) => l.subOrderId === o.id);
  assert.ok(entry);
  assert.equal(entry.state, 'pending', 'inside the return window');
  assert.equal(entry.net, round2(entry.gross - entry.discount - entry.commission + entry.deliveryAdjustment - entry.refund - entry.hold));
});

test('Every ledger entry and every settlement total reconciles', async () => {
  const ledger = await api.getLedger();
  for (const l of ledger) assert.ok(Math.abs(round2(l.gross - l.discount - l.commission + l.deliveryAdjustment - l.refund - l.hold) - l.net) < 0.01, l.id);
  const byId = new Map(ledger.map((l) => [l.id, l]));
  for (const s of await api.listSettlements()) {
    const sum = round2(s.entryIds.reduce((acc, id) => acc + byId.get(id).net, 0));
    assert.equal(sum, s.amount, s.id);
    if (s.state === 'paid') assert.ok(s.reference, `${s.id} is paid without a reference`);
  }
});

test('Inventory adjustments are validated and audited', async () => {
  await assert.rejects(api.adjustStock('p_tomato', 'v1', -10_000, 'correction', 'x'), (e) => e.status === 422);
  await assert.rejects(api.adjustStock('p_tomato', 'v1', -1, 'damage', ''), (e) => e.status === 422 && 'note' in e.fieldErrors);
  await api.adjustStock('p_tomato', 'v1', -2, 'damage', 'Split skins');
  const [latest] = await api.listAdjustments('p_tomato');
  assert.equal(latest.delta, -2);
  assert.equal(latest.note, 'Split skins');
  assert.equal(latest.resultingStock, (await api.getProduct('p_tomato')).variants[0].stock);
});

test('Payout requests are capped by the server-computed eligible balance', async () => {
  await assert.rejects(api.requestPayout(10_000_000), (e) => e.status === 422);
  await assert.rejects(api.requestPayout(100), (e) => e.status === 422);
});

test('Seller settings ignore non-editable fields', async () => {
  await api.updateSeller({ shopName: 'Green Valley', payoutRequestsEnabled: false, status: 'approved', id: 'hijack' });
  const s = await api.getSeller();
  assert.equal(s.shopName, 'Green Valley');
  assert.equal(s.id, SELLER_A);
  assert.equal(s.payoutRequestsEnabled, true);
});

test('Simulated network failure rejects writes without changing data', async () => {
  const before = (await api.getProduct('p_tomato')).variants[0].stock;
  api.sim.failWrites = true;
  try {
    await assert.rejects(api.adjustStock('p_tomato', 'v1', 5, 'restock', ''), (e) => e.status === 503);
  } finally {
    api.sim.failWrites = false;
  }
  assert.equal((await api.getProduct('p_tomato')).variants[0].stock, before);
});

test('CSV validation reports line-level errors', () => {
  const known = new Set(['GV-TOM-500', 'GV-TOM-1K']);
  const res = validateInventoryCsv('sku,stock,price\nGV-TOM-500,10,90\nNOPE,1\nGV-TOM-1K,-3\nGV-TOM-500,5\n', known);
  assert.equal(res.rows.length, 1);
  assert.deepEqual(res.errors.map((e) => e.line), [3, 4, 5]);
  assert.equal(validateInventoryCsv('name,qty\n', known).errors[0].line, 1);
});

test('CSV export escapes quotes and neutralises formulas', () => {
  const csv = toCsv([['a,b', 'say "hi"', '=HYPERLINK("x")', -5]]);
  assert.equal(csv, `"a,b","say ""hi""","'=HYPERLINK(""x"")",-5`);
  assert.deepEqual(parseCsv(csv)[0], ['a,b', 'say "hi"', `'=HYPERLINK("x")`, '-5']);
});

test('Upload and tax-ID validation', () => {
  assert.equal(validateUpload({ name: 'a.pdf', type: 'application/pdf', size: 1000 }), null);
  assert.match(validateUpload({ name: 'a.exe', type: 'application/x-msdownload', size: 1000 }), /not an accepted/);
  assert.match(validateUpload({ name: 'big.pdf', type: 'application/pdf', size: 6 * 1024 * 1024 }), /limit is 5 MB/);
  assert.ok(GSTIN_RE.test('27ABCDE1234F1Z5'));
  assert.ok(!GSTIN_RE.test('27ABCDE1234F1X5'));
  assert.ok(PAN_RE.test('ABCDE1234F'));
});

test('A fresh start has no business data and every metric reads zero or empty', async () => {
  api.clearAllData();
  for (const sellerId of [SELLER_A, SELLER_B]) {
    api._setSessionForTesting(sellerId, 'Seller');
    assert.equal((await api.listProducts({ includeArchived: true })).length, 0);
    assert.equal((await api.listOrders()).length, 0);
    assert.equal((await api.getLedger()).length, 0);
    assert.equal((await api.listSettlements()).length, 0);
    assert.equal((await api.listPayoutRequests()).length, 0);
    assert.equal((await api.listReviews()).length, 0);
    assert.equal((await api.listAdjustments()).length, 0);
    assert.equal((await api.listNotifications()).length, 0);
  }
  api._setSessionForTesting(SELLER_A, 'Seller A');
  for (const days of [7, 30, 90]) {
    const m = await api.getDashboard(days);
    assert.equal(m.sales, 0);
    assert.equal(m.orders, 0);
    assert.equal(m.netEarnings, 0);
    assert.equal(m.liveProducts, 0);
    assert.equal(m.totalProducts, 0);
    assert.equal(m.lowStock.length, 0);
    assert.equal(m.cancellations, 0);
    assert.equal(m.cancellationRate, 0);
    assert.equal(m.returns, 0);
    assert.equal(m.rating, null, 'no reviews shows “—”');
    assert.equal(m.awaiting, 0);
    assert.ok(m.series.every((d) => d.sales === 0 && d.orders === 0));
  }
  // Account, settings and platform commission rules survive the reset.
  const s = await api.getSeller();
  assert.equal(s.status, 'approved');
  assert.ok((await api.getCommissionRules()).length > 0);
});
