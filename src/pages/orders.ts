// /seller/orders — the seller's own sub-orders only.

import type { Page } from '../router.js';
import { setQuery } from '../router.js';
import { html, on } from '../ui/dom.js';
import { pageHeader, orderBadge, emptyState, tabs, icon, badge, paginate, pager, bindPager } from '../ui/components.js';
import { toast } from '../ui/overlay.js';
import * as api from '../api.js';
import { money, timeAgo, fmtDate } from '../lib.js';
import type { SubOrder } from '../types.js';

const TABS: [string, string][] = [
  ['awaiting_confirmation', 'To confirm'],
  ['active', 'In progress'],
  ['delivered', 'Delivered'],
  ['issues', 'Cancelled & returns'],
  ['', 'All'],
];

const page: Page = async ({ root, query, seller, refresh }) => {
  const status = query.get('status') ?? 'active';
  const q = query.get('q') ?? '';
  const [all, list] = await Promise.all([api.listOrders(), api.listOrders({ status, q })]);
  const countFor = (s: string) => (s ? all.filter((o) => (s === 'active' ? ['awaiting_confirmation', 'accepted', 'packed', 'ready_for_pickup', 'in_transit'].includes(o.status) : s === 'issues' ? ['cancelled', 'rejected', 'return_requested', 'returned'].includes(o.status) : o.status === s)).length : all.length);
  const { rows: shown, info } = paginate(list, query);
  const canAct = seller.status === 'approved';

  root.innerHTML = html`
    ${pageHeader('Orders', 'Your part of each customer order. Other sellers’ items in the same checkout are not shown.')}
    ${tabs(TABS.map(([s, l]) => ({ href: `/seller/orders?status=${s}`, label: l, count: countFor(s), active: s === status })), 'Filter orders')}
    <form class="toolbar" role="search" data-role="filters">
      <div class="search">
        ${icon('search', 16)}
        <label class="sr-only" for="oq">Search orders</label>
        <input id="oq" name="q" type="search" placeholder="Order ID or customer first name" value="${q}" />
      </div>
    </form>
    ${shown.length
      ? html`<div class="table-block"><div class="table-wrap"><table class="table">
          <caption class="sr-only">Orders</caption>
          <thead><tr><th scope="col">Order</th><th scope="col">Placed</th><th scope="col">Slot</th><th scope="col">Customer</th><th scope="col">Items</th><th scope="col" class="num">Value</th><th scope="col">Payment</th><th scope="col">Status</th><th scope="col"><span class="sr-only">Actions</span></th></tr></thead>
          <tbody>${shown.map((o) => row(o, canAct))}</tbody>
        </table></div>${pager(info, 'orders')}</div>`
      : emptyState(status === 'awaiting_confirmation' ? 'No orders to confirm' : 'No orders here', status === 'awaiting_confirmation' ? 'New orders appear here first. You’ll also get a notification.' : 'Try another tab or clear your search.')}
  `.value;

  let t: ReturnType<typeof setTimeout>;
  on(root, 'input', '#oq', (_e, el) => {
    clearTimeout(t);
    t = setTimeout(() => {
      setQuery({ q: (el as HTMLInputElement).value.trim() || undefined, page: undefined });
      refresh();
    }, 300);
  });
  on(root, 'submit', '[data-role=filters]', (e) => e.preventDefault());
  bindPager(root, refresh);
  on(root, 'click', '[data-action=accept]', async (_e, el) => {
    (el as HTMLButtonElement).disabled = true;
    try {
      await api.transitionOrder(el.dataset.id!, 'accepted');
      toast(`Order ${el.dataset.id} accepted. The customer has been notified.`);
      refresh();
    } catch (err) {
      (el as HTMLButtonElement).disabled = false;
      toast((err as Error).message, 'error');
    }
  });
};

function row(o: SubOrder, canAct: boolean) {
  const value = o.items.reduce((s, i) => s + (i.unavailable ? 0 : i.qty * i.unitPrice), 0) - o.discountAllocation;
  return html`<tr>
    <td><a class="mono" href="#/seller/orders/${o.id}">${o.id}</a>${o.otherSellerCount ? html`<span class="muted small block" data-tip="This checkout also included items from ${o.otherSellerCount} other seller(s). Their details are private.">Multi-seller order</span>` : ''}</td>
    <td><time datetime="${o.placedAt}" title="${fmtDate(o.placedAt, true)}">${timeAgo(o.placedAt)}</time></td>
    <td>${o.deliverySlot}</td>
    <td>${o.customer.firstName}<span class="muted small block">${o.customer.area}</span></td>
    <td>${o.items.filter((i) => !i.unavailable).reduce((s, i) => s + i.qty, 0)}</td>
    <td class="num">${money(value)}</td>
    <td>${o.paymentMethod === 'cod' ? (o.paymentStatus === 'paid' ? badge('COD · collected', 'green') : badge('COD', 'neutral')) : o.paymentStatus === 'paid' ? badge('Paid', 'green') : o.paymentStatus === 'refund_pending' ? badge('Refund pending', 'amber') : badge('Refunded', 'neutral')}</td>
    <td>${orderBadge(o.status)}</td>
    <td class="actions">
      ${o.status === 'awaiting_confirmation' && canAct ? html`<button type="button" class="btn btn-sm btn-primary" data-action="accept" data-id="${o.id}">Accept</button>` : ''}
      <a class="btn btn-sm btn-ghost" href="#/seller/orders/${o.id}">Details</a>
    </td>
  </tr>`;
}

export default page;
