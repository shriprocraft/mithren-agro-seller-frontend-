// /seller/dashboard — business metrics, alerts and recent orders.

import type { Page } from '../router.js';
import { setQuery } from '../router.js';
import { html, on, type Raw } from '../ui/dom.js';
import { pageHeader, metric, mockNote, orderBadge, callout, icon, emptyState } from '../ui/components.js';
import { salesChart } from '../ui/charts.js';
import * as api from '../api.js';
import { money, count, timeAgo } from '../lib.js';

const RANGES: [number, string][] = [
  [7, 'Last 7 days'],
  [30, 'Last 30 days'],
  [90, 'Last 90 days'],
];

const delta = (cur: number, prev: number) => (prev > 0 ? (cur - prev) / prev : null);

const page: Page = async ({ root, query, seller, refresh }) => {
  const days = [7, 30, 90].includes(Number(query.get('range'))) ? Number(query.get('range')) : 30;
  const [m, orders] = await Promise.all([api.getDashboard(days), api.listOrders()]);
  const recent = orders.slice(0, 6);

  const alerts: Raw[] = [];
  if (m.awaiting) alerts.push(alertItem('amber', `${m.awaiting} order${m.awaiting > 1 ? 's' : ''} awaiting confirmation`, `Accept or reject within ${seller.fulfilment.acceptWindowMins} min of placement.`, '/seller/orders?status=awaiting_confirmation', 'Review orders'));
  const outOfStock = m.lowStock.filter((l) => l.stock === 0).length;
  if (m.lowStock.length) alerts.push(alertItem(outOfStock ? 'red' : 'amber', `${m.lowStock.length} variant${m.lowStock.length > 1 ? 's' : ''} low on stock${outOfStock ? ` (${outOfStock} out of stock)` : ''}`, m.lowStock.slice(0, 3).map((l) => `${l.name} ${l.variant}`).join(', '), '/seller/inventory?filter=low', 'Restock'));
  if (m.rejectedProducts) alerts.push(alertItem('red', `${m.rejectedProducts} listing${m.rejectedProducts > 1 ? 's' : ''} rejected by moderation`, 'Read the reviewer note, fix and resubmit.', '/seller/products?status=rejected', 'View'));
  if (m.certExpiringDays !== null && m.certExpiringDays <= 30)
    alerts.push(alertItem(m.certExpiringDays <= 0 ? 'red' : 'amber', m.certExpiringDays <= 0 ? 'Organic certificate has expired' : `Organic certificate expires in ${m.certExpiringDays} days`, 'Organic labels are removed from listings when the certificate expires.', '/seller/documents', 'Upload renewal'));
  if (m.pendingProducts) alerts.push(alertItem('blue', `${m.pendingProducts} listing${m.pendingProducts > 1 ? 's' : ''} pending approval`, 'Moderation usually completes within 1 business day.', '/seller/products?status=pending', 'View'));

  root.innerHTML = html`
    ${pageHeader(
      `Good ${greeting()}, ${seller.ownerName.split(' ')[0]}`,
      `Here’s how ${seller.shopName} is doing.`,
      html`${mockNote()}
        <label class="sr-only" for="range">Date range</label>
        <select id="range" class="select-inline">${RANGES.map(([d, l]) => html`<option value="${d}" ${d === days ? 'selected' : ''}>${l}</option>`)}</select>`,
    )}
    ${seller.status !== 'approved' && seller.status !== 'suspended' ? callout('info', 'Metrics will appear once you start selling', 'Your account isn’t approved yet, so these figures are for illustration only.') : ''}

    <section aria-labelledby="kpi-h">
      <h2 id="kpi-h" class="sr-only">Key metrics</h2>
      <div class="metrics">
        ${metric({ label: 'Sales', value: money(m.sales), delta: delta(m.sales, m.salesPrev), definition: 'Value of items in sub-orders placed in this period, after your share of discounts. Excludes cancelled and rejected orders and items marked unavailable. Compared with the previous period of equal length.' })}
        ${metric({ label: 'Orders', value: count(m.orders), delta: delta(m.orders, m.ordersPrev), href: '/seller/orders', definition: 'Number of your sub-orders placed in this period, in any status. A customer checkout with several sellers creates one sub-order per seller.' })}
        ${metric({ label: 'Net earnings', value: money(m.netEarnings), delta: delta(m.netEarnings, m.netEarningsPrev), href: '/seller/earnings', definition: 'Ledger amount payable to you for orders delivered in this period: gross − discounts − platform commission ± delivery adjustments − refunds − holds. Includes amounts not yet settled.' })}
        ${metric({ label: 'Live products', value: `${m.liveProducts} / ${m.totalProducts}`, href: '/seller/products', definition: 'Approved, available listings visible to customers, out of all non-archived products (including drafts and pending).' })}
        ${metric({ label: 'Low-stock items', value: count(m.lowStock.length), href: '/seller/inventory?filter=low', tone: m.lowStock.length ? 'warn' : undefined, definition: 'Variants of approved or inactive products at or below the product’s low-stock threshold, including out-of-stock variants. Current snapshot, not affected by the date range.' })}
        ${metric({ label: 'Cancellations', value: `${m.cancellations} · ${(m.cancellationRate * 100).toFixed(1)}%`, delta: null, href: '/seller/orders?status=issues', definition: 'Sub-orders placed in this period that were cancelled (by you or the customer) or rejected by you, and that number as a share of all orders in the period.' })}
        ${metric({ label: 'Returns', value: count(m.returns), href: '/seller/orders?status=issues', definition: 'Sub-orders placed in this period with a return requested or completed.' })}
        ${metric({ label: 'Rating', value: m.rating !== null ? `${m.rating.toFixed(1)} ★` : '—', href: '/seller/reviews', definition: `Average of ${m.ratingCount} verified-purchase review${m.ratingCount === 1 ? '' : 's'} received in this period. Shows “—” when there are none.` })}
      </div>
    </section>

    <div class="grid-main">
      <section class="card" aria-labelledby="chart-h">
        <div class="card-head"><h2 id="chart-h" class="card-title">Sales &amp; orders</h2><span class="muted">${RANGES.find((r) => r[0] === days)?.[1]}</span></div>
        ${m.series.some((s) => s.orders) ? salesChart(m.series, 'Daily sales and orders') : emptyState('No orders in this period', 'Try a longer date range.')}
      </section>
      <section class="card" aria-labelledby="alerts-h">
        <div class="card-head"><h2 id="alerts-h" class="card-title">Needs attention</h2></div>
        ${alerts.length ? html`<ul class="alerts">${alerts}</ul>` : html`<p class="muted">${icon('check', 16)} Nothing needs your attention right now.</p>`}
      </section>
    </div>

    <section class="card" aria-labelledby="recent-h">
      <div class="card-head"><h2 id="recent-h" class="card-title">Recent orders</h2><a href="#/seller/orders" class="link">View all</a></div>
      ${recent.length
        ? html`<div class="table-wrap"><table class="table">
            <thead><tr><th scope="col">Order</th><th scope="col">Placed</th><th scope="col">Customer</th><th scope="col">Items</th><th scope="col" class="num">Value</th><th scope="col">Status</th></tr></thead>
            <tbody>${recent.map(
              (o) => html`<tr>
                <td><a href="#/seller/orders/${o.id}" class="mono">${o.id}</a></td>
                <td>${timeAgo(o.placedAt)}</td>
                <td>${o.customer.firstName} · ${o.customer.area}</td>
                <td>${o.items.length}</td>
                <td class="num">${money(o.items.reduce((s, i) => s + (i.unavailable ? 0 : i.qty * i.unitPrice), 0) - o.discountAllocation)}</td>
                <td>${orderBadge(o.status)}</td>
              </tr>`,
            )}</tbody></table></div>`
        : emptyState('No orders yet', 'Orders will appear here as customers buy your products.')}
    </section>`.value;

  on(root, 'change', '#range', (_e, el) => {
    setQuery({ range: (el as HTMLSelectElement).value });
    refresh();
  });
};

function alertItem(tone: 'amber' | 'red' | 'blue', title: string, body: string, href: string, cta: string) {
  return html`<li class="alert alert-${tone}">
    <span class="alert-dot" aria-hidden="true"></span>
    <div><strong>${title}</strong><p class="muted">${body}</p></div>
    <a class="btn btn-sm" href="#${href}">${cta}</a>
  </li>`;
}

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening';
}

export default page;
