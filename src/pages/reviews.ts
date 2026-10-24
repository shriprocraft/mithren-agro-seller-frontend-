// /seller/reviews — verified-purchase reviews, replies and performance.

import type { Page } from '../router.js';
import { setQuery } from '../router.js';
import { html, on } from '../ui/dom.js';
import { pageHeader, emptyState, stars, mockNote, badge } from '../ui/components.js';
import { ratingBars } from '../ui/charts.js';
import { toast, confirmDialog } from '../ui/overlay.js';
import * as api from '../api.js';
import { fmtDate } from '../lib.js';

const page: Page = async ({ root, query, seller, refresh }) => {
  const filter = query.get('filter') ?? '';
  const [reviews, products, orders] = await Promise.all([api.listReviews(), api.listProducts({ includeArchived: true }), api.listOrders()]);
  const pname = (id: string) => products.find((p) => p.id === id)?.name ?? 'Product';
  const total = reviews.length;
  const avg = total ? reviews.reduce((s, r) => s + r.rating, 0) / total : 0;
  const dist = [1, 2, 3, 4, 5].map((n) => reviews.filter((r) => r.rating === n).length);
  const replied = reviews.filter((r) => r.reply).length;
  const shown = reviews.filter((r) => (filter === 'unanswered' ? !r.reply : filter === 'critical' ? r.rating <= 3 : true));

  const finished = orders.filter((o) => ['delivered', 'cancelled', 'rejected', 'returned', 'return_requested'].includes(o.status));
  const delivered = orders.filter((o) => o.status === 'delivered').length;
  const fulfilment = finished.length ? delivered / finished.length : 0;
  const sellerCancels = orders.filter((o) => o.status === 'rejected' || (o.status === 'cancelled' && o.history.some((h) => h.status === 'cancelled' && h.actor.includes('seller')))).length;
  const canReply = seller.status === 'approved';

  root.innerHTML = html`
    ${pageHeader('Reviews & performance', 'Only customers who received an order from you can leave a review.', mockNote())}
    <div class="grid-main">
      <section class="card" aria-labelledby="rs-h">
        <h2 id="rs-h" class="card-title">Rating summary</h2>
        ${total
          ? html`<div class="rating-summary">
              <div class="rating-big"><span>${avg.toFixed(1)}</span>${stars(avg, 18)}<span class="muted small">${total} reviews</span></div>
              ${ratingBars(dist, total)}
            </div>`
          : html`<p class="muted">No reviews yet.</p>`}
      </section>
      <section class="card" aria-labelledby="pf-h">
        <h2 id="pf-h" class="card-title">Performance</h2>
        <dl class="kv">
          <div><dt data-tip="Delivered orders as a share of all completed, cancelled, rejected or returned orders.">Fulfilment rate</dt><dd>${(fulfilment * 100).toFixed(1)}%</dd></div>
          <div><dt data-tip="Orders you rejected or cancelled.">Seller cancellations</dt><dd>${sellerCancels}</dd></div>
          <div><dt>Reply rate</dt><dd>${total ? Math.round((replied / total) * 100) : 0}%</dd></div>
          <div><dt>Acceptance window</dt><dd>${seller.fulfilment.acceptWindowMins} min</dd></div>
        </dl>
      </section>
    </div>

    <nav class="tabs" aria-label="Filter reviews">
      ${[['', 'All', total], ['unanswered', 'Needs reply', total - replied], ['critical', '3★ and below', reviews.filter((r) => r.rating <= 3).length]].map(
        ([f, l, c]) => html`<button type="button" class="tab ${f === filter ? 'active' : ''}" data-filter="${f}" aria-pressed="${f === filter}">${l} <span class="tab-count">${c}</span></button>`,
      )}
    </nav>

    ${shown.length
      ? html`<ul class="review-list">${shown.map(
          (r) => html`<li class="card review">
            <div class="review-head">
              ${stars(r.rating)}
              <strong>${r.title}</strong>
              ${r.reported ? badge('Reported', 'amber') : ''}
            </div>
            <p>${r.body}</p>
            <p class="muted small">${r.customerFirstName} · ${pname(r.productId)} · ${fmtDate(r.date)} · <span class="ok-text">Verified purchase</span> (<a href="#/seller/orders/${r.subOrderId}">${r.subOrderId}</a>)</p>
            ${r.reply
              ? html`<div class="reply"><strong>Your reply</strong> <span class="muted small">· ${fmtDate(r.reply.at)}</span><p>${r.reply.body}</p></div>`
              : canReply
                ? html`<form class="reply-form" data-id="${r.id}" novalidate>
                    <label class="sr-only" for="reply-${r.id}">Reply to ${r.customerFirstName}</label>
                    <textarea id="reply-${r.id}" name="body" rows="2" maxlength="600" placeholder="Write a public reply…"></textarea>
                    <p class="field-error" hidden></p>
                    <div class="row-wrap">
                      <button type="submit" class="btn btn-sm btn-primary">Post reply</button>
                      ${r.reported ? '' : html`<button type="button" class="btn btn-sm btn-ghost" data-action="report" data-id="${r.id}">Report review</button>`}
                    </div>
                  </form>`
                : ''}
          </li>`,
        )}</ul>`
      : emptyState('No reviews here', filter ? 'Nothing matches this filter.' : 'Reviews from customers will appear here.')}`.value;

  on(root, 'click', '[data-filter]', (_e, el) => {
    setQuery({ filter: el.dataset.filter || undefined });
    refresh();
  });
  on(root, 'submit', '.reply-form', async (e, form) => {
    e.preventDefault();
    const ta = form.querySelector('textarea')!;
    const err = form.querySelector('.field-error') as HTMLElement;
    const btn = form.querySelector('[type=submit]') as HTMLButtonElement;
    btn.disabled = true;
    try {
      await api.replyToReview(form.dataset.id!, ta.value);
      toast('Reply posted');
      refresh();
    } catch (ex) {
      const ae = ex as api.ApiError;
      err.textContent = ae.fieldErrors?.body ?? ae.message;
      err.hidden = false;
      ta.setAttribute('aria-invalid', 'true');
      ta.focus();
      btn.disabled = false;
    }
  });
  on(root, 'click', '[data-action=report]', async (_e, el) => {
    const c = await confirmDialog({ title: 'Report this review?', message: 'Our moderation team will check it against the review guidelines (e.g. abusive language, unrelated content). Reviews are not removed just for being negative.', confirmLabel: 'Report' });
    if (!c.ok) return;
    await api.reportReview(el.dataset.id!);
    toast('Review reported to moderation');
    refresh();
  });
};

export default page;
