// /seller/products — catalogue list with status tabs, search, filters, sorting, variants and pagination.

import type { Page } from '../router.js';
import { setQuery } from '../router.js';
import { html, raw, on } from '../ui/dom.js';
import { pageHeader, productBadge, icon, emptyState, tabs, badge, paginate, pager, bindPager } from '../ui/components.js';
import { toast, confirmDialog, saveFile } from '../ui/overlay.js';
import * as api from '../api.js';
import { money, timeAgo, toCsv } from '../lib.js';
import { CATEGORIES } from '../data/seed.js';
import type { Product, Variant } from '../types.js';

const STATUS_TABS: [string, string][] = [
  ['', 'All'],
  ['approved', 'Approved'],
  ['pending', 'Pending'],
  ['draft', 'Drafts'],
  ['rejected', 'Rejected'],
  ['inactive', 'Inactive'],
  ['archived', 'Archived'],
];

const SORTS: [string, string][] = [
  ['updated', 'Recently updated'],
  ['name_asc', 'Name: A to Z'],
  ['name_desc', 'Name: Z to A'],
  ['price_asc', 'Price: low to high'],
  ['price_desc', 'Price: high to low'],
  ['stock_asc', 'Stock: low to high'],
  ['stock_desc', 'Stock: high to low'],
];

const STOCK_FILTERS: [string, string][] = [
  ['', 'Any stock level'],
  ['in', 'In stock'],
  ['low', 'Low stock'],
  ['out', 'Out of stock'],
];

const AVAILABILITY_FILTERS: [string, string][] = [
  ['', 'Any availability'],
  ['available', 'Available to customers'],
  ['hidden', 'Hidden from customers'],
];

/** Query keys owned by the filter bar (status lives in the tabs, paging in the pager). */
const FILTER_KEYS = ['q', 'category', 'stock', 'avail', 'variant', 'pmin', 'pmax', 'sort'];

/** Products whose variant panel is open. Kept at module level so toggling availability doesn't collapse rows. */
const expanded = new Set<string>();

const totalStock = (p: Product) => p.variants.reduce((s, v) => s + v.stock, 0);
const minPrice = (p: Product) => (p.variants.length ? Math.min(...p.variants.map((v) => v.price)) : 0);
const isLow = (p: Product, v: Variant) => v.stock > 0 && v.stock <= p.lowStockThreshold;
function stockLevel(p: Product): 'in' | 'low' | 'out' {
  if (totalStock(p) === 0) return 'out';
  return p.variants.some((v) => v.stock <= p.lowStockThreshold) ? 'low' : 'in';
}

const numParam = (query: URLSearchParams, key: string) => {
  const value = query.get(key);
  if (value === null || value.trim() === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

/** Filters the backend can't do (it handles status, category and name/SKU search). */
function refine(list: Product[], query: URLSearchParams) {
  const stock = query.get('stock') ?? '';
  const avail = query.get('avail') ?? '';
  const variant = (query.get('variant') ?? '').trim().toLowerCase();
  const pmin = numParam(query, 'pmin');
  const pmax = numParam(query, 'pmax');
  return list.filter((p) => {
    if (stock && stockLevel(p) !== stock) return false;
    if (avail === 'available' && !p.available) return false;
    if (avail === 'hidden' && p.available) return false;
    // Variant and price criteria must hold for the same variant, so "500 g under ₹100" means one pack.
    if (variant || pmin !== null || pmax !== null) {
      const hit = p.variants.some((v) => (!variant || v.label.toLowerCase().includes(variant)) && (pmin === null || v.price >= pmin) && (pmax === null || v.price <= pmax));
      if (!hit) return false;
    }
    return true;
  });
}

function sortProducts(list: Product[], sort: string) {
  const byName = (a: Product, b: Product) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  const out = [...list];
  switch (sort) {
    case 'name_asc':
      return out.sort(byName);
    case 'name_desc':
      return out.sort((a, b) => byName(b, a));
    case 'price_asc':
      return out.sort((a, b) => minPrice(a) - minPrice(b) || byName(a, b));
    case 'price_desc':
      return out.sort((a, b) => minPrice(b) - minPrice(a) || byName(a, b));
    case 'stock_asc':
      return out.sort((a, b) => totalStock(a) - totalStock(b) || byName(a, b));
    case 'stock_desc':
      return out.sort((a, b) => totalStock(b) - totalStock(a) || byName(a, b));
    default:
      return out; // the backend already returns most recently updated first
  }
}

function activeChips(query: URLSearchParams, category: string) {
  const out: { label: string; keys: string[] }[] = [];
  const q = (query.get('q') ?? '').trim();
  if (q) out.push({ label: `Search: ${q}`, keys: ['q'] });
  if (category) out.push({ label: `Category: ${category}`, keys: ['category'] });
  const stock = STOCK_FILTERS.find(([v]) => v && v === query.get('stock'));
  if (stock) out.push({ label: stock[1], keys: ['stock'] });
  const avail = AVAILABILITY_FILTERS.find(([v]) => v && v === query.get('avail'));
  if (avail) out.push({ label: avail[1], keys: ['avail'] });
  const variant = (query.get('variant') ?? '').trim();
  if (variant) out.push({ label: `Variant: ${variant}`, keys: ['variant'] });
  const pmin = numParam(query, 'pmin');
  const pmax = numParam(query, 'pmax');
  if (pmin !== null || pmax !== null) out.push({ label: `Price: ${pmin !== null ? money(pmin) : 'any'} – ${pmax !== null ? money(pmax) : 'any'}`, keys: ['pmin', 'pmax'] });
  return out;
}

const page: Page = async ({ root, query, seller, refresh }) => {
  const status = query.get('status') ?? '';
  const q = query.get('q') ?? '';
  const category = query.get('category') ?? '';
  const sort = query.get('sort') ?? 'updated';
  const [all, fetched] = await Promise.all([api.listProducts({ includeArchived: true }), api.listProducts({ status, q, category })]);
  const countFor = (s: string) => (s === '' ? all.filter((p) => !p.archived).length : s === 'archived' ? all.filter((p) => p.archived).length : all.filter((p) => !p.archived && p.status === s).length);
  const readOnly = seller.status === 'suspended';

  const list = sortProducts(refine(fetched, query), sort);
  const { rows: shown, info } = paginate(list, query);
  const chips = activeChips(query, category);
  const extraActive = chips.filter((c) => !['q', 'category'].includes(c.keys[0]!)).length;
  const panelOpen = extraActive > 0 || query.get('fopen') === '1';
  const v = (k: string) => query.get(k) ?? '';
  const anyFilter = chips.length > 0 || status !== '';

  root.innerHTML = html`
    ${pageHeader(
      'Products',
      'Create and manage your listings. New listings and changes to organic claims go through moderation.',
      html`<button class="btn" type="button" data-action="export">${icon('download', 16)} Export CSV</button>
        ${readOnly ? '' : html`<a class="btn btn-primary" href="#/seller/products/new">${icon('plus', 16)} Add product</a>`}`,
    )}
    ${tabs(STATUS_TABS.map(([s, l]) => ({ href: `/seller/products${s ? `?status=${s}` : ''}`, label: l, count: countFor(s), active: s === status })), 'Filter by status')}
    <form class="product-filters" role="search" data-role="filters" aria-label="Filter products">
      <div class="toolbar">
        <div class="search">
          ${icon('search', 16)}
          <label class="sr-only" for="pq">Search products</label>
          <input id="pq" name="q" type="search" placeholder="Search by product name or SKU" value="${q}" autocomplete="off" />
        </div>
        <label class="sr-only" for="pcat">Category</label>
        <select id="pcat" name="category" class="select-inline">
          <option value="">All categories</option>
          ${CATEGORIES.map((c) => html`<option ${c === category ? raw('selected') : ''}>${c}</option>`)}
        </select>
        <label class="sr-only" for="psort">Sort products</label>
        <select id="psort" name="sort" class="select-inline">${SORTS.map(([val, l]) => html`<option value="${val}" ${val === sort ? raw('selected') : ''}>${l}</option>`)}</select>
      </div>
      <details class="filter-panel" ${panelOpen ? raw('open') : ''}>
        <summary class="btn btn-sm filter-toggle">${icon('search', 14)} More filters${extraActive ? html` <span class="tab-count">${extraActive}</span>` : ''}</summary>
        <div class="filter-grid">
          <div class="field"><label for="pstock">Stock status</label>
            <select id="pstock" name="stock">${STOCK_FILTERS.map(([val, l]) => html`<option value="${val}" ${val === v('stock') ? raw('selected') : ''}>${l}</option>`)}</select></div>
          <div class="field"><label for="pavail">Availability</label>
            <select id="pavail" name="avail">${AVAILABILITY_FILTERS.map(([val, l]) => html`<option value="${val}" ${val === v('avail') ? raw('selected') : ''}>${l}</option>`)}</select></div>
          <div class="field"><label for="pvariant">Variant</label>
            <input id="pvariant" name="variant" type="text" placeholder="Variant or pack size, e.g. 500 g" value="${v('variant')}" autocomplete="off" /></div>
          <div class="field"><label for="ppmin">Minimum price (₹)</label>
            <input id="ppmin" name="pmin" type="number" min="0" step="0.01" inputmode="decimal" placeholder="From ₹" value="${v('pmin')}" /></div>
          <div class="field"><label for="ppmax">Maximum price (₹)</label>
            <input id="ppmax" name="pmax" type="number" min="0" step="0.01" inputmode="decimal" placeholder="To ₹" value="${v('pmax')}" /></div>
        </div>
      </details>
      <div class="filter-summary" role="status" aria-live="polite">
        ${chips.length
          ? html`<ul class="chip-row" aria-label="Active filters">${chips.map((c) => html`<li class="chip chip-static">${c.label}<button type="button" class="chip-x" data-clear="${c.keys.join(',')}" aria-label="Remove filter ${c.label}">${icon('close', 12)}</button></li>`)}</ul>
            <button type="button" class="link-btn" data-action="clear-filters">Clear filters</button>`
          : ''}
        <span class="muted small">${list.length} product${list.length === 1 ? '' : 's'}</span>
      </div>
    </form>
    ${list.length
      ? html`<div class="table-block"><div class="table-wrap"><table class="table table-products">
          <caption class="sr-only">Your products</caption>
          <thead><tr>
            <th scope="col">Product</th><th scope="col">Status</th><th scope="col">Variants</th>
            <th scope="col" class="num">Price</th><th scope="col" class="num">Stock</th>
            <th scope="col">Available</th><th scope="col">Updated</th><th scope="col"><span class="sr-only">Actions</span></th>
          </tr></thead>
          <tbody>${shown.map((p) => row(p, readOnly))}</tbody>
        </table></div>${pager(info, 'products')}</div>`
      : anyFilter
        ? emptyState('No matching products', 'Try a different search, category, price range or status.', html`<button type="button" class="btn" data-action="clear-filters">Clear filters</button>`)
        : readOnly
          ? emptyState('No products', 'Your account is suspended, so products can’t be added right now.')
          : emptyState('No products yet', 'Add your first product to start selling. You can save it as a draft.', html`<a class="btn btn-primary" href="#/seller/products/new">${icon('plus', 16)} Add product</a>`)}
  `.value;

  // ----- filters: any change rewrites the URL and returns to page 1 -----
  const form = root.querySelector<HTMLFormElement>('[data-role=filters]')!;
  const apply = () => {
    const f = new FormData(form);
    const next: Record<string, string | undefined> = { page: undefined };
    for (const k of FILTER_KEYS) next[k] = k === 'sort' && f.get(k) === 'updated' ? undefined : String(f.get(k) ?? '').trim() || undefined;
    setQuery(next);
    refresh();
  };
  let t: ReturnType<typeof setTimeout>;
  on(root, 'input', '#pq, #pvariant, #ppmin, #ppmax', () => {
    clearTimeout(t);
    t = setTimeout(apply, 300);
  });
  on(root, 'change', '#pcat, #psort, #pstock, #pavail', apply);
  on(root, 'submit', '[data-role=filters]', (e) => {
    e.preventDefault();
    apply();
  });
  on(root, 'click', '[data-action=clear-filters]', () => {
    setQuery({ ...Object.fromEntries(FILTER_KEYS.map((k) => [k, undefined])), page: undefined, fopen: undefined });
    refresh();
  });
  on(root, 'click', '[data-clear]', (_e, el) => {
    setQuery({ ...Object.fromEntries(el.dataset.clear!.split(',').map((k) => [k, undefined])), page: undefined });
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

  // ----- variant panels (client-side show/hide; nothing to fetch) -----
  on(root, 'click', '[data-action=expand]', (_e, btn) => {
    const id = btn.dataset.id!;
    const open = !expanded.has(id);
    if (open) expanded.add(id);
    else expanded.delete(id);
    btn.setAttribute('aria-expanded', String(open));
    btn.closest('tr')!.classList.toggle('is-open', open);
    const panel = root.querySelector<HTMLElement>(`#vr_${CSS.escape(id)}`);
    if (panel) panel.hidden = !open;
  });

  on(root, 'change', '[data-action=toggle-available]', async (_e, el) => {
    const input = el as HTMLInputElement;
    input.disabled = true;
    try {
      await api.setProductAvailability(input.dataset.id!, input.checked);
      toast(input.checked ? 'Product is available to customers' : 'Product hidden from customers');
      refresh();
    } catch (err) {
      input.checked = !input.checked;
      input.disabled = false;
      toast((err as Error).message, 'error');
    }
  });

  on(root, 'click', '[data-action=archive]', async (_e, el) => {
    const id = el.dataset.id!;
    const archived = el.dataset.archived !== 'true';
    if (archived) {
      const c = await confirmDialog({ title: 'Archive product?', message: 'Archived products are hidden from customers and from your main list. Order history is kept. You can restore it later.', confirmLabel: 'Archive' });
      if (!c.ok) return;
    }
    try {
      await api.archiveProduct(id, archived);
      toast(archived ? 'Product archived' : 'Product restored');
      refresh();
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  });

  on(root, 'click', '[data-action=export]', () => {
    const rows: (string | number)[][] = [['product', 'category', 'status', 'variant', 'sku', 'price', 'mrp', 'stock']];
    for (const p of all) for (const vr of p.variants) rows.push([p.name, p.category, p.archived ? 'archived' : p.status, vr.label, vr.sku, vr.price, vr.mrp ?? '', vr.stock]);
    saveFile(`products-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(rows));
  });
};

function row(p: Product, readOnly: boolean) {
  const stock = totalStock(p);
  const low = p.variants.some((v) => v.stock <= p.lowStockThreshold);
  const prices = p.variants.map((v) => v.price);
  const from = prices.length ? Math.min(...prices) : 0;
  const multi = new Set(prices).size > 1;
  const canToggle = !readOnly && !p.archived && (p.status === 'approved' || p.status === 'inactive');
  const open = expanded.has(p.id);
  return html`<tr class="${open ? 'is-open' : ''}">
    <td>
      <a class="prod-cell" href="#/seller/products/${p.id}">
        <span class="prod-thumb" aria-hidden="true">${p.emoji}</span>
        <span><strong>${p.name}</strong><span class="muted small">${p.category}${p.organicClaim === 'certified' ? ' · Certified organic' : p.organicClaim === 'in_conversion' ? ' · In conversion' : ''}</span></span>
      </a>
    </td>
    <td>${p.archived ? badge('Archived') : productBadge(p.status)}</td>
    <td>${p.variants.length
      ? html`<button type="button" class="expander" data-action="expand" data-id="${p.id}" aria-expanded="${String(open)}" aria-controls="vr_${p.id}">${icon('chevronDown', 14)}<span>${p.variants.length} variant${p.variants.length === 1 ? '' : 's'}</span></button>`
      : html`<span class="muted">None</span>`}</td>
    <td class="num">${p.variants.length ? html`${multi ? html`<span class="muted small">from </span>` : ''}<strong>${money(from)}</strong>` : '—'}</td>
    <td class="num">${stock === 0 ? badge('Out of stock', 'red') : low ? html`<span class="warn-text">${stock}</span> ${badge('Low', 'amber')}` : stock}</td>
    <td>
      ${canToggle
        ? html`<label class="toggle"><input type="checkbox" data-action="toggle-available" data-id="${p.id}" ${p.available ? raw('checked') : ''} /><span class="toggle-ui" aria-hidden="true"></span><span class="sr-only">Available: ${p.name}</span></label>`
        : html`<span class="muted small" data-tip="Only approved listings can be made available.">—</span>`}
    </td>
    <td class="muted">${timeAgo(p.updatedAt)}</td>
    <td class="actions">
      <a class="btn btn-sm btn-ghost" href="#/seller/products/${p.id}">${readOnly ? 'View' : 'Edit'}</a>
      ${readOnly ? '' : html`<button type="button" class="btn btn-sm btn-ghost" data-action="archive" data-id="${p.id}" data-archived="${String(p.archived)}">${p.archived ? 'Restore' : 'Archive'}</button>`}
    </td>
  </tr>
  <tr class="variant-row" id="vr_${p.id}" ${open ? '' : raw('hidden')}>
    <td colspan="8">${variantPanel(p)}</td>
  </tr>`;
}

function variantPanel(p: Product) {
  if (!p.variants.length) return html`<p class="muted small">This product has no variants.</p>`;
  return html`<div class="variant-panel">
    <table class="table table-compact variant-table">
      <caption class="sr-only">Variants of ${p.name}</caption>
      <thead><tr><th scope="col">Variant</th><th scope="col">SKU</th><th scope="col" class="num">Price</th><th scope="col" class="num">Stock</th><th scope="col">Availability</th><th scope="col">Status</th></tr></thead>
      <tbody>${p.variants.map(
        (v) => html`<tr>
          <td><strong>${p.name}</strong> — ${v.label || '—'}</td>
          <td class="mono small">${v.sku || '—'}</td>
          <td class="num"><strong>${money(v.price)}</strong>${v.mrp && v.mrp > v.price ? html` <s class="muted small">${money(v.mrp)}</s>` : ''}</td>
          <td class="num">${v.stock}</td>
          <td>${!p.available ? badge('Hidden', 'neutral') : v.stock === 0 ? badge('Out of stock', 'red') : isLow(p, v) ? badge('Low stock', 'amber') : badge('In stock', 'green')}</td>
          <td>${p.archived ? badge('Archived') : productBadge(p.status)}</td>
        </tr>`,
      )}</tbody>
    </table>
  </div>`;
}

export default page;
