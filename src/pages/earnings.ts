// /seller/earnings — transparent breakdown from gross sales to net payable.

import type { Page } from '../router.js';
import { setQuery } from '../router.js';
import { html, on, download } from '../ui/dom.js';
import { pageHeader, settlementBadge, emptyState, icon, mockNote, callout } from '../ui/components.js';
import { breakdownBars } from '../ui/charts.js';
import { toast } from '../ui/overlay.js';
import * as api from '../api.js';
import { money2, fmtDate, toCsv } from '../lib.js';
import { round2 } from '../data/seed.js';

const RANGES: [string, string][] = [
  ['30', 'Last 30 days'],
  ['90', 'Last 90 days'],
  ['all', 'All time'],
];

const page: Page = async ({ root, query, refresh }) => {
  const range = query.get('range') ?? '30';
  const [ledgerAll, rules] = await Promise.all([api.getLedger(), api.getCommissionRules()]);
  const since = range === 'all' ? 0 : Date.now() - Number(range) * 86_400_000;
  const ledger = ledgerAll.filter((l) => new Date(l.date).getTime() >= since);

  const sum = (k: 'gross' | 'discount' | 'commission' | 'deliveryAdjustment' | 'refund' | 'hold' | 'net') => round2(ledger.reduce((s, l) => s + l[k], 0));
  const t = { gross: sum('gross'), discount: sum('discount'), commission: sum('commission'), delivery: sum('deliveryAdjustment'), refund: sum('refund'), hold: sum('hold'), net: sum('net') };
  const recomputed = round2(t.gross - t.discount - t.commission + t.delivery - t.refund - t.hold);
  const reconciles = Math.abs(recomputed - t.net) < 0.05;
  const badRows = ledger.filter((l) => Math.abs(round2(l.gross - l.discount - l.commission + l.deliveryAdjustment - l.refund - l.hold) - l.net) >= 0.05);

  root.innerHTML = html`
    ${pageHeader(
      'Earnings',
      'How each delivered order turns into your payout. Figures come from the platform’s financial ledger.',
      html`${mockNote()}
        <label class="sr-only" for="erange">Period</label>
        <select id="erange" class="select-inline">${RANGES.map(([v, l]) => html`<option value="${v}" ${v === range ? 'selected' : ''}>${l}</option>`)}</select>
        <button type="button" class="btn" data-action="export">${icon('download', 16)} Export CSV</button>`,
    )}

    <div class="grid-main">
      <section class="card" aria-labelledby="bd-h">
        <div class="card-head"><h2 id="bd-h" class="card-title">Breakdown</h2><span class="muted small">${ledger.length} ledger entr${ledger.length === 1 ? 'y' : 'ies'}</span></div>
        ${breakdownBars([
          { label: 'Gross sales', value: t.gross, tone: 'pos' },
          { label: 'Discount allocation', value: t.discount, tone: 'neg' },
          { label: 'Platform commission', value: t.commission, tone: 'neg' },
          { label: 'Delivery adjustments', value: t.delivery, tone: t.delivery < 0 ? 'neg' : 'pos' },
          { label: 'Refunds / returns', value: t.refund, tone: 'neg' },
          { label: 'Holds', value: t.hold, tone: 'hold' },
          { label: 'Net payable', value: t.net, tone: 'net' },
        ])}
        <p class="formula small">Net payable = gross − discounts − commission ± delivery adjustments − refunds − holds</p>
        ${reconciles && !badRows.length
          ? html`<p class="small ok-text">${icon('check', 14)} Totals reconcile: ${money2(recomputed)} recomputed = ${money2(t.net)} ledger net.</p>`
          : callout('error', 'Totals don’t reconcile', `${badRows.length} entr${badRows.length === 1 ? 'y doesn’t' : 'ies don’t'} match the formula. Contact seller support with this export.`)}
      </section>

      <section class="card" aria-labelledby="cr-h">
        <h2 id="cr-h" class="card-title">Commission rates</h2>
        <p class="muted small">Set by the marketplace per category. You can’t edit these; changes are announced in advance and apply only to new orders.</p>
        <table class="table table-compact">
          <thead><tr><th scope="col">Category</th><th scope="col" class="num">Rate</th></tr></thead>
          <tbody>${rules.map((r) => html`<tr><td>${r.category}</td><td class="num">${r.ratePct}%</td></tr>`)}</tbody>
        </table>
        <p class="muted small">Commission is charged on item value after discounts. Each ledger entry keeps the rate applied at the time of the order.</p>
      </section>
    </div>

    <section class="card" aria-labelledby="led-h">
      <div class="card-head"><h2 id="led-h" class="card-title">Ledger</h2><a class="link" href="#/seller/settlements">View settlements</a></div>
      ${ledger.length
        ? html`<div class="table-wrap"><table class="table table-compact">
            <thead><tr>
              <th scope="col">Date</th><th scope="col">Order</th><th scope="col" class="num">Gross</th><th scope="col" class="num">Discount</th>
              <th scope="col" class="num">Commission</th><th scope="col" class="num">Delivery</th><th scope="col" class="num">Refund</th>
              <th scope="col" class="num">Hold</th><th scope="col" class="num">Net</th><th scope="col">State</th>
            </tr></thead>
            <tbody>${ledger.slice(0, 100).map(
              (l) => html`<tr>
                <td class="nowrap">${fmtDate(l.date)}</td>
                <td><a class="mono small" href="#/seller/orders/${l.subOrderId}">${l.subOrderId}</a>${l.id.endsWith('-R') ? html` <span class="muted small">reversal</span>` : ''}</td>
                <td class="num">${money2(l.gross)}</td>
                <td class="num">${l.discount ? `−${money2(l.discount)}` : '—'}</td>
                <td class="num" title="${l.commissionRate}% effective rate">${l.commission ? `${l.commission < 0 ? '+' : '−'}${money2(Math.abs(l.commission))}` : '—'}</td>
                <td class="num">${l.deliveryAdjustment ? money2(l.deliveryAdjustment) : '—'}</td>
                <td class="num">${l.refund ? `−${money2(l.refund)}` : '—'}</td>
                <td class="num">${l.hold ? `−${money2(l.hold)}` : '—'}</td>
                <td class="num"><strong>${money2(l.net)}</strong></td>
                <td>${settlementBadge(l.state)}</td>
              </tr>`,
            )}</tbody></table></div>
            ${ledger.length > 100 ? html`<p class="muted small">Showing the latest 100 of ${ledger.length}. Export CSV for the full list.</p>` : ''}`
        : emptyState('No earnings in this period', 'Earnings appear once orders are delivered.')}
      <details class="defs">
        <summary>What do the states mean?</summary>
        <dl>
          <div><dt>Pending</dt><dd>Delivered less than 7 days ago (return window open) or under a hold.</dd></div>
          <div><dt>Eligible</dt><dd>Ready to be included in the next settlement.</dd></div>
          <div><dt>Processing</dt><dd>Included in a settlement that is being paid out.</dd></div>
          <div><dt>Paid</dt><dd>Settled, with a recorded transaction reference.</dd></div>
          <div><dt>Failed</dt><dd>The transfer failed; the amount returns to eligible.</dd></div>
          <div><dt>Reversed</dt><dd>Clawed back after a refund or return.</dd></div>
        </dl>
      </details>
    </section>`.value;

  on(root, 'change', '#erange', (_e, el) => {
    setQuery({ range: (el as HTMLSelectElement).value });
    refresh();
  });
  on(root, 'click', '[data-action=export]', () => {
    const rows: (string | number)[][] = [['date', 'sub_order', 'gross', 'discount', 'commission_rate_pct', 'commission', 'delivery_adjustment', 'refund', 'hold', 'net', 'state', 'settlement']];
    for (const l of ledger) rows.push([l.date.slice(0, 10), l.subOrderId, l.gross, l.discount, l.commissionRate, l.commission, l.deliveryAdjustment, l.refund, l.hold, l.net, l.state, l.settlementId ?? '']);
    download(`earnings-${range}-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(rows));
    toast('Exported ledger to CSV');
  });
};

export default page;
