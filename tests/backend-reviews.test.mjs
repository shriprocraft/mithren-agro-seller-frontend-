import test from 'node:test';
import assert from 'node:assert/strict';
import { toReview } from '../dist/backend-reviews.js';

const backend = {
  id: 'r1',
  product_id: 'p1',
  product_title: 'Alphonso Mango',
  product_image: null,
  order_number: 'MA-20261115-AB12CD',
  rating: 4,
  title: null,
  body: 'Sweet and fresh.',
  customer_name: 'Priya R.',
  created_at: '2026-11-15T10:00:00Z',
  reply: null,
  reported: false,
};

test('a backend review maps onto the portal review, with its product name and customer order number', () => {
  assert.deepEqual(toReview(backend, 's1'), {
    id: 'r1',
    sellerId: 's1',
    productId: 'p1',
    productName: 'Alphonso Mango',
    subOrderId: 'MA-20261115-AB12CD',
    orderInPortal: false,
    rating: 4,
    title: '',
    body: 'Sweet and fresh.',
    customerFirstName: 'Priya R.',
    date: '2026-11-15T10:00:00Z',
  });
});

test('a reply and a report carry over; a missing order number becomes empty', () => {
  const r = toReview({ ...backend, order_number: null, reply: { body: 'Thank you!', at: '2026-11-15T11:00:00Z' }, reported: true }, 's1');
  assert.deepEqual(r.reply, { body: 'Thank you!', at: '2026-11-15T11:00:00Z' });
  assert.equal(r.reported, true);
  assert.equal(r.subOrderId, '');
});
