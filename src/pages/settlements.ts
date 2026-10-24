// /seller/settlements — settlement history and (if enabled) payout requests.

import type { Page } from '../router.js';
import { html, raw, on } from '../ui/dom.js';
import { pageHeader, settlementBadge, emptyState, icon, mockNote, callout, badge, field, showFieldErrors } from '../ui/components.js';
import { toast, modal } from '../ui/overlay.js';
import * as api from '../api.js';
import { money2, fmtDate } from '../lib.js';
import { round2 } from '../data/seed.js';
import type { Settlement } from '../types.js';

const page: Page = async ({ root, seller, refresh }) => {
  const [settlements, ledger, requests] = await Promise.all([api.listSettlements(), api.getLedger(), api.listPayoutRequests()]);
  const eligible = round2(ledger.filter((l) => l.state === 'eligible' && !l.settlementId).reduce((s, l) => s + l.net, 0));
  const pending = round2(ledger.filter((l) => l.state === 'pending').reduce((s, l) => s + l.net + l.hold, 0));
  const processing = round2(settlements.filter((s) => s.state === 'processing').reduce((s, x) => s + x.amount, 0));
  const paid = round2(settlements.filter((s) => s.state === 'paid').reduce((s, x) => s + x.amount, 0));
  const openReq = round2(requests.filter((r) => r.state === 'requested').reduce((s, r) => s + r.amount, 0));
  const failed = settlements.filter((s) => s.state === 'failed');

  root.innerHTML = html`
    ${pageHeader(
      'Settlements',
      'Payouts to your bank account. A settlement is shown as paid only once a transaction reference is recorded.',
      html`${mockNote()}${seller.payoutRequestsEnabled && seller.status === 'approved' ? html`<button type="button" class="btn btn-primary" data-action="request" ${eligible - openReq >= 500 ? '' : raw('disabled')}>Request payout</button>` : ''}`,
    )}
    ${failed.length ? callout('error', `${failed.length} settlement${failed.length > 1 ? 's' : ''} failed`, failed[0]!.failureReason ?? 'The bank rejected the transfer. The amount has returned to eligible and will be retried.') : ''}

    <div class="metrics metrics-4">
      ${tile('Pending', pending, 'In the 7-day return window or on hold. Not yet payable.')}
      ${tile('Eligible', eligible, 'Ready for the next settlement run' + (openReq ? ` (${money2(openReq)} already requested)` : '') + '.')}
      ${tile('Processing', processing, 'Included in a settlement currently being transferred.')}
      ${tile('Paid (all time)', paid, 'Settlements with a recorded bank transaction reference.')}
    </div>

    <section class="card">
      <div class="card-head"><h2 class="card-title">Payout schedule</h2></div>
      <dl class="kv kv-inline">
        <div><dt>Bank account</dt><dd>${seller.bank.accountName} · ••••${seller.bank.last4} · ${seller.bank.ifsc} ${seller.bank.verified ? badge('Verified', 'green') : badge('Verification pending', 'amber')}</dd></div>
        <div><dt>Cycle</dt><dd>Weekly, for entries eligible by Sunday</dd></div>
        <div><dt>Method</dt><dd>Manual bank transfer with UTR reference <span class="muted small">(automated payouts need a configured payout provider)</span></dd></div>
        <div><dt>Payout requests</dt><dd>${seller.payoutRequestsEnabled ? 'Enabled — minimum ₹500, reviewed by the platform' : 'Not enabled for your account'}</dd></div>
      </dl>
      <p class="muted small">To change bank details, upload new bank proof on <a href="#/seller/documents">Documents</a>. Changes are re-verified before the next payout.</p>
    </section>

    <section class="card" aria-labelledby="st-h">
      <h2 id="st-h" class="card-title">Settlement history</h2>
      ${settlements.length
        ? html`<div class="table-wrap"><table class="table">
            <thead><tr><th scope="col">Settlement</th><th scope="col">Period</th><th scope="col" class="num">Orders</th><th scope="col" class="num">Amount</th><th scope="col">State</th><th scope="col">Reference</th><th scope="col">Paid on</th></tr></thead>
            <tbody>${settlements.map(row)}</tbody></table></div>`
        : emptyState('No settlements yet', 'Your first settlement runs after your first orders clear the return window.')}
    </section>

    ${requests.length
      ? html`<section class="card" aria-labelledby="pr-h">
          <h2 id="pr-h" class="card-title">Payout requests</h2>
          <div class="table-wrap"><table class="table table-compact">
            <thead><tr><th scope="col">Request</th><th scope="col">Requested</th><th scope="col" class="num">Amount</th><th scope="col">Status</th><th scope="col">Note</th></tr></thead>
            <tbody>${requests.map((r) => html`<tr><td class="mono small">${r.id}</td><td>${fmtDate(r.requestedAt)}</td><td class="num">${money2(r.amount)}</td><td>${r.state === 'requested' ? badge('Awaiting review', 'amber') : r.state === 'paid' ? badge('Paid', 'green') : r.state === 'approved' ? badge('Approved', 'blue') : badge('Rejected', 'red')}</td><td class="muted">${r.note ?? '—'}</td></tr>`)}</tbody>
          </table></div>
        </section>`
      : ''}`.value;

  on(root, 'click', '[data-action=request]', () => {
    const max = round2(eligible - openReq);
    modal({
      title: 'Request a payout',
      body: html`<form class="stack" novalidate>
        <p>You can request up to <strong>${money2(max)}</strong> from your eligible balance. The platform reviews requests and pays them with the next transfer batch.</p>
        ${field({ name: 'amount', label: 'Amount (₹)', type: 'number', value: Math.floor(max), required: true, attrs: `min="500" max="${max}" step="0.01" inputmode="decimal" autofocus` })}
        <p class="form-error" role="alert" hidden></p>
        <div class="modal-actions"><button type="button" class="btn" data-close>Cancel</button><button type="submit" class="btn btn-primary">Submit request</button></div>
      </form>`,
      onMount(el, close) {
        const form = el.querySelector('form')!;
        form.addEventListener('submit', async (e) => {
          e.preventDefault();
          const btn = form.querySelector('[type=submit]') as HTMLButtonElement;
          btn.disabled = true;
          const errBox = form.querySelector('.form-error') as HTMLElement;
          try {
            await api.requestPayout(Number(new FormData(form).get('amount')));
            toast('Payout request submitted for review');
            close();
            refresh();
          } catch (ex) {
            const ae = ex as api.ApiError;
            errBox.textContent = ae.message;
            errBox.hidden = false;
            if (ae.fieldErrors) showFieldErrors(form, ae.fieldErrors);
            btn.disabled = false;
          }
        });
      },
    });
  });
};

function tile(label: string, value: number, def: string) {
  return html`<div class="metric">
    <div class="metric-label"><span>${label}</span><button type="button" class="info-btn" aria-label="About ${label}" data-tip="${def}">${icon('info', 14)}</button></div>
    <div class="metric-value">${money2(value)}</div>
  </div>`;
}

function row(s: Settlement) {
  // Never display paid without a recorded reference.
  const state = s.state === 'paid' && !s.reference ? 'processing' : s.state;
  return html`<tr>
    <td class="mono small">${s.id}</td>
    <td class="nowrap">${fmtDate(s.periodStart)} – ${fmtDate(s.periodEnd)}</td>
    <td class="num">${s.entryIds.length}</td>
    <td class="num"><strong>${money2(s.amount)}</strong></td>
    <td>${settlementBadge(state)}${s.failureReason ? html`<span class="block small error-text">${s.failureReason}</span>` : ''}</td>
    <td class="mono small">${s.reference ?? '—'}</td>
    <td class="nowrap">${s.paidAt && s.reference ? fmtDate(s.paidAt) : '—'}</td>
  </tr>`;
}

export default page;
