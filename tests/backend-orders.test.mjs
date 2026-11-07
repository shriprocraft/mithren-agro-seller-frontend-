// Mapping backend seller orders onto the portal's order model (run `npm test`).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toSubOrder, portalStatus, BACKEND_STATUS } from '../dist/backend-orders.js';
import { SELLER_TRANSITIONS } from '../dist/lib.js';

const order = (overrides = {}) => ({
  id: '0b8f…uuid',
  order_number: 'SO-000042',
  customer_order_ref: null,
  other_seller_count: 1,
  status: 'confirmed',
  placed_at: '2026-11-07T08:00:00Z',
  confirmed_at: '2026-11-07T08:05:00Z',
  cancel_reason: null,
  payment_method: 'online',
  payment_status: 'paid',
  delivery_slot: 'Today 5–7 pm',
  customer: { name: 'Priya Raman', phone: '+919840012345', address: '4 Lake View Street', city: 'Chennai', state: 'Tamil Nadu', pincode: '600040', instructions: null },
  items: [{ product_id: 'p1', variant_id: 'v1', title: 'Alphonso Mango', variant_label: '1 kg', sku: 'FRT-MANGO-1KG', quantity: 2, unit_price_paise: 34950 }],
  discount_paise: 2500,
  delivery_fee_paise: 0,
  events: [{ status: 'pending', actor: 'customer', note: null, at: '2026-11-07T08:00:00Z' }, { status: 'confirmed', actor: 'seller', note: null, at: '2026-11-07T08:05:00Z' }],
  ...overrides,
});

test('a backend order becomes a portal order with rupee amounts', () => {
  const o = toSubOrder(order());

  assert.equal(o.id, 'SO-000042');
  assert.equal(o.backendId, '0b8f…uuid');
  assert.equal(o.status, 'accepted');
  assert.deepEqual(o.items[0], { productId: 'p1', variantId: 'v1', name: 'Alphonso Mango', variantLabel: '1 kg', sku: 'FRT-MANGO-1KG', qty: 2, unitPrice: 349.5 });
  assert.equal(o.discountAllocation, 25);
  assert.equal(o.customer.firstName, 'Priya');
  assert.equal(o.customer.address, '4 Lake View Street, Chennai, Tamil Nadu 600040');
  assert.deepEqual(o.history.map((h) => h.status), ['awaiting_confirmation', 'accepted']);
});

test('statuses map both ways and match the portal’s seller transitions', () => {
  assert.equal(portalStatus('pending', false), 'awaiting_confirmation');
  assert.equal(portalStatus('shipped', true), 'ready_for_pickup');
  assert.equal(portalStatus('cancelled', false), 'rejected');
  assert.equal(portalStatus('cancelled', true), 'cancelled');
  // Every move the portal offers has a backend status to send.
  for (const targets of Object.values(SELLER_TRANSITIONS)) for (const to of targets) assert.ok(BACKEND_STATUS[to], to);
});

test('the address stays hidden before the order is accepted', () => {
  const o = toSubOrder(order({ status: 'pending', confirmed_at: null, customer: { ...order().customer, address: 'Shown while you fulfil the order', phone: '+91 •••••• 45' } }));
  assert.equal(o.status, 'awaiting_confirmation');
  assert.equal(o.customer.address, 'Shown while you fulfil the order');
});
