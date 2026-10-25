// Shared presentational components. All return escaped HTML via `html`.

import { html, raw, esc, type Raw, $, $$ } from './dom.js';
import { ORDER_STATUS_LABEL, PRODUCT_STATUS_LABEL, SETTLEMENT_LABEL, SELLER_STATUS_LABEL } from '../lib.js';
import type { OrderStatus, ProductStatus, SettlementState, SellerStatus } from '../types.js';

// ---------- icons (24px stroke icons, drawn for this project) ----------
const ICONS: Record<string, string> = {
  dashboard: '<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>',
  products: '<path d="M12 3c4 2 7 5 7 10a7 7 0 0 1-14 0c0-5 3-8 7-10Z"/><path d="M12 8v13"/>',
  orders: '<path d="M6 7h12l-1 13H7L6 7Z"/><path d="M9 7a3 3 0 0 1 6 0"/>',
  inventory: '<path d="M3 8l9-5 9 5-9 5-9-5Z"/><path d="M3 8v8l9 5 9-5V8"/><path d="M12 13v8"/>',
  earnings: '<path d="M4 19V9M10 19V5M16 19v-7M22 19H2"/>',
  settlements: '<rect x="2" y="6" width="20" height="13" rx="2"/><path d="M2 10h20M6 15h4"/>',
  reviews: '<path d="M12 3l2.6 5.6 6.1.6-4.6 4.1 1.3 6L12 16.3 6.6 19.3l1.3-6L3.3 9.2l6.1-.6L12 3Z"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/>',
  documents: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9l-6-6Z"/><path d="M14 3v6h6M8 13h8M8 17h5"/>',
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  close: '<path d="M18 6 6 18M6 6l12 12"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  alert: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4M12 17h.01"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8h.01"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/>',
  flask: '<path d="M9 3h6M10 3v6L4.5 18.5A1.7 1.7 0 0 0 6 21h12a1.7 1.7 0 0 0 1.5-2.5L14 9V3"/><path d="M7 15h10"/>',
  arrowLeft: '<path d="M19 12H5M12 19l-7-7 7-7"/>',
  leaf: '<path d="M11 20A7 7 0 0 1 4 13c0-6 6-10 16-10 0 10-4 16-10 16"/><path d="M4 21c3-6 7-9 12-11"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4.5 21a7.5 7.5 0 0 1 15 0"/>',
  chevronDown: '<path d="m6 9 6 6 6-6"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
  truck: '<path d="M1 4h14v12H1zM15 9h4l4 4v3h-8"/><circle cx="6" cy="18" r="2"/><circle cx="18" cy="18" r="2"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/>',
  external: '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14 21 3"/>',
};

export function icon(name: keyof typeof ICONS | string, size = 18, label?: string): Raw {
  const body = ICONS[name] ?? ICONS.info!;
  const a11y = label ? `role="img" aria-label="${esc(label)}"` : 'aria-hidden="true"';
  return raw(`<svg class="icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" ${a11y}>${body}</svg>`);
}

// ---------- badges ----------
type Tone = 'neutral' | 'green' | 'amber' | 'red' | 'blue' | 'purple';

export const badge = (text: string, tone: Tone = 'neutral') => html`<span class="badge badge-${tone}">${text}</span>`;

const ORDER_TONE: Record<OrderStatus, Tone> = {
  awaiting_confirmation: 'amber',
  accepted: 'blue',
  packed: 'blue',
  ready_for_pickup: 'purple',
  in_transit: 'purple',
  delivered: 'green',
  rejected: 'red',
  cancelled: 'red',
  return_requested: 'amber',
  returned: 'neutral',
};
export const orderBadge = (s: OrderStatus) => badge(ORDER_STATUS_LABEL[s], ORDER_TONE[s]);

const PRODUCT_TONE: Record<ProductStatus, Tone> = { draft: 'neutral', pending: 'amber', approved: 'green', rejected: 'red', inactive: 'neutral' };
export const productBadge = (s: ProductStatus) => badge(PRODUCT_STATUS_LABEL[s], PRODUCT_TONE[s]);

const SETTLE_TONE: Record<SettlementState, Tone> = { pending: 'neutral', eligible: 'blue', processing: 'amber', paid: 'green', failed: 'red', reversed: 'purple' };
export const settlementBadge = (s: SettlementState) => badge(SETTLEMENT_LABEL[s], SETTLE_TONE[s]);

const SELLER_TONE: Record<SellerStatus, Tone> = {
  incomplete: 'neutral',
  pending: 'amber',
  changes_requested: 'amber',
  approved: 'green',
  rejected: 'red',
  suspended: 'red',
};
export const sellerBadge = (s: SellerStatus) => badge(SELLER_STATUS_LABEL[s], SELLER_TONE[s]);

// ---------- layout pieces ----------
export function pageHeader(title: string, subtitle?: string, actions?: Raw, back?: { href: string; label: string }) {
  return html`
    <header class="page-header">
      <div>
        ${back ? html`<a class="back-link" href="#${back.href}">${icon('arrowLeft', 16)} ${back.label}</a>` : ''}
        <h1>${title}</h1>
        ${subtitle ? html`<p class="muted">${subtitle}</p>` : ''}
      </div>
      ${actions ? html`<div class="page-actions">${actions}</div>` : ''}
    </header>`;
}

export function callout(tone: 'info' | 'warn' | 'error' | 'success', title: string, body?: Raw | string, action?: Raw) {
  const ic = tone === 'success' ? 'check' : tone === 'info' ? 'info' : 'alert';
  return html`
    <div class="callout callout-${tone}" role="${tone === 'error' ? 'alert' : 'status'}">
      ${icon(ic, 20)}
      <div class="callout-body">
        <strong>${title}</strong>
        ${body ? html`<div>${body}</div>` : ''}
      </div>
      ${action ?? ''}
    </div>`;
}

export function emptyState(title: string, body: string, action?: Raw) {
  return html`
    <div class="empty">
      <div class="empty-art" aria-hidden="true">${icon('leaf', 28)}</div>
      <h3>${title}</h3>
      <p class="muted">${body}</p>
      ${action ?? ''}
    </div>`;
}

export function errorState(message: string) {
  return html`
    <div class="empty">
      <div class="empty-art empty-art-error" aria-hidden="true">${icon('alert', 28)}</div>
      <h3>Something went wrong</h3>
      <p class="muted">${message}</p>
      <button class="btn" type="button" data-action="retry">Try again</button>
    </div>`;
}

export function loadingState(rows = 4) {
  return html`<div class="skeleton-wrap" aria-busy="true" aria-label="Loading">
    ${Array.from({ length: rows }, (_, i) => html`<div class="skeleton" style="width:${90 - i * 12}%"></div>`)}
  </div>`;
}

// ---------- form fields ----------
interface FieldOpts {
  name: string;
  label: string;
  value?: string | number | undefined;
  type?: string;
  hint?: string;
  error?: string | undefined;
  required?: boolean;
  placeholder?: string;
  attrs?: string;
  disabled?: boolean;
}

export function field(o: FieldOpts) {
  const id = `f_${o.name}`;
  const describedBy = [o.hint ? `${id}_hint` : '', o.error ? `${id}_err` : ''].filter(Boolean).join(' ');
  return html`
    <div class="field ${o.error ? 'has-error' : ''}">
      <label for="${id}">${o.label}${o.required ? html`<span class="req" aria-hidden="true"> *</span>` : ''}</label>
      <input id="${id}" name="${o.name}" type="${o.type ?? 'text'}" value="${o.value ?? ''}"
        ${o.required ? raw('required') : ''} ${o.disabled ? raw('disabled') : ''}
        ${o.placeholder ? raw(`placeholder="${esc(o.placeholder)}"`) : ''}
        ${describedBy ? raw(`aria-describedby="${describedBy}"`) : ''}
        ${o.error ? raw('aria-invalid="true"') : ''} ${raw(o.attrs ?? '')} />
      ${o.hint ? html`<p class="hint" id="${id}_hint">${o.hint}</p>` : ''}
      <p class="field-error" id="${id}_err" ${o.error ? '' : raw('hidden')}>${o.error ?? ''}</p>
    </div>`;
}

export function textarea(o: FieldOpts & { rows?: number }) {
  const id = `f_${o.name}`;
  return html`
    <div class="field ${o.error ? 'has-error' : ''}">
      <label for="${id}">${o.label}${o.required ? html`<span class="req" aria-hidden="true"> *</span>` : ''}</label>
      <textarea id="${id}" name="${o.name}" rows="${o.rows ?? 4}" ${o.required ? raw('required') : ''} ${o.disabled ? raw('disabled') : ''}
        ${o.placeholder ? raw(`placeholder="${esc(o.placeholder)}"`) : ''} aria-describedby="${id}_hint ${id}_err" ${o.error ? raw('aria-invalid="true"') : ''} ${raw(o.attrs ?? '')}>${o.value ?? ''}</textarea>
      ${o.hint ? html`<p class="hint" id="${id}_hint">${o.hint}</p>` : ''}
      <p class="field-error" id="${id}_err" ${o.error ? '' : raw('hidden')}>${o.error ?? ''}</p>
    </div>`;
}

export function select(o: FieldOpts & { options: [string, string][] }) {
  const id = `f_${o.name}`;
  return html`
    <div class="field ${o.error ? 'has-error' : ''}">
      <label for="${id}">${o.label}${o.required ? html`<span class="req" aria-hidden="true"> *</span>` : ''}</label>
      <select id="${id}" name="${o.name}" ${o.required ? raw('required') : ''} ${o.disabled ? raw('disabled') : ''} aria-describedby="${id}_hint ${id}_err" ${o.error ? raw('aria-invalid="true"') : ''} ${raw(o.attrs ?? '')}>
        ${o.options.map(([v, l]) => html`<option value="${v}" ${String(o.value ?? '') === v ? raw('selected') : ''}>${l}</option>`)}
      </select>
      ${o.hint ? html`<p class="hint" id="${id}_hint">${o.hint}</p>` : ''}
      <p class="field-error" id="${id}_err" ${o.error ? '' : raw('hidden')}>${o.error ?? ''}</p>
    </div>`;
}

/** Writes server-side field errors back into a rendered form. */
export function showFieldErrors(form: HTMLElement, errors: Record<string, string>) {
  $$('.field.has-error', form).forEach((f) => f.classList.remove('has-error'));
  $$('.field-error', form).forEach((e) => {
    e.hidden = true;
    e.textContent = '';
  });
  $$('[aria-invalid]', form).forEach((e) => e.removeAttribute('aria-invalid'));
  let first: HTMLElement | null = null;
  for (const [name, msg] of Object.entries(errors)) {
    const err = $(`#f_${CSS.escape(name)}_err`, form);
    const input = $(`#f_${CSS.escape(name)}`, form);
    if (err) {
      err.textContent = msg;
      err.hidden = false;
      err.closest('.field')?.classList.add('has-error');
    }
    if (input) {
      input.setAttribute('aria-invalid', 'true');
      first ??= input;
    }
  }
  first?.focus();
}

// ---------- metric tile ----------
export function metric(o: { label: string; value: string; definition: string; delta?: number | null; deltaGoodWhenUp?: boolean; href?: string; tone?: 'warn' }) {
  let deltaHtml: Raw | string = '';
  if (o.delta !== undefined && o.delta !== null && Number.isFinite(o.delta)) {
    const up = o.delta >= 0;
    const good = o.deltaGoodWhenUp === false ? !up : up;
    deltaHtml = html`<span class="delta ${good ? 'delta-good' : 'delta-bad'}">${up ? '▲' : '▼'} ${Math.abs(o.delta * 100).toFixed(0)}% <span class="sr-only">vs previous period</span></span>`;
  }
  const inner = html`
    <div class="metric-label">
      <span>${o.label}</span>
      <button type="button" class="info-btn" aria-label="How is ${o.label} calculated?" data-tip="${o.definition}">${icon('info', 14)}</button>
    </div>
    <div class="metric-value">${o.value}</div>
    ${deltaHtml}`;
  return o.href
    ? html`<a class="metric ${o.tone === 'warn' ? 'metric-warn' : ''}" href="#${o.href}">${inner}</a>`
    : html`<div class="metric ${o.tone === 'warn' ? 'metric-warn' : ''}">${inner}</div>`;
}

export function stars(rating: number, size = 14) {
  const full = Math.round(rating);
  return html`<span class="stars" role="img" aria-label="${rating} out of 5 stars">${Array.from({ length: 5 }, (_, i) =>
    raw(`<svg width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true" class="${i < full ? 'star-on' : 'star-off'}"><path d="M12 3l2.6 5.6 6.1.6-4.6 4.1 1.3 6L12 16.3 6.6 19.3l1.3-6L3.3 9.2l6.1-.6L12 3Z"/></svg>`),
  )}</span>`;
}

export function tabs(items: { href: string; label: string; count?: number; active: boolean }[], label: string) {
  return html`<nav class="tabs" aria-label="${label}">
    ${items.map((t) => html`<a href="#${t.href}" class="tab ${t.active ? 'active' : ''}" ${t.active ? raw('aria-current="page"') : ''}>${t.label}${t.count !== undefined ? html` <span class="tab-count">${t.count}</span>` : ''}</a>`)}
  </nav>`;
}
