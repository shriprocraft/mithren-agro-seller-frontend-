// /seller/earnings — transparent breakdown from gross sales to net payable.

import type { Page } from '../router.js';
import { setQuery } from '../router.js';
import { html, raw, on } from '../ui/dom.js';
import { pageHeader, settlementBadge, emptyState, icon, callout, paginate, pager, bindPager } from '../ui/components.js';
import { breakdownBars } from '../ui/charts.js';
import { saveFile } from '../ui/overlay.js';
import * as api from '../api.js';
import { money2, fmtDate, toCsv, SETTLEMENT_LABEL } from '../lib.js';
import { round2 } from '../data/seed.js';
import type { LedgerEntry } from '../api.js';

const RANGES: [string, string][] = [
  ['30', 'Last 30 days'],
  ['90', 'Last 90 days'],
  ['all', 'All time'],
];

/** Amount columns of the ledger that can be filtered by a min/max range. `key` prefixes the query params. */
const AMOUNT_COLUMNS: { key: string; label: string; field: 'gross' | 'discount' | 'commission' | 'deliveryAdjustment' | 'refund' | 'hold' | 'net' }[] = [
  { key: 'gross', label: 'Gross', field: 'gross' },
  { key: 'disc', label: 'Discount', field: 'discount' },
  { key: 'comm', label: 'Commission', field: 'commission' },
  { key: 'deliv', label: 'Delivery', field: 'deliveryAdjustment' },
  { key: 'refund', label: 'Refund', field: 'refund' },
  { key: 'hold', label: 'Hold', field: 'hold' },
  { key: 'net', label: 'Net', field: 'net' },
];
const FILTER_KEYS = ['lq', 'ld_from', 'ld_to', 'lstate', ...AMOUNT_COLUMNS.flatMap((c) => [`${c.key}_min`, `${c.key}_max`])];

const amountParam = (query: URLSearchParams, key: string) => {
  const value = query.get(key);
  if (value === null || value.trim() === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

/** Applies the ledger table filters. Filtering never changes an entry's amounts. */
function filterLedger(entries: LedgerEntry[], query: URLSearchParams) {
  const q = (query.get('lq') ?? '').trim().toLowerCase();
  const from = query.get('ld_from') ?? '';
  const to = query.get('ld_to') ?? '';
  const state = query.get('lstate') ?? '';
  const ranges = AMOUNT_COLUMNS.map((c) => ({ field: c.field, min: amountParam(query, `${c.key}_min`), max: amountParam(query, `${c.key}_max`) })).filter((r) => r.min !== null || r.max !== null);
  return entries.filter((l) => {
    if (q && !l.subOrderId.toLowerCase().includes(q)) return false;
    const day = l.date.slice(0, 10);
    if (from && day < from) return false;
    if (to && day > to) return false;
    if (state && l.state !== state) return false;
    return ranges.every((r) => (r.min === null || l[r.field] >= r.min) && (r.max === null || l[r.field] <= r.max));
  });
}

/** Human-readable chips for each active filter, each with the query keys that clear it. */
function activeFilters(query: URLSearchParams): { label: string; keys: string[] }[] {
  const out: { label: string; keys: string[] }[] = [];
  const q = (query.get('lq') ?? '').trim();
  if (q) out.push({ label: `Order: ${q}`, keys: ['lq'] });
  const from = query.get('ld_from');
  const to = query.get('ld_to');
  if (from || to) out.push({ label: `Date: ${from ? fmtDate(from) : 'any'} – ${to ? fmtDate(to) : 'any'}`, keys: ['ld_from', 'ld_to'] });
  const state = query.get('lstate');
  if (state) out.push({ label: `State: ${SETTLEMENT_LABEL[state as keyof typeof SETTLEMENT_LABEL] ?? state}`, keys: ['lstate'] });
  for (const c of AMOUNT_COLUMNS) {
    const min = amountParam(query, `${c.key}_min`);
    const max = amountParam(query, `${c.key}_max`);
    if (min === null && max === null) continue;
    const range = min !== null && max !== null ? `${money2(min)} – ${money2(max)}` : min !== null ? `≥ ${money2(min)}` : `≤ ${money2(max!)}`;
    out.push({ label: `${c.label}: ${range}`, keys: [`${c.key}_min`, `${c.key}_max`] });
  }
  return out;
}

const page: Page = async ({ root, query, refresh }) => {
  const range = query.get('range') ?? '30';
  const [ledgerAll, rules] = await Promise.all([api.getLedger(), api.getCommissionRules()]);
  const since = range === 'all' ? 0 : Date.now() - Number(range) * 86_400_000;
  const ledger = ledgerAll.filter((l) => new Date(l.date).getTime() >= since);
  // Filters narrow the ledger table only; the breakdown and reconciliation above always use the whole period.
  const shownLedger = filterLedger(ledger, query);
  const { rows: ledgerRows, info: ledgerInfo } = paginate(shownLedger, query, 'led');
  const chips = activeFilters(query);
  const panelOpen = chips.length > 0 || query.get('fopen') === '1';

  const sum = (k: 'gross' | 'discount' | 'commission' | 'deliveryAdjustment' | 'refund' | 'hold' | 'net') => round2(ledger.reduce((s, l) => s + l[k], 0));
  const t = { gross: sum('gross'), discount: sum('discount'), commission: sum('commission'), delivery: sum('deliveryAdjustment'), refund: sum('refund'), hold: sum('hold'), net: sum('net') };
  const recomputed = round2(t.gross - t.discount - t.commission + t.delivery - t.refund - t.hold);
  const reconciles = Math.abs(recomputed - t.net) < 0.05;
  const badRows = ledger.filter((l) => Math.abs(round2(l.gross - l.discount - l.commission + l.deliveryAdjustment - l.refund - l.hold) - l.net) >= 0.05);

  root.innerHTML = html`
    ${pageHeader(
      'Earnings',
      'How each delivered order turns into your payout. Figures come from the platform’s financial ledger.',
      html`<label class="sr-only" for="erange">Period</label>
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
      ${ledger.length ? ledgerFilters(panelOpen, chips, query, shownLedger.length, ledger.length) : ''}
      ${ledger.length && !shownLedger.length
        ? emptyState('No ledger entries match these filters', 'Widen the date or amount ranges, or clear the filters to see every entry in this period.', html`<button type="button" class="btn" data-action="clear-filters">Clear all filters</button>`)
        : ledger.length
        ? html`<div class="table-block"><div class="table-wrap"><table class="table table-compact">
            <thead><tr>
              <th scope="col">Date</th><th scope="col">Order</th><th scope="col" class="num">Gross</th><th scope="col" class="num">Discount</th>
              <th scope="col" class="num">Commission</th><th scope="col" class="num">Delivery</th><th scope="col" class="num">Refund</th>
              <th scope="col" class="num">Hold</th><th scope="col" class="num">Net</th><th scope="col">State</th>
            </tr></thead>
            <tbody>${ledgerRows.map(
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
            )}</tbody></table></div>${pager(ledgerInfo, 'entries')}</div>`
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
    // A new period is a new list: drop the table filters and page with it.
    setQuery({ range: (el as HTMLSelectElement).value, ...Object.fromEntries([...FILTER_KEYS, 'led_page'].map((k) => [k, undefined])) });
    refresh();
  });

  // Ledger filters: every change rewrites the URL and re-renders from page 1.
  const applyFilters = (form: HTMLFormElement) => {
    const f = new FormData(form);
    const next: Record<string, string | undefined> = { led_page: undefined };
    for (const k of FILTER_KEYS) next[k] = String(f.get(k) ?? '').trim() || undefined;
    setQuery(next);
    refresh();
  };
  let searchTimer: ReturnType<typeof setTimeout>;
  on(root, 'input', '#lq', (_e, el) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => applyFilters(el.closest('form') as HTMLFormElement), 300);
  });
  on(root, 'change', '[data-role=ledger-filters] input:not(#lq), [data-role=ledger-filters] select', (_e, el) => applyFilters(el.closest('form') as HTMLFormElement));
  on(root, 'submit', '[data-role=ledger-filters]', (e, form) => {
    e.preventDefault();
    applyFilters(form as HTMLFormElement);
  });
  on(root, 'click', '[data-action=clear-filters]', () => {
    setQuery({ ...Object.fromEntries(FILTER_KEYS.map((k) => [k, undefined])), led_page: undefined });
    refresh();
  });
  on(root, 'click', '[data-clear]', (_e, el) => {
    setQuery({ ...Object.fromEntries(el.dataset.clear!.split(',').map((k) => [k, undefined])), led_page: undefined });
    refresh();
  });
  // <details> doesn't bubble `toggle`, so listen in the capture phase. No re-render needed.
  root.addEventListener(
    'toggle',
    (e) => {
      const d = e.target as HTMLDetailsElement;
      if (d.classList?.contains('filter-panel')) setQuery({ fopen: d.open ? '1' : undefined });
    },
    true,
  );
  bindPager(root, refresh);

  on(root, 'click', '[data-action=export]', () => {
    const rows: (string | number)[][] = [['date', 'sub_order', 'gross', 'discount', 'commission_rate_pct', 'commission', 'delivery_adjustment', 'refund', 'hold', 'net', 'state', 'settlement']];
    for (const l of shownLedger) rows.push([l.date.slice(0, 10), l.subOrderId, l.gross, l.discount, l.commissionRate, l.commission, l.deliveryAdjustment, l.refund, l.hold, l.net, l.state, l.settlementId ?? '']);
    saveFile(`earnings-${range}-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(rows));
  });
};

function ledgerFilters(open: boolean, chips: { label: string; keys: string[] }[], query: URLSearchParams, matching: number, total: number) {
  const v = (k: string) => query.get(k) ?? '';
  const num = (key: string, label: string, bound: 'Min' | 'Max') =>
    html`<div class="field"><label for="lf_${key}">${bound} ${label.toLowerCase()} (₹)</label><input id="lf_${key}" name="${key}" type="number" step="0.01" inputmode="decimal" placeholder="${bound === 'Min' ? 'From' : 'To'} ₹" value="${v(key)}" /></div>`;
  return html`<form class="ledger-filters" data-role="ledger-filters" role="search" aria-label="Filter ledger entries">
    <div class="toolbar">
      <div class="search">
        ${icon('search', 16)}
        <label class="sr-only" for="lq">Search by order ID</label>
        <input id="lq" name="lq" type="search" placeholder="Search by order ID" value="${v('lq')}" autocomplete="off" />
      </div>
    </div>
    <details class="filter-panel" ${open ? raw('open') : ''}>
      <summary class="btn btn-sm filter-toggle">${icon('search', 14)} Filters${chips.length ? html` <span class="tab-count">${chips.length}</span>` : ''}</summary>
      <div class="filter-grid">
        <fieldset class="filter-group">
          <legend>Date range</legend>
          <div class="field"><label for="lf_from">Start date</label><input id="lf_from" name="ld_from" type="date" value="${v('ld_from')}" max="${v('ld_to')}" /></div>
          <div class="field"><label for="lf_to">End date</label><input id="lf_to" name="ld_to" type="date" value="${v('ld_to')}" min="${v('ld_from')}" /></div>
        </fieldset>
        <fieldset class="filter-group">
          <legend>State</legend>
          <div class="field"><label for="lf_state">Settlement state</label>
            <select id="lf_state" name="lstate"><option value="">All states</option>${Object.entries(SETTLEMENT_LABEL).map(([k, l]) => html`<option value="${k}" ${v('lstate') === k ? raw('selected') : ''}>${l}</option>`)}</select>
          </div>
        </fieldset>
        ${AMOUNT_COLUMNS.map((c) => html`<fieldset class="filter-group"><legend>${c.label}</legend>${num(`${c.key}_min`, c.label, 'Min')}${num(`${c.key}_max`, c.label, 'Max')}</fieldset>`)}
      </div>
    </details>
    <div class="filter-summary" role="status" aria-live="polite">
      ${chips.length
        ? html`<ul class="chip-row" aria-label="Active filters">${chips.map((c) => html`<li class="chip chip-static">${c.label}<button type="button" class="chip-x" data-clear="${c.keys.join(',')}" aria-label="Remove filter ${c.label}">${icon('close', 12)}</button></li>`)}</ul>
          <button type="button" class="link-btn" data-action="clear-filters">Clear all filters</button>`
        : ''}
      <span class="muted small">${chips.length ? `${matching} of ${total} entries match` : `${total} entr${total === 1 ? 'y' : 'ies'}`}</span>
    </div>
  </form>`;
}

export default page;
