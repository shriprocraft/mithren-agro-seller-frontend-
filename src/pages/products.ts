// /seller/products — catalogue list with status tabs, search and quick actions.

import type { Page } from '../router.js';
import { setQuery } from '../router.js';
import { html, on, download } from '../ui/dom.js';
import { pageHeader, productBadge, icon, emptyState, tabs, badge, mockNote } from '../ui/components.js';
import { toast, confirmDialog } from '../ui/overlay.js';
import * as api from '../api.js';
import { money, timeAgo, toCsv } from '../lib.js';
import { CATEGORIES } from '../data/seed.js';
import type { Product } from '../types.js';

const STATUS_TABS: [string, string][] = [
  ['', 'All'],
  ['approved', 'Approved'],
  ['pending', 'Pending'],
  ['draft', 'Drafts'],
  ['rejected', 'Rejected'],
  ['inactive', 'Inactive'],
  ['archived', 'Archived'],
];

const page: Page = async ({ root, query, seller, refresh }) => {
  const status = query.get('status') ?? '';
  const q = query.get('q') ?? '';
  const category = query.get('category') ?? '';
  const [all, list] = await Promise.all([api.listProducts({ includeArchived: true }), api.listProducts({ status, q, category })]);
  const countFor = (s: string) => (s === '' ? all.filter((p) => !p.archived).length : s === 'archived' ? all.filter((p) => p.archived).length : all.filter((p) => !p.archived && p.status === s).length);
  const readOnly = seller.status === 'suspended';

  root.innerHTML = html`
    ${pageHeader(
      'Products',
      'Create and manage your listings. New listings and changes to organic claims go through moderation.',
      html`${mockNote()}
        <button class="btn" type="button" data-action="export">${icon('download', 16)} Export CSV</button>
        ${readOnly ? '' : html`<a class="btn btn-primary" href="#/seller/products/new">${icon('plus', 16)} Add product</a>`}`,
    )}
    ${tabs(STATUS_TABS.map(([s, l]) => ({ href: `/seller/products${s ? `?status=${s}` : ''}`, label: l, count: countFor(s), active: s === status })), 'Filter by status')}
    <form class="toolbar" role="search" data-role="filters">
      <div class="search">
        ${icon('search', 16)}
        <label class="sr-only" for="pq">Search products</label>
        <input id="pq" name="q" type="search" placeholder="Search by name or SKU" value="${q}" />
      </div>
      <label class="sr-only" for="pcat">Category</label>
      <select id="pcat" name="category" class="select-inline">
        <option value="">All categories</option>
        ${CATEGORIES.map((c) => html`<option ${c === category ? 'selected' : ''}>${c}</option>`)}
      </select>
    </form>
    ${list.length
      ? html`<div class="table-wrap"><table class="table table-products">
          <caption class="sr-only">Your products</caption>
          <thead><tr>
            <th scope="col">Product</th><th scope="col">Status</th><th scope="col">Variants</th>
            <th scope="col" class="num">Price from</th><th scope="col" class="num">Stock</th>
            <th scope="col">Available</th><th scope="col">Updated</th><th scope="col"><span class="sr-only">Actions</span></th>
          </tr></thead>
          <tbody>${list.map((p) => row(p, readOnly))}</tbody>
        </table></div>`
      : q || category || status
        ? emptyState('No matching products', 'Try a different search, category or status.', html`<a class="btn" href="#/seller/products">Clear filters</a>`)
        : emptyState('No products yet', 'Add your first product to start selling. You can save it as a draft.', html`<a class="btn btn-primary" href="#/seller/products/new">${icon('plus', 16)} Add product</a>`)}
  `.value;

  let t: ReturnType<typeof setTimeout>;
  on(root, 'input', '#pq', (_e, el) => {
    clearTimeout(t);
    t = setTimeout(() => {
      setQuery({ q: (el as HTMLInputElement).value.trim() || undefined });
      refresh();
    }, 300);
  });
  on(root, 'submit', '[data-role=filters]', (e) => e.preventDefault());
  on(root, 'change', '#pcat', (_e, el) => {
    setQuery({ category: (el as HTMLSelectElement).value || undefined });
    refresh();
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
    for (const p of all) for (const v of p.variants) rows.push([p.name, p.category, p.archived ? 'archived' : p.status, v.label, v.sku, v.price, v.mrp ?? '', v.stock]);
    download(`products-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(rows));
    toast('Exported products to CSV');
  });
};

function row(p: Product, readOnly: boolean) {
  const stock = p.variants.reduce((s, v) => s + v.stock, 0);
  const low = p.variants.some((v) => v.stock <= p.lowStockThreshold);
  const minPrice = Math.min(...p.variants.map((v) => v.price));
  const canToggle = !readOnly && !p.archived && (p.status === 'approved' || p.status === 'inactive');
  return html`<tr>
    <td>
      <a class="prod-cell" href="#/seller/products/${p.id}">
        <span class="prod-thumb" aria-hidden="true">${p.emoji}</span>
        <span><strong>${p.name}</strong><span class="muted small">${p.category}${p.organicClaim === 'certified' ? ' · Certified organic' : p.organicClaim === 'in_conversion' ? ' · In conversion' : ''}</span></span>
      </a>
    </td>
    <td>${p.archived ? badge('Archived') : productBadge(p.status)}</td>
    <td>${p.variants.length}</td>
    <td class="num">${money(minPrice)}</td>
    <td class="num">${stock === 0 ? badge('Out of stock', 'red') : low ? html`<span class="warn-text">${stock}</span> ${badge('Low', 'amber')}` : stock}</td>
    <td>
      ${canToggle
        ? html`<label class="toggle"><input type="checkbox" data-action="toggle-available" data-id="${p.id}" ${p.available ? 'checked' : ''} /><span class="toggle-ui" aria-hidden="true"></span><span class="sr-only">Available: ${p.name}</span></label>`
        : html`<span class="muted small" data-tip="Only approved listings can be made available.">—</span>`}
    </td>
    <td class="muted">${timeAgo(p.updatedAt)}</td>
    <td class="actions">
      <a class="btn btn-sm btn-ghost" href="#/seller/products/${p.id}">${readOnly ? 'View' : 'Edit'}</a>
      ${readOnly ? '' : html`<button type="button" class="btn btn-sm btn-ghost" data-action="archive" data-id="${p.id}" data-archived="${p.archived}">${p.archived ? 'Restore' : 'Archive'}</button>`}
    </td>
  </tr>`;
}

export default page;
