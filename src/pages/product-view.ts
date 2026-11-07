// /seller/products/:id — a read-only view of one listing. Editing happens at /seller/products/:id/edit.

import type { Page } from '../router.js';
import { html, raw, on, type Raw } from '../ui/dom.js';
import { pageHeader, productBadge, icon, emptyState, badge, callout } from '../ui/components.js';
import * as api from '../api.js';
import { money, fmtDate } from '../lib.js';
import { categoryKind } from '../catalog.js';
import type { Product, Variant } from '../types.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const ORGANIC_LABEL: Record<Product['organicClaim'], string> = {
  none: 'No organic claim',
  certified: 'Certified organic',
  in_conversion: 'In conversion',
};

const row = (label: string, value: string | Raw | undefined) => html`<div><dt>${label}</dt><dd>${value === '' || value === undefined ? '—' : value}</dd></div>`;

const PLURAL: Record<string, string> = { bunch: 'bunches', piece: 'pieces', box: 'boxes' };
/** What a variant is: a size for apparel, otherwise a pack such as "500 g", "1 kg" or "12 pieces". */
const variantKind = (apparel: boolean, v: Variant) => {
  if (apparel) return v.size ?? '—';
  if (v.unit === 'g' || v.unit === 'kg') return `${v.packSize} ${v.unit}`;
  return `${v.packSize} ${v.packSize === 1 ? v.unit : (PLURAL[v.unit] ?? v.unit)}`;
};

const page: Page = async ({ root, params, seller }) => {
  let p: Product;
  try {
    p = await api.getProduct(params.id!);
  } catch (e) {
    if (e instanceof api.ApiError && e.status === 404) {
      root.innerHTML = emptyState('Product not found', 'It may have been deleted, or it belongs to a different seller account.', html`<a class="btn btn-primary" href="#/seller/products">Back to products</a>`).value;
      return;
    }
    throw e;
  }
  const readOnly = seller.status === 'suspended';
  const apparel = categoryKind(p.category) === 'apparel';
  const prices = p.variants.map((v) => v.price).filter((x) => x > 0);
  const lowest = prices.length ? Math.min(...prices) : 0;
  const highest = prices.length ? Math.max(...prices) : 0;
  const totalStock = p.variants.reduce((n, v) => n + v.stock, 0);
  const editHref = `#/seller/products/${encodeURIComponent(p.id)}/edit`;
  const photos = (p.images ?? []).map(api.imageUrl);

  const status = html`${p.archived ? badge('Archived') : productBadge(p.status)} ${p.available ? '' : badge('Hidden from customers', 'neutral')}`;
  const editButton = readOnly ? '' : html`<a class="btn btn-primary" href="${editHref}" data-action="edit-product">${icon('edit', 16)} Edit Product</a>`;

  root.innerHTML = html`
    ${pageHeader(p.name, `${p.category} · Last updated ${fmtDate(p.updatedAt, true)}`, html`${status}${editButton}`, { href: '/seller/products', label: 'Products' })}
    ${p.status === 'rejected' ? callout('error', 'This listing was rejected', p.moderationNote ?? 'Edit the listing to fix the reviewer’s points and resubmit.') : ''}
    ${readOnly ? callout('error', 'Read-only', 'Your account is suspended, so listings can’t be edited.') : ''}

    <div class="grid-main product-view">
      <div class="stack">
        <section class="card">
          <h2 class="card-title">Images</h2>
          ${photos.length
            ? html`<div class="gallery">
                <figure class="gallery-main">
                  <img id="gallery-main" src="${photos[0]}" alt="${p.name}, photo 1 of ${photos.length}" />
                </figure>
                ${photos.length > 1
                  ? html`<ul class="gallery-thumbs" aria-label="All photos">
                      ${photos.map(
                        (src, i) => html`<li><button type="button" class="gallery-thumb ${i === 0 ? 'is-active' : ''}" data-photo="${i}" aria-label="Show photo ${i + 1}" aria-pressed="${String(i === 0)}">
                          <img src="${src}" alt="" />${i === 0 ? html`<span class="image-primary">Primary</span>` : ''}
                        </button></li>`,
                      )}
                    </ul>`
                  : ''}
              </div>`
            : html`<div class="product-view-image" role="img" aria-label="${p.name}: no photos yet, showing the fallback icon">
                <span aria-hidden="true">${p.emoji}</span>
              </div>
              <p class="muted small">No photos yet. ${readOnly ? '' : 'Add some with Edit Product; until then customers see this icon.'}</p>`}
        </section>

        <section class="card">
          <h2 class="card-title">Variants &amp; pricing</h2>
          ${p.variants.length
            ? html`<div class="table-wrap"><table class="table">
                <thead><tr>
                  <th scope="col">Variant</th>
                  <th scope="col">${apparel ? 'Size' : 'Pack'}</th>
                  <th scope="col">SKU</th>
                  <th scope="col" class="num">Price</th>
                  <th scope="col" class="num">MRP</th>
                  <th scope="col" class="num">Stock</th>
                </tr></thead>
                <tbody>
                  ${p.variants.map(
                    (v) => html`<tr>
                      <td>${v.label || '—'}</td>
                      <td>${variantKind(apparel, v)}</td>
                      <td class="mono small">${v.sku || '—'}</td>
                      <td class="num"><strong>${money(v.price)}</strong></td>
                      <td class="num">${v.mrp ? money(v.mrp) : '—'}</td>
                      <td class="num">${v.stock === 0 ? badge('Out of stock', 'red') : v.stock <= p.lowStockThreshold ? html`<span class="warn-text">${v.stock}</span>` : v.stock}</td>
                    </tr>`,
                  )}
                </tbody>
              </table></div>`
            : html`<p class="muted">No variants yet.</p>`}
          <dl class="kv kv-inline">
            ${row('Price', prices.length ? (lowest === highest ? money(lowest) : `${money(lowest)} – ${money(highest)}`) : '')}
            ${row('Total stock', String(totalStock))}
            ${row('Order quantity', `${p.minQty} to ${p.maxQty} per order`)}
            ${row('Low-stock alert at', String(p.lowStockThreshold))}
          </dl>
        </section>

        <section class="card">
          <h2 class="card-title">Description</h2>
          ${p.description.trim() ? html`<p class="pre-wrap">${p.description}</p>` : html`<p class="muted">No description yet.</p>`}
        </section>
      </div>

      <aside class="stack">
        <section class="card">
          <h2 class="card-title">Status</h2>
          <dl class="kv">
            ${row('Listing', raw(status.value))}
            ${row('Availability', p.available ? 'Shown to customers' : 'Hidden from customers')}
            ${row('Catalogue', p.backendId ? 'Saved to the catalogue' : 'Only in this portal')}
            ${row('URL slug', p.slug)}
          </dl>
        </section>

        ${apparel
          ? ''
          : html`<section class="card">
              <h2 class="card-title">Origin, freshness &amp; storage</h2>
              <dl class="kv">
                ${row('Origin', p.origin)}
                ${row('Season', p.seasonality === 'seasonal' ? (p.seasonMonths.length ? p.seasonMonths.map((m) => MONTHS[m - 1]).join(', ') : 'Seasonal') : 'Year-round')}
                ${row('Harvest date', p.harvestDate ? fmtDate(p.harvestDate) : '')}
                ${row('Packed date', p.packedDate ? fmtDate(p.packedDate) : '')}
                ${row('Storage', p.storage)}
              </dl>
            </section>
            <section class="card">
              <h2 class="card-title">Organic claim</h2>
              <p>${ORGANIC_LABEL[p.organicClaim]}</p>
            </section>`}

      </aside>
    </div>`.value;

  on(root, 'click', '[data-photo]', (_e, el) => {
    const i = Number(el.dataset.photo);
    const main = root.querySelector<HTMLImageElement>('#gallery-main');
    if (!main || !photos[i]) return;
    main.src = photos[i]!;
    main.alt = `${p.name}, photo ${i + 1} of ${photos.length}`;
    root.querySelectorAll<HTMLElement>('[data-photo]').forEach((b) => {
      const active = b === el;
      b.classList.toggle('is-active', active);
      b.setAttribute('aria-pressed', String(active));
    });
  });
};

export default page;
