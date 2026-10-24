// /seller/inventory — stock levels, audited adjustments and CSV bulk updates.

import type { Page } from '../router.js';
import { html, on, $, download } from '../ui/dom.js';
import { pageHeader, emptyState, tabs, icon, badge, mockNote, field, select, textarea, showFieldErrors } from '../ui/components.js';
import { toast, modal } from '../ui/overlay.js';
import * as api from '../api.js';
import { fmtDate, toCsv, validateInventoryCsv, money } from '../lib.js';
import type { AdjustmentReason, Product, Variant } from '../types.js';

const REASONS: [AdjustmentReason, string][] = [
  ['restock', 'Restock / new harvest'],
  ['damage', 'Damaged or spoiled'],
  ['correction', 'Count correction'],
  ['return', 'Customer return restocked'],
];
const REASON_LABEL: Record<AdjustmentReason, string> = {
  restock: 'Restock',
  damage: 'Damage',
  correction: 'Correction',
  order: 'Order reserved',
  order_cancelled: 'Order released',
  return: 'Return',
  csv_import: 'CSV import',
};

const page: Page = async ({ root, query, seller, refresh }) => {
  const filter = query.get('filter') ?? '';
  const products = await api.listProducts();
  const log = await api.listAdjustments();
  const readOnly = seller.status === 'suspended';

  const rows = products.flatMap((p) => p.variants.map((v) => ({ p, v, low: v.stock <= p.lowStockThreshold, out: v.stock === 0 })));
  const filtered = rows.filter((r) => (filter === 'low' ? r.low : filter === 'out' ? r.out : true));
  const name = (pid: string, vid: string) => {
    const p = products.find((x) => x.id === pid);
    return p ? `${p.name} · ${p.variants.find((v) => v.id === vid)?.label ?? ''}` : 'Archived product';
  };

  root.innerHTML = html`
    ${pageHeader(
      'Inventory',
      'Every stock change is recorded with who made it and why.',
      html`${mockNote()}
        <button type="button" class="btn" data-action="export">${icon('download', 16)} Export CSV</button>
        ${readOnly ? '' : html`<button type="button" class="btn" data-action="import">${icon('upload', 16)} Import CSV</button>`}`,
    )}
    ${tabs(
      [
        { href: '/seller/inventory', label: 'All variants', count: rows.length, active: filter === '' },
        { href: '/seller/inventory?filter=low', label: 'Low stock', count: rows.filter((r) => r.low).length, active: filter === 'low' },
        { href: '/seller/inventory?filter=out', label: 'Out of stock', count: rows.filter((r) => r.out).length, active: filter === 'out' },
      ],
      'Filter inventory',
    )}
    ${filtered.length
      ? html`<div class="table-wrap"><table class="table">
          <caption class="sr-only">Stock by variant</caption>
          <thead><tr><th scope="col">Product</th><th scope="col">Variant</th><th scope="col">SKU</th><th scope="col" class="num">Price</th><th scope="col" class="num">Stock</th><th scope="col" class="num">Alert at</th><th scope="col">Status</th><th scope="col"><span class="sr-only">Actions</span></th></tr></thead>
          <tbody>${filtered.map(
            ({ p, v, low, out }) => html`<tr>
              <td><a href="#/seller/products/${p.id}">${p.emoji} ${p.name}</a>${p.status !== 'approved' ? html` <span class="muted small">(${p.status})</span>` : ''}</td>
              <td>${v.label}</td>
              <td class="mono small">${v.sku}</td>
              <td class="num">${money(v.price)}</td>
              <td class="num"><strong>${v.stock}</strong></td>
              <td class="num muted">${p.lowStockThreshold}</td>
              <td>${out ? badge('Out of stock', 'red') : low ? badge('Low', 'amber') : badge('In stock', 'green')}</td>
              <td class="actions">${readOnly ? '' : html`<button type="button" class="btn btn-sm" data-action="adjust" data-p="${p.id}" data-v="${v.id}">Adjust</button>`}</td>
            </tr>`,
          )}</tbody></table></div>`
      : emptyState(filter ? 'Nothing here' : 'No products yet', filter === 'low' ? 'All variants are above their low-stock threshold.' : filter === 'out' ? 'Every variant has stock.' : 'Add a product to start tracking stock.')}

    <section class="card" aria-labelledby="log-h">
      <div class="card-head"><h2 id="log-h" class="card-title">Adjustment log</h2><span class="muted small">Most recent first</span></div>
      ${log.length
        ? html`<div class="table-wrap"><table class="table table-compact">
            <thead><tr><th scope="col">When</th><th scope="col">Item</th><th scope="col" class="num">Change</th><th scope="col" class="num">New stock</th><th scope="col">Reason</th><th scope="col">Note</th><th scope="col">By</th></tr></thead>
            <tbody>${log.slice(0, 40).map(
              (a) => html`<tr>
                <td class="nowrap"><time datetime="${a.at}">${fmtDate(a.at, true)}</time></td>
                <td>${name(a.productId, a.variantId)}</td>
                <td class="num ${a.delta > 0 ? 'ok-text' : 'error-text'}">${a.delta > 0 ? '+' : ''}${a.delta}</td>
                <td class="num">${a.resultingStock}</td>
                <td>${REASON_LABEL[a.reason]}</td>
                <td class="muted">${a.note || '—'}</td>
                <td>${a.actor}</td>
              </tr>`,
            )}</tbody></table></div>`
        : html`<p class="muted">No adjustments yet.</p>`}
    </section>`.value;

  on(root, 'click', '[data-action=adjust]', (_e, el) => {
    const p = products.find((x) => x.id === el.dataset.p)!;
    const v = p.variants.find((x) => x.id === el.dataset.v)!;
    openAdjust(p, v, refresh);
  });

  on(root, 'click', '[data-action=export]', () => {
    const csv = toCsv([['sku', 'product', 'variant', 'stock', 'price'], ...rows.map(({ p, v }) => [v.sku, p.name, v.label, v.stock, v.price])]);
    download(`inventory-${new Date().toISOString().slice(0, 10)}.csv`, csv);
    toast('Exported inventory to CSV');
  });

  on(root, 'click', '[data-action=import]', () => openImport(rows.map((r) => r.v), refresh));
};

function openAdjust(p: Product, v: Variant, refresh: () => void) {
  modal({
    title: `Adjust stock — ${p.name} (${v.label})`,
    body: html`<form class="stack" novalidate>
      <p>Current stock: <strong>${v.stock}</strong></p>
      <div class="row-2">
        <div class="field">
          <label for="f_direction">Change</label>
          <select id="f_direction" name="direction"><option value="1">Add (+)</option><option value="-1">Remove (−)</option></select>
        </div>
        ${field({ name: 'delta', label: 'Quantity', type: 'number', required: true, attrs: 'min="1" step="1" inputmode="numeric" autofocus' })}
      </div>
      ${select({ name: 'reason', label: 'Reason', options: REASONS })}
      ${textarea({ name: 'note', label: 'Note', rows: 2, hint: 'Required for damage and corrections.', attrs: 'maxlength="200"' })}
      <p class="muted small" id="adj-preview" aria-live="polite"></p>
      <p class="form-error" role="alert" hidden></p>
      <div class="modal-actions">
        <button type="button" class="btn" data-close>Cancel</button>
        <button type="submit" class="btn btn-primary">Save adjustment</button>
      </div>
    </form>`,
    onMount(el, close) {
      const form = el.querySelector('form')!;
      const preview = () => {
        const d = Number((form.elements.namedItem('delta') as HTMLInputElement).value) * Number((form.elements.namedItem('direction') as HTMLSelectElement).value);
        $('#adj-preview', el)!.textContent = Number.isFinite(d) && d ? `New stock will be ${v.stock + d}.` : '';
      };
      form.addEventListener('input', preview);
      form.addEventListener('change', (e) => {
        if ((e.target as HTMLElement).id === 'f_direction' || (e.target as HTMLElement).id === 'f_reason') preview();
        const reason = (form.elements.namedItem('reason') as HTMLSelectElement).value;
        if (reason === 'damage' || reason === 'correction') (form.elements.namedItem('direction') as HTMLSelectElement).value = reason === 'damage' ? '-1' : (form.elements.namedItem('direction') as HTMLSelectElement).value;
      });
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(form);
        const qty = Number(fd.get('delta'));
        const delta = qty * Number(fd.get('direction'));
        const err = form.querySelector('.form-error') as HTMLElement;
        err.hidden = true;
        if (!Number.isInteger(qty) || qty <= 0) return showFieldErrors(form, { delta: 'Enter a whole number greater than 0.' });
        const btn = form.querySelector('[type=submit]') as HTMLButtonElement;
        btn.disabled = true;
        try {
          await api.adjustStock(p.id, v.id, delta, fd.get('reason') as AdjustmentReason, String(fd.get('note') ?? ''));
          toast(`Stock updated to ${v.stock + delta}`);
          close();
          refresh();
        } catch (ex) {
          const ae = ex as api.ApiError;
          err.textContent = ae.message;
          err.hidden = false;
          if (ae.fieldErrors) showFieldErrors(form, ae.fieldErrors);
          btn.disabled = false;
        }
      });
    },
  });
}

function openImport(variants: Variant[], refresh: () => void) {
  const known = new Set(variants.map((v) => v.sku));
  modal({
    title: 'Import stock & prices from CSV',
    wide: true,
    body: html`<div class="stack">
      <p>Upload a CSV with a header row containing <code>sku</code> and <code>stock</code>, and optionally <code>price</code>. Only SKUs that belong to your products are accepted. Changes are logged as “CSV import”.</p>
      <div class="row-wrap">
        <button type="button" class="btn btn-sm" data-action="template">${icon('download', 14)} Download template</button>
      </div>
      <div class="field">
        <label for="csv-file">CSV file</label>
        <input type="file" id="csv-file" accept=".csv,text/csv" />
        <p class="hint">Max 1 MB.</p>
      </div>
      <div id="csv-report" aria-live="polite"></div>
      <div class="modal-actions">
        <button type="button" class="btn" data-close>Cancel</button>
        <button type="button" class="btn btn-primary" data-action="apply" disabled>Apply changes</button>
      </div>
    </div>`,
    onMount(el, close) {
      let valid: { sku: string; stock: number; price?: number }[] = [];
      el.querySelector('[data-action=template]')!.addEventListener('click', () => {
        download('inventory-template.csv', toCsv([['sku', 'stock', 'price'], ...variants.slice(0, 3).map((v) => [v.sku, v.stock, v.price])]));
      });
      el.querySelector('#csv-file')!.addEventListener('change', async (e) => {
        const file = (e.target as HTMLInputElement).files?.[0];
        const report = $('#csv-report', el)!;
        const apply = el.querySelector('[data-action=apply]') as HTMLButtonElement;
        apply.disabled = true;
        valid = [];
        if (!file) return;
        if (file.size > 1024 * 1024) {
          report.innerHTML = html`<p class="error-text">File is larger than 1 MB.</p>`.value;
          return;
        }
        const res = validateInventoryCsv(await file.text(), known);
        valid = res.rows;
        report.innerHTML = html`
          <p><strong>${res.rows.length}</strong> valid row${res.rows.length === 1 ? '' : 's'}${res.errors.length ? html`, <strong class="error-text">${res.errors.length}</strong> with errors (skipped)` : ''}.</p>
          ${res.errors.length
            ? html`<div class="table-wrap"><table class="table table-compact"><thead><tr><th scope="col">Line</th><th scope="col">Problem</th></tr></thead>
                <tbody>${res.errors.slice(0, 50).map((er) => html`<tr><td class="num">${er.line}</td><td>${er.message}</td></tr>`)}</tbody></table></div>`
            : ''}`.value;
        apply.disabled = res.rows.length === 0;
        apply.textContent = res.rows.length ? `Apply ${res.rows.length} change${res.rows.length === 1 ? '' : 's'}` : 'Apply changes';
      });
      el.querySelector('[data-action=apply]')!.addEventListener('click', async (e) => {
        const btn = e.currentTarget as HTMLButtonElement;
        btn.disabled = true;
        try {
          const r = await api.applyInventoryCsv(valid);
          toast(`Updated ${r.updated} variant${r.updated === 1 ? '' : 's'}`);
          close();
          refresh();
        } catch (ex) {
          toast((ex as Error).message, 'error');
          btn.disabled = false;
        }
      });
    },
  });
}

export default page;
