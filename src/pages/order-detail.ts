// /seller/orders/:id — fulfil a single sub-order.

import type { Page } from '../router.js';
import { html, raw, on, EMBEDDED, type Raw } from '../ui/dom.js';
import { pageHeader, orderBadge, emptyState, icon, callout, badge } from '../ui/components.js';
import { toast, confirmDialog } from '../ui/overlay.js';
import * as api from '../api.js';
import { money, money2, fmtDate, ORDER_STATUS_LABEL, FULFILMENT_FLOW, SELLER_TRANSITIONS } from '../lib.js';
import type { OrderStatus, SubOrder } from '../types.js';

const ACTION_LABEL: Partial<Record<OrderStatus, string>> = {
  accepted: 'Accept order',
  packed: 'Mark as packed',
  ready_for_pickup: 'Ready for pickup',
  rejected: 'Reject',
  cancelled: 'Cancel order',
};

const page: Page = async ({ root, params, seller, refresh }) => {
  let o: SubOrder;
  try {
    o = await api.getOrder(params.id!);
  } catch (e) {
    if (e instanceof api.ApiError && e.status === 404) {
      root.innerHTML = emptyState('Order not found', 'This order doesn’t exist or belongs to another seller.', html`<a class="btn btn-primary" href="#/seller/orders">Back to orders</a>`).value;
      return;
    }
    throw e;
  }
  const canAct = seller.status === 'approved';
  const live = o.items.filter((i) => !i.unavailable);
  const gross = live.reduce((s, i) => s + i.qty * i.unitPrice, 0);
  const next = SELLER_TRANSITIONS[o.status] ?? [];
  const forward = next.filter((s) => s !== 'rejected' && s !== 'cancelled');
  const negative = next.filter((s) => s === 'rejected' || s === 'cancelled');
  const stepIdx = FULFILMENT_FLOW.indexOf(o.status);
  const offFlow = stepIdx < 0;
  const canMarkUnavailable = canAct && ['awaiting_confirmation', 'accepted'].includes(o.status) && live.length > 1;

  const placedMs = new Date(o.placedAt).getTime();
  const deadline = placedMs + seller.fulfilment.acceptWindowMins * 60_000;
  const minsLeft = Math.round((deadline - Date.now()) / 60_000);

  root.innerHTML = html`
    ${pageHeader(`Order ${o.id}`, `Placed ${fmtDate(o.placedAt, true)} · delivery slot ${o.deliverySlot}`, html`${orderBadge(o.status)}${EMBEDDED ? '' : html`<button type="button" class="btn btn-sm" data-action="print">Print packing slip</button>`}`, { href: '/seller/orders', label: 'Orders' })}
    ${o.status === 'awaiting_confirmation'
      ? callout(minsLeft > 0 ? 'warn' : 'error', minsLeft > 0 ? `Confirm within ${minsLeft} min` : 'Confirmation window has passed', minsLeft > 0 ? 'Unconfirmed orders may be auto-cancelled by the platform and count towards your cancellation rate.' : 'The platform may auto-cancel this order. Accept now if you can still fulfil it.')
      : ''}
    ${o.otherSellerCount ? callout('info', 'Part of a multi-seller checkout', `The customer’s order ${o.parentOrderId} includes items from ${o.otherSellerCount} other seller(s). You only see and fulfil your own items; the platform coordinates delivery.`) : ''}

    <section class="card">
      <h2 class="sr-only">Progress</h2>
      ${offFlow
        ? html`<p><strong>${ORDER_STATUS_LABEL[o.status]}</strong>${o.reason ? html` — ${o.reason}` : ''}</p>`
        : html`<ol class="progress">
            ${FULFILMENT_FLOW.map((s, i) => html`<li class="${i < stepIdx ? 'done' : i === stepIdx ? 'current' : ''}" ${i === stepIdx ? raw('aria-current="step"') : ''}><span class="pdot" aria-hidden="true">${i < stepIdx ? icon('check', 12) : ''}</span><span>${ORDER_STATUS_LABEL[s]}</span></li>`)}
          </ol>
          <p class="muted small">In transit and delivered are updated by the delivery partner.</p>`}
    </section>

    <div class="grid-main order-layout">
      <div class="stack">
        <section class="card">
          <h2 class="card-title">Items</h2>
          <div class="table-wrap"><table class="table">
            <thead><tr><th scope="col">Item</th><th scope="col">SKU</th><th scope="col" class="num">Qty</th><th scope="col" class="num">Unit price</th><th scope="col" class="num">Total</th>${canMarkUnavailable ? html`<th scope="col"><span class="sr-only">Actions</span></th>` : ''}</tr></thead>
            <tbody>
              ${o.items.map(
                (i) => html`<tr class="${i.unavailable ? 'struck' : ''}">
                  <td>${i.name} <span class="muted">· ${i.variantLabel}</span>${i.unavailable ? html` ${badge('Unavailable', 'red')}` : ''}</td>
                  <td class="mono small">${i.sku}</td>
                  <td class="num">${i.qty}</td>
                  <td class="num">${money(i.unitPrice)}</td>
                  <td class="num">${money(i.qty * i.unitPrice)}</td>
                  ${canMarkUnavailable ? html`<td class="actions">${i.unavailable ? '' : html`<button type="button" class="btn btn-sm btn-ghost" data-action="unavailable" data-sku="${i.sku}">Mark unavailable</button>`}</td>` : ''}
                </tr>`,
              )}
            </tbody>
          </table></div>
          <dl class="totals">
            <div><dt>Items total</dt><dd>${money2(gross)}</dd></div>
            ${o.discountAllocation ? html`<div><dt data-tip="Your share of the customer’s coupon, allocated by the platform in proportion to item value.">Discount allocation</dt><dd>−${money2(o.discountAllocation)}</dd></div>` : ''}
            <div class="total"><dt>Sub-order value</dt><dd>${money2(gross - o.discountAllocation)}</dd></div>
          </dl>
          <p class="muted small">Commission and your net payout for this order are shown on the <a href="#/seller/earnings">Earnings</a> page once it is delivered.</p>
        </section>

        <section class="card">
          <h2 class="card-title">Status history</h2>
          <ol class="timeline">
            ${[...o.history].reverse().map(
              (h) => html`<li>
                <span class="tl-dot" aria-hidden="true"></span>
                <div><strong>${ORDER_STATUS_LABEL[h.status]}</strong> <span class="muted small">· ${h.actor}</span>
                ${h.note ? html`<p class="small">${h.note}</p>` : ''}
                <time class="muted small" datetime="${h.at}">${fmtDate(h.at, true)}</time></div>
              </li>`,
            )}
          </ol>
        </section>
      </div>

      <div class="stack">
        ${actionsCard(o, canAct, forward, negative)}
        <section class="card">
          <h2 class="card-title">Delivery</h2>
          <dl class="kv">
            <div><dt>Customer</dt><dd>${o.customer.firstName}</dd></div>
            <div><dt>Area</dt><dd>${o.customer.area}</dd></div>
            <div><dt>Address</dt><dd>${o.customer.address}</dd></div>
            <div><dt>Phone</dt><dd>${o.customer.phoneMasked}</dd></div>
            ${o.customer.instructions ? html`<div><dt>Instructions</dt><dd>${o.customer.instructions}</dd></div>` : ''}
            <div><dt>Slot</dt><dd>${o.deliverySlot}</dd></div>
          </dl>
          <p class="muted small">${icon('shield', 13)} Only the details needed to fulfil this order are shared, and only while it is in progress.</p>
        </section>
        <section class="card">
          <h2 class="card-title">Payment</h2>
          <dl class="kv">
            <div><dt>Method</dt><dd>${o.paymentMethod === 'cod' ? 'Cash on delivery' : 'Online (prepaid)'}</dd></div>
            <div><dt>Status</dt><dd>${paymentLabel(o)}</dd></div>
          </dl>
          <p class="muted small">Payment and refund status are set by the payment workflow. Sellers can’t mark orders paid or issue refunds.</p>
        </section>
      </div>
    </div>`.value;

  on(root, 'click', '[data-action=print]', () => window.print());

  on(root, 'click', '[data-to]', async (_e, el) => {
    const to = el.dataset.to as OrderStatus;
    let note = '';
    if (to === 'rejected' || to === 'cancelled') {
      const c = await confirmDialog({
        title: to === 'rejected' ? 'Reject this order?' : 'Cancel this order?',
        message: `The customer is notified and ${o.paymentMethod === 'online' ? 'a refund is requested from the payment workflow' : 'no payment is collected'}. Reserved stock goes back to inventory. This counts towards your cancellation rate.`,
        confirmLabel: to === 'rejected' ? 'Reject order' : 'Cancel order',
        danger: true,
        reasonLabel: 'Reason (shared with the customer)',
        reasonRequired: true,
      });
      if (!c.ok) return;
      note = c.reason;
    }
    (el as HTMLButtonElement).disabled = true;
    try {
      await api.transitionOrder(o.id, to, note);
      toast(`Order ${ORDER_STATUS_LABEL[to].toLowerCase()}. The customer has been notified.`);
      refresh();
    } catch (err) {
      (el as HTMLButtonElement).disabled = false;
      toast((err as Error).message, 'error');
    }
  });

  on(root, 'click', '[data-action=unavailable]', async (_e, el) => {
    const item = o.items.find((i) => i.sku === el.dataset.sku)!;
    const c = await confirmDialog({
      title: 'Mark item unavailable?',
      message: `${item.qty} × ${item.name} (${item.variantLabel}) will be removed from this order. The customer is notified and the platform refunds that amount. Stock is returned to inventory.`,
      confirmLabel: 'Mark unavailable',
      danger: true,
    });
    if (!c.ok) return;
    try {
      await api.markItemUnavailable(o.id, item.sku);
      toast('Item marked unavailable');
      refresh();
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  });

  on(root, 'click', '[data-action=sim-delivery]', async () => {
    try {
      const u = await api._demoAdvanceDelivery(o.id);
      toast(`Delivery partner: ${ORDER_STATUS_LABEL[u.status]}`, 'info');
      refresh();
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  });
};

function actionsCard(o: SubOrder, canAct: boolean, forward: OrderStatus[], negative: OrderStatus[]): Raw {
  const sim = o.status === 'ready_for_pickup' || o.status === 'in_transit';
  if (!forward.length && !negative.length && !sim) return html``;
  return html`<section class="card card-accent">
    <h2 class="card-title">Next step</h2>
    ${!canAct && (forward.length || negative.length) ? html`<p class="muted small">Order actions are unavailable while your account is not approved.</p>` : ''}
    <div class="stack-sm">
      ${forward.map((s) => html`<button type="button" class="btn btn-primary btn-block" data-to="${s}" ${canAct ? '' : raw('disabled')}>${ACTION_LABEL[s] ?? s}</button>`)}
      ${negative.map((s) => html`<button type="button" class="btn btn-danger-ghost btn-block" data-to="${s}" ${canAct ? '' : raw('disabled')}>${ACTION_LABEL[s] ?? s}</button>`)}
      ${sim
        ? html`<p class="muted small">${o.status === 'ready_for_pickup' ? 'Waiting for the delivery partner to collect.' : 'Out for delivery.'}</p>
          <button type="button" class="btn btn-block proto-action" data-action="sim-delivery">${icon('flask', 14)} Simulate ${o.status === 'ready_for_pickup' ? 'courier pickup' : 'delivery'}</button>`
        : ''}
    </div>
  </section>`;
}

function paymentLabel(o: SubOrder) {
  switch (o.paymentStatus) {
    case 'paid':
      return badge(o.paymentMethod === 'cod' ? 'Collected' : 'Paid', 'green');
    case 'cod_pending':
      return badge('To be collected on delivery', 'neutral');
    case 'refund_pending':
      return badge('Refund pending (platform)', 'amber');
    case 'partially_refunded':
      return badge('Partially refunded', 'neutral');
    default:
      return badge('Refunded', 'neutral');
  }
}

export default page;
