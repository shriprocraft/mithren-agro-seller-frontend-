// /seller/products/new and /seller/products/:id — create or edit a listing.

import type { Page } from '../router.js';
import { navigate } from '../router.js';
import { html, raw, on, $, $$, formValues } from '../ui/dom.js';
import { pageHeader, field, textarea, select, callout, productBadge, icon, showFieldErrors, badge, emptyState } from '../ui/components.js';
import { toast } from '../ui/overlay.js';
import * as api from '../api.js';
import { slugify, money, fmtDate, UNIT_LABEL } from '../lib.js';
import { CATEGORIES } from '../data/seed.js';
import type { Product, Variant, Unit, OrganicClaim, SellerDocument } from '../types.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const UNITS: Unit[] = ['g', 'kg', 'bunch', 'piece', 'box'];
const EMOJIS = ['🥭', '🍌', '🍅', '🥬', '🥕', '🌿', '🌱', '🫛', '🍈', '🥑', '🍎', '🍊', '🍇', '🍓', '🥒', '🥦', '🧅', '🧄', '🥔', '🌽', '🫑', '🍆', '🌻'];

const blankProduct = (): Product => ({
  id: '',
  sellerId: '',
  name: '',
  slug: '',
  description: '',
  category: '',
  emoji: '🥬',
  variants: [{ id: 'v1', label: '', sku: '', packSize: 500, unit: 'g', price: 0, stock: 0 }],
  origin: '',
  seasonality: 'year_round',
  seasonMonths: [],
  storage: '',
  organicClaim: 'none',
  status: 'draft',
  available: true,
  minQty: 1,
  maxQty: 10,
  lowStockThreshold: 10,
  archived: false,
  updatedAt: new Date().toISOString(),
});

const page: Page = async ({ root, params, seller }) => {
  const isNew = !params.id;
  let product: Product;
  try {
    product = isNew ? blankProduct() : await api.getProduct(params.id!);
  } catch (e) {
    if (e instanceof api.ApiError && e.status === 404) {
      root.innerHTML = emptyState('Product not found', 'It may have been deleted, or it belongs to a different seller account.', html`<a class="btn btn-primary" href="#/seller/products">Back to products</a>`).value;
      return;
    }
    throw e;
  }
  const docs = (await api.listDocuments()).filter((d) => d.type === 'organic_cert');
  const approved = seller.status === 'approved';
  const readOnly = seller.status === 'suspended';
  let variants: Variant[] = structuredClone(product.variants);
  let slugTouched = !isNew;

  const moderationInfo =
    product.status === 'rejected'
      ? callout('error', 'This listing was rejected', product.moderationNote ?? 'See the reviewer’s note and resubmit.')
      : product.status === 'pending'
        ? callout('info', 'Pending approval', 'This listing is with our moderation team. You can still edit it; saving will keep it in the queue.')
        : product.status === 'approved' && !isNew
          ? callout('info', 'Editing a live listing', 'Price, stock limits and availability update immediately. Changes to name, description, category or organic claim are sent for re-approval.')
          : '';

  root.innerHTML = html`
    ${pageHeader(isNew ? 'Add product' : product.name, isNew ? 'Fill in the details customers see. Save a draft any time.' : `Last updated ${fmtDate(product.updatedAt, true)}`, isNew ? undefined : productBadge(product.status), { href: '/seller/products', label: 'Products' })}
    ${!approved && !readOnly ? callout('warn', 'Drafts only until your account is approved', 'You can prepare listings now. Submitting for approval unlocks once your seller account is approved.') : ''}
    ${readOnly ? callout('error', 'Read-only', 'Your account is suspended, so listings can’t be edited.') : ''}
    ${moderationInfo}
    <form class="product-form" novalidate data-role="form">
      <div class="form-grid">
        <div class="form-main">
          <section class="card">
            <h2 class="card-title">Basics</h2>
            ${field({ name: 'name', label: 'Product name', value: product.name, required: true, attrs: 'maxlength="80" autocomplete="off"' })}
            ${field({ name: 'slug', label: 'URL slug', value: product.slug, required: true, hint: 'Used in the storefront link. Lowercase letters, numbers and hyphens.', attrs: 'maxlength="80"' })}
            <div class="row-2">
              ${select({ name: 'category', label: 'Category', value: product.category, required: true, options: [['', 'Choose…'], ...CATEGORIES.map((c) => [c, c] as [string, string])] })}
              <div class="field">
                <label for="f_emoji">Image placeholder</label>
                <select id="f_emoji" name="emoji" class="emoji-select">${EMOJIS.map((e) => html`<option ${e === product.emoji ? 'selected' : ''}>${e}</option>`)}</select>
                <p class="hint">Photo upload connects to storage in production.</p>
              </div>
            </div>
            ${textarea({ name: 'description', label: 'Description', value: product.description, rows: 4, hint: 'Variety, taste, how it’s grown. At least 20 characters to submit.', attrs: 'maxlength="1200"' })}
          </section>

          <section class="card">
            <div class="card-head"><h2 class="card-title">Variants &amp; pricing</h2><button type="button" class="btn btn-sm" data-action="add-variant">${icon('plus', 14)} Add variant</button></div>
            <p class="muted small">Pack sizes such as 250 g, 500 g, 1 kg, a bunch or a box. ${isNew ? 'Opening stock is recorded in the inventory log.' : 'Stock for existing variants is adjusted on the Inventory page so every change is audited.'}</p>
            <div id="variants"></div>
            <p class="field-error" id="f_variants_err" hidden></p>
            <div class="row-3">
              ${field({ name: 'minQty', label: 'Min order qty', type: 'number', value: product.minQty, attrs: 'min="1" step="1" inputmode="numeric"' })}
              ${field({ name: 'maxQty', label: 'Max order qty', type: 'number', value: product.maxQty, attrs: 'min="1" step="1" inputmode="numeric"' })}
              ${field({ name: 'lowStockThreshold', label: 'Low-stock alert at', type: 'number', value: product.lowStockThreshold, attrs: 'min="0" step="1" inputmode="numeric"' })}
            </div>
            <p class="muted small">Platform commission for this category is set by the marketplace and shown on your Earnings page. It can’t be changed here.</p>
          </section>

          <section class="card">
            <h2 class="card-title">Origin, freshness &amp; storage</h2>
            ${field({ name: 'origin', label: 'Origin', value: product.origin, placeholder: 'e.g. Mulshi, Pune', hint: 'Farm or region where it is grown.' })}
            <fieldset class="field">
              <legend>Seasonality</legend>
              <div class="radio-row">
                <label><input type="radio" name="seasonality" value="year_round" ${product.seasonality === 'year_round' ? 'checked' : ''}/> Available year-round</label>
                <label><input type="radio" name="seasonality" value="seasonal" ${product.seasonality === 'seasonal' ? 'checked' : ''}/> Seasonal</label>
              </div>
            </fieldset>
            <fieldset class="field" id="months-field" ${product.seasonality === 'seasonal' ? '' : raw('hidden')}>
              <legend>In-season months</legend>
              <div class="chip-row" id="f_seasonMonths" tabindex="-1">
                ${MONTHS.map((m, i) => html`<label class="chip"><input type="checkbox" name="month" value="${i + 1}" ${product.seasonMonths.includes(i + 1) ? 'checked' : ''}/><span>${m}</span></label>`)}
              </div>
              <p class="field-error" id="f_seasonMonths_err" hidden></p>
            </fieldset>
            <div class="row-2">
              ${field({ name: 'harvestDate', label: 'Harvest date', type: 'date', value: product.harvestDate, hint: 'Optional. Shown to customers if set.' })}
              ${field({ name: 'packedDate', label: 'Packed date', type: 'date', value: product.packedDate })}
            </div>
            ${textarea({ name: 'storage', label: 'Storage guidance', value: product.storage, rows: 2, placeholder: 'e.g. Refrigerate at 2–4 °C. Best within 3 days.' })}
          </section>
        </div>

        <aside class="form-side">
          <section class="card">
            <h2 class="card-title">Organic claim</h2>
            <p class="muted small">Organic labels appear only when backed by a certificate that a reviewer has verified and that hasn’t expired.</p>
            <fieldset class="field">
              <legend class="sr-only">Organic claim</legend>
              <div class="radio-stack">
                ${(
                  [
                    ['none', 'No organic claim', 'Product is sold without an organic label.'],
                    ['certified', 'Certified organic', 'Requires a linked, verified certificate.'],
                    ['in_conversion', 'In conversion', 'Farm is transitioning; requires a certificate showing conversion status.'],
                  ] as [OrganicClaim, string, string][]
                ).map(([v, l, d]) => html`<label class="radio-card"><input type="radio" name="organicClaim" value="${v}" ${product.organicClaim === v ? 'checked' : ''}/><span><strong>${l}</strong><span class="muted small">${d}</span></span></label>`)}
              </div>
            </fieldset>
            <div id="cert-field" ${product.organicClaim === 'none' ? raw('hidden') : ''}>
              ${select({ name: 'certificateId', label: 'Certificate', value: product.certificateId, options: [['', docs.length ? 'Choose a certificate…' : 'No certificates uploaded'], ...docs.map((d) => [d.id, certLabel(d)] as [string, string])] })}
              <div id="cert-status">${certStatus(docs.find((d) => d.id === product.certificateId))}</div>
              <a class="small link" href="#/seller/documents">Upload a certificate</a>
            </div>
          </section>

          <section class="card">
            <h2 class="card-title">Customer preview</h2>
            <div class="preview" id="preview"></div>
          </section>

          <div class="sticky-actions">
            <p class="form-error" role="alert" hidden id="form-error"></p>
            ${readOnly
              ? ''
              : html`<button type="submit" class="btn btn-primary btn-block" data-submit="submit" ${approved ? '' : raw('disabled aria-describedby="submit-why"')}>
                  ${product.status === 'approved' || product.status === 'inactive' ? 'Save changes' : product.status === 'pending' ? 'Update submission' : 'Submit for approval'}
                </button>
                ${approved ? '' : html`<p class="hint" id="submit-why">Available after account approval.</p>`}
                ${product.status === 'approved' || product.status === 'inactive' ? '' : html`<button type="submit" class="btn btn-block" data-submit="draft">Save draft</button>`}`}
          </div>
        </aside>
      </div>
    </form>`.value;

  const form = $('[data-role=form]', root) as HTMLFormElement;
  if (readOnly) $$('input,select,textarea,button[data-action]', form).forEach((el) => ((el as HTMLInputElement).disabled = true));

  const renderVariants = () => {
    $('#variants', root)!.innerHTML = html`<div class="variant-list">
      ${variants.map(
        (v, i) => html`<fieldset class="variant" data-index="${i}">
          <legend>Variant ${i + 1}</legend>
          <div class="variant-grid">
            ${field({ name: `variant_${i}_label`, label: 'Label', value: v.label, placeholder: '500 g', attrs: `data-v="label" data-i="${i}"` })}
            ${field({ name: `variant_${i}_sku`, label: 'SKU', value: v.sku, placeholder: 'GV-XXX-500', attrs: `data-v="sku" data-i="${i}" autocapitalize="characters"` })}
            ${field({ name: `variant_${i}_packSize`, label: 'Pack size', type: 'number', value: v.packSize, attrs: `data-v="packSize" data-i="${i}" min="0" step="any"` })}
            ${select({ name: `variant_${i}_unit`, label: 'Unit', value: v.unit, options: UNITS.map((u) => [u, UNIT_LABEL[u]] as [string, string]), attrs: `data-v="unit" data-i="${i}"` })}
            ${field({ name: `variant_${i}_price`, label: 'Selling price (₹)', type: 'number', value: v.price || '', attrs: `data-v="price" data-i="${i}" min="0" step="0.01" inputmode="decimal"` })}
            ${field({ name: `variant_${i}_mrp`, label: 'MRP (₹)', type: 'number', value: v.mrp ?? '', hint: 'Optional', attrs: `data-v="mrp" data-i="${i}" min="0" step="0.01" inputmode="decimal"` })}
            ${field({ name: `variant_${i}_stock`, label: isNew || !product.variants.some((x) => x.id === v.id) ? 'Opening stock' : 'Stock', type: 'number', value: v.stock, disabled: !isNew && product.variants.some((x) => x.id === v.id), hint: !isNew && product.variants.some((x) => x.id === v.id) ? 'Change on Inventory page' : undefined, attrs: `data-v="stock" data-i="${i}" min="0" step="1" inputmode="numeric"` })}
          </div>
          ${variants.length > 1 && !readOnly ? html`<button type="button" class="btn btn-sm btn-danger-ghost" data-action="remove-variant" data-i="${i}">Remove variant</button>` : ''}
        </fieldset>`,
      )}</div>`.value;
  };

  const readForm = (): api.ProductInput => {
    const f = formValues(form);
    const months = $$<HTMLInputElement>('input[name=month]:checked', form).map((m) => Number(m.value));
    return {
      ...(isNew ? {} : { id: product.id }),
      name: f.name?.trim() ?? '',
      slug: f.slug?.trim() ?? '',
      description: f.description ?? '',
      category: f.category ?? '',
      emoji: f.emoji ?? '🥬',
      variants: variants.map((v) => ({ ...v, sku: v.sku.trim().toUpperCase() })),
      origin: f.origin ?? '',
      seasonality: (f.seasonality as Product['seasonality']) ?? 'year_round',
      seasonMonths: f.seasonality === 'seasonal' ? months : [],
      harvestDate: f.harvestDate || undefined,
      packedDate: f.packedDate || undefined,
      storage: f.storage ?? '',
      organicClaim: (f.organicClaim as OrganicClaim) ?? 'none',
      certificateId: f.organicClaim !== 'none' ? f.certificateId || undefined : undefined,
      available: product.available,
      minQty: Number(f.minQty),
      maxQty: Number(f.maxQty),
      lowStockThreshold: Number(f.lowStockThreshold),
    } as api.ProductInput;
  };

  const renderPreview = () => {
    const p = readForm();
    const v = p.variants[0];
    const cert = docs.find((d) => d.id === p.certificateId);
    const labelOk = p.organicClaim !== 'none' && cert?.status === 'approved' && (!cert.expiresAt || cert.expiresAt >= new Date().toISOString().slice(0, 10));
    $('#preview', root)!.innerHTML = html`
      <div class="preview-img" aria-hidden="true">${p.emoji}</div>
      <div class="preview-body">
        ${labelOk ? badge(p.organicClaim === 'certified' ? 'Certified organic' : 'In conversion', 'green') : p.organicClaim !== 'none' ? html`<span class="muted small" data-tip="The label shows once a verified, unexpired certificate is linked.">No organic label yet</span>` : ''}
        <strong>${p.name || 'Product name'}</strong>
        <span class="muted small">${p.origin || 'Origin'}</span>
        ${v ? html`<span>${v.price ? money(v.price) : '₹—'} ${v.mrp && v.mrp > v.price ? html`<s class="muted small">${money(v.mrp)}</s>` : ''} <span class="muted small">/ ${v.label || 'pack'}</span></span>` : ''}
      </div>`.value;
  };

  renderVariants();
  renderPreview();

  on(root, 'input', '[data-v]', (_e, el) => {
    const i = Number(el.dataset.i);
    const key = el.dataset.v as keyof Variant;
    const val = (el as HTMLInputElement).value;
    const v = variants[i]!;
    if (key === 'packSize' || key === 'price' || key === 'stock') (v[key] as number) = val === '' ? 0 : Number(val);
    else if (key === 'mrp') {
      if (val === '') delete v.mrp;
      else v.mrp = Number(val);
    } else if (key === 'unit') v.unit = val as Unit;
    else (v[key] as string) = val;
    renderPreview();
  });
  on(root, 'change', '[data-v=unit]', (_e, el) => {
    variants[Number(el.dataset.i)]!.unit = (el as HTMLSelectElement).value as Unit;
  });
  on(root, 'click', '[data-action=add-variant]', () => {
    variants.push({ id: `v${Date.now().toString(36)}`, label: '', sku: '', packSize: 1, unit: 'kg', price: 0, stock: 0 });
    renderVariants();
    ($(`#f_variant_${variants.length - 1}_label`, root) as HTMLInputElement | null)?.focus();
  });
  on(root, 'click', '[data-action=remove-variant]', (_e, el) => {
    variants.splice(Number(el.dataset.i), 1);
    renderVariants();
    renderPreview();
  });
  on(root, 'input', '#f_name', (_e, el) => {
    if (!slugTouched) ($('#f_slug', root) as HTMLInputElement).value = slugify((el as HTMLInputElement).value);
  });
  on(root, 'input', '#f_slug', () => (slugTouched = true));
  on(root, 'input', 'input:not([data-v]),textarea', () => renderPreview());
  on(root, 'change', 'input[name=seasonality]', (_e, el) => {
    $('#months-field', root)!.hidden = (el as HTMLInputElement).value !== 'seasonal';
  });
  on(root, 'change', 'input[name=organicClaim]', (_e, el) => {
    $('#cert-field', root)!.hidden = (el as HTMLInputElement).value === 'none';
    renderPreview();
  });
  on(root, 'change', '#f_certificateId', (_e, el) => {
    $('#cert-status', root)!.innerHTML = certStatus(docs.find((d) => d.id === (el as HTMLSelectElement).value)).value;
    renderPreview();
  });
  on(root, 'change', '#f_emoji', () => renderPreview());

  let submitter: string = 'draft';
  on(root, 'click', '[data-submit]', (_e, el) => (submitter = el.dataset.submit!));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const submit = submitter === 'submit';
    const btns = $$<HTMLButtonElement>('[data-submit]', form);
    btns.forEach((b) => (b.disabled = true));
    const errBox = $('#form-error', root)!;
    errBox.hidden = true;
    try {
      const saved = await api.saveProduct(readForm(), submit);
      toast(submit ? (saved.status === 'pending' ? (product.status === 'approved' ? 'Changes saved — sent for re-approval' : 'Sent for approval') : 'Changes saved') : 'Draft saved');
      navigate(`/seller/products/${saved.id}`, isNew);
    } catch (err) {
      const ae = err as api.ApiError;
      errBox.textContent = ae.message;
      errBox.hidden = false;
      if (ae.fieldErrors) showFieldErrors(form, ae.fieldErrors);
      // Form data stays in place, nothing is lost on failure.
      btns.forEach((b) => (b.disabled = b.dataset.submit === 'submit' && !approved));
    }
  });
};

function certLabel(d: SellerDocument) {
  return `${d.certNumber ?? d.fileName}${d.status === 'approved' ? '' : d.status === 'pending' ? ' (awaiting review)' : ' (rejected)'}`;
}

function certStatus(d?: SellerDocument) {
  if (!d) return html``;
  const today = new Date().toISOString().slice(0, 10);
  if (d.status === 'pending') return html`<p class="small warn-text">${icon('alert', 14)} Not yet verified. The organic label stays hidden until a reviewer approves it.</p>`;
  if (d.status === 'rejected') return html`<p class="small error-text">${icon('alert', 14)} Rejected: ${d.reviewerNote ?? 'see Documents'}.</p>`;
  if (d.expiresAt && d.expiresAt < today) return html`<p class="small error-text">${icon('alert', 14)} Expired ${fmtDate(d.expiresAt)}.</p>`;
  return html`<p class="small ok-text">${icon('check', 14)} Verified · expires ${d.expiresAt ? fmtDate(d.expiresAt) : '—'}${d.certScope ? html`<br/><span class="muted">Scope: ${d.certScope}</span>` : ''}</p>`;
}

export default page;
