// Mapping backend dashboard analytics onto the dashboard's metrics (run `npm test`).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toDashboardMetrics } from '../dist/backend-analytics.js';
import { computeDashboard } from '../dist/api-core.js';
import { createSeed, SELLER_A } from '../dist/data/seed.js';

const backend = {
  range: { start: '2026-11-01', end: '2026-11-07', days: 7 },
  revenue_paise: 219400, revenue_prev_paise: 74700, commission_paise: 17552,
  net_earnings_paise: 201848, net_earnings_prev_paise: 68724,
  orders: { total: 4, pending: 1, processing: 2, completed: 0, cancelled: 1 }, orders_prev_total: 1,
  average_order_value_paise: 73133, cancellation_rate: 0.25,
  trends: { daily: [{ period_start: '2026-11-06', revenue_paise: 0, orders: 0 }, { period_start: '2026-11-07', revenue_paise: 219400, orders: 4 }] },
  products: { live: 3, total: 4 }, low_stock_threshold: 5,
  low_stock: [{ product_id: 'p1', title: 'Alphonso Mango', variant_label: '1 kg', stock: 4 }, { product_id: 'p2', title: 'Kale', variant_label: null, stock: 0 }],
};

test('backend figures become rupee dashboard metrics', () => {
  const m = toDashboardMetrics(backend);

  assert.equal(m.sales, 2194);
  assert.equal(m.salesPrev, 747);
  assert.equal(m.netEarnings, 2018.48);
  assert.equal(m.averageOrderValue, 731.33);
  assert.equal(m.orders, 4);
  assert.equal(m.ordersPrev, 1);
  assert.equal(m.awaiting, 1);
  assert.equal(m.cancellations, 1);
  assert.equal(m.cancellationRate, 0.25);
  assert.equal(`${m.liveProducts}/${m.totalProducts}`, '3/4');
  assert.deepEqual(m.lowStock, [
    { productId: 'p1', name: 'Alphonso Mango', variant: '1 kg', stock: 4, threshold: 5 },
    { productId: 'p2', name: 'Kale', variant: '', stock: 0, threshold: 5 },
  ]);
  assert.deepEqual(m.series.map((p) => [p.sales, p.orders]), [[0, 0], [2194, 4]]);
  // India dates: the 7th starts at 18:30 UTC on the 6th.
  assert.equal(m.series[1].date, '2026-11-06T18:30:00.000Z');
  assert.equal(m.rating, null);
});

test('the portal’s own dashboard reports average order value too', () => {
  const m = computeDashboard(createSeed(), SELLER_A, 30, Date.now());
  assert.ok(m.averageOrderValue > 0);
  assert.ok(m.averageOrderValue <= m.sales);
});
