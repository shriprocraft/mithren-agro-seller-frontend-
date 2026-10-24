// App shell: routes, layout chrome, notifications and prototype controls.

import * as api from './api.js';
import { route, match, currentLocation, navigate, type PageContext } from './router.js';
import { html, raw, $, on } from './ui/dom.js';
import { icon, sellerBadge, callout, errorState, loadingState, emptyState } from './ui/components.js';
import { modal, toast, initTooltips } from './ui/overlay.js';
import { timeAgo, SELLER_STATUS_LABEL } from './lib.js';
import type { Seller, SellerStatus } from './types.js';

// ---------- routes (source: scope doc §9) ----------
route('/seller', 'Seller portal', async () => (await import('./pages/entry.js')).default);
route('/seller/register', 'Seller registration', async () => (await import('./pages/register.js')).default);
route('/seller/dashboard', 'Dashboard', async () => (await import('./pages/dashboard.js')).default, 'dashboard');
route('/seller/products', 'Products', async () => (await import('./pages/products.js')).default, 'products');
route('/seller/products/new', 'New product', async () => (await import('./pages/product-form.js')).default, 'products');
route('/seller/products/:id', 'Edit product', async () => (await import('./pages/product-form.js')).default, 'products');
route('/seller/orders', 'Orders', async () => (await import('./pages/orders.js')).default, 'orders');
route('/seller/orders/:id', 'Order details', async () => (await import('./pages/order-detail.js')).default, 'orders');
route('/seller/inventory', 'Inventory', async () => (await import('./pages/inventory.js')).default, 'inventory');
route('/seller/earnings', 'Earnings', async () => (await import('./pages/earnings.js')).default, 'earnings');
route('/seller/settlements', 'Settlements', async () => (await import('./pages/settlements.js')).default, 'settlements');
route('/seller/reviews', 'Reviews', async () => (await import('./pages/reviews.js')).default, 'reviews');
route('/seller/store-settings', 'Store settings', async () => (await import('./pages/store-settings.js')).default, 'store-settings');
route('/seller/documents', 'Documents', async () => (await import('./pages/documents.js')).default, 'documents');

const NAV: { group: string; items: { key: string; label: string; icon: string; href: string }[] }[] = [
  { group: 'Overview', items: [{ key: 'dashboard', label: 'Dashboard', icon: 'dashboard', href: '/seller/dashboard' }] },
  {
    group: 'Catalogue',
    items: [
      { key: 'products', label: 'Products', icon: 'products', href: '/seller/products' },
      { key: 'inventory', label: 'Inventory', icon: 'inventory', href: '/seller/inventory' },
    ],
  },
  {
    group: 'Sales',
    items: [
      { key: 'orders', label: 'Orders', icon: 'orders', href: '/seller/orders' },
      { key: 'reviews', label: 'Reviews', icon: 'reviews', href: '/seller/reviews' },
    ],
  },
  {
    group: 'Finance',
    items: [
      { key: 'earnings', label: 'Earnings', icon: 'earnings', href: '/seller/earnings' },
      { key: 'settlements', label: 'Settlements', icon: 'settlements', href: '/seller/settlements' },
    ],
  },
  {
    group: 'Account',
    items: [
      { key: 'store-settings', label: 'Store settings', icon: 'settings', href: '/seller/store-settings' },
      { key: 'documents', label: 'Documents', icon: 'documents', href: '/seller/documents' },
    ],
  },
];

const app = $('#app')!;
let renderToken = 0;

function shell(seller: Seller, navKey: string | undefined, bare: boolean) {
  const initials = seller.ownerName.split(' ').map((p) => p[0]).join('').slice(0, 2);
  return html`
    <a class="skip-link" href="#main" data-skip>Skip to content</a>
    <div class="layout ${bare ? 'layout-bare' : ''}">
      ${bare
        ? ''
        : html`<aside class="sidebar" id="sidebar" aria-label="Seller navigation">
            <div class="brand brand-logo">
              <img src="assets/mithren-logo.png" alt="Mithren Agro Pvt. Ltd." width="168" height="78" />
              <span>Seller Portal</span>
            </div>
            <nav>
              ${NAV.map(
                (g) => html`<div class="nav-group">
                  <p class="nav-heading">${g.group}</p>
                  <ul>
                    ${g.items.map(
                      (it) => html`<li><a href="#${it.href}" class="nav-link ${navKey === it.key ? 'active' : ''}" ${navKey === it.key ? raw('aria-current="page"') : ''}>
                        ${icon(it.icon, 18)}<span>${it.label}</span><span class="nav-count" data-count="${it.key}" hidden></span></a></li>`,
                    )}
                  </ul>
                </div>`,
              )}
            </nav>
            <div class="sidebar-foot">
              <a href="mailto:${seller.supportEmail}" class="nav-link">${icon('external', 18)}<span>Seller support</span></a>
            </div>
          </aside>
          <div class="scrim" data-action="close-nav" hidden></div>`}
      <div class="main-col">
        <header class="topbar">
          ${bare ? html`<div class="brand brand-inline"><img src="assets/mithren-logo.png" alt="Mithren Agro Pvt. Ltd." width="86" height="40" /><span>Seller Portal</span></div>` : html`<button class="icon-btn menu-btn" type="button" data-action="open-nav" aria-label="Open navigation" aria-controls="sidebar" aria-expanded="false">${icon('menu', 22)}</button>`}
          <div class="topbar-shop">
            <span class="shop-avatar" style="background:${seller.brandColor}" aria-hidden="true">${seller.shopName.slice(0, 1)}</span>
            <div class="shop-meta"><strong>${seller.status === 'not_registered' ? 'New seller' : seller.shopName}</strong>${sellerBadge(seller.status)}</div>
          </div>
          <div class="topbar-actions">
            <button class="btn btn-ghost btn-sm proto-btn" type="button" data-action="proto" aria-haspopup="dialog">${icon('flask', 16)}<span>Prototype controls</span></button>
            <div class="notif-wrap">
              <button class="icon-btn" type="button" data-action="notifs" aria-haspopup="true" aria-expanded="false" aria-controls="notif-panel" aria-label="Notifications">
                ${icon('bell', 20)}<span class="dot" data-unread hidden></span>
              </button>
              <div class="notif-panel" id="notif-panel" hidden></div>
            </div>
            <span class="avatar" title="${seller.ownerName}" aria-label="Signed in as ${seller.ownerName}" role="img">${initials}</span>
          </div>
        </header>
        <div class="proto-banner" role="note">
          ${icon('flask', 14)} Frontend prototype · fictional demo data saved in this browser · no real orders, payments or messages are sent
        </div>
        <main id="main" tabindex="-1"></main>
      </div>
    </div>`;
}

function statusBanner(s: Seller) {
  if (s.status === 'approved' || s.status === 'not_registered') return '';
  if (s.status === 'suspended')
    return callout('error', 'Your account is suspended', s.reviewMessage ?? 'Listings are hidden from customers and the portal is read-only.', html`<a class="btn btn-sm" href="mailto:${s.supportEmail}">Contact support</a>`);
  return callout(
    s.status === 'rejected' ? 'error' : 'warn',
    `Application status: ${SELLER_STATUS_LABEL[s.status]}`,
    'You can explore the portal and prepare draft listings, but nothing is visible to customers until your account is approved.',
    html`<a class="btn btn-sm" href="#/seller">View status</a>`,
  );
}

async function render() {
  const token = ++renderToken;
  const { path, query } = currentLocation();
  const m = match(path);
  let seller: Seller;
  try {
    seller = await api.getSeller();
  } catch (e) {
    app.innerHTML = errorState((e as Error).message).value;
    return;
  }
  if (token !== renderToken) return;

  // Onboarding gate: unregistered sellers can only reach registration.
  if (seller.status === 'not_registered' && path !== '/seller/register') return navigate('/seller/register', true);
  if (seller.status !== 'not_registered' && path === '/seller/register') return navigate('/seller', true);

  const bare = path === '/seller/register';
  app.innerHTML = shell(seller, m?.route.nav, bare).value;
  const main = $('#main')!;
  document.title = `${m?.route.title ?? 'Not found'} · Mithren Agro Seller Portal`;

  const banner = bare || path === '/seller' ? '' : statusBanner(seller);
  if (!m) {
    main.innerHTML = html`${banner}<div class="page">${emptyState('Page not found', `There is no seller page at ${path}.`, html`<a class="btn btn-primary" href="#/seller/dashboard">Go to dashboard</a>`)}</div>`.value;
    return;
  }
  main.innerHTML = html`${banner}<div class="page">${loadingState(6)}</div>`.value;
  updateBadges();

  const page = await m.route.page();
  if (token !== renderToken) return;
  const container = document.createElement('div');
  container.className = 'page';
  const ctx: PageContext = { root: container, params: m.params, query, seller, refresh: () => void rerenderPage(), isCurrent: () => token === renderToken };

  async function rerenderPage() {
    // Preserve focus (e.g. a search box) across re-renders.
    const active = document.activeElement as HTMLInputElement | null;
    const activeId = active?.id;
    const sel = active && 'selectionStart' in active ? [active.selectionStart, active.selectionEnd] : null;
    const fresh = document.createElement('div');
    fresh.className = 'page';
    const newSeller = await api.getSeller();
    const c2: PageContext = { ...ctx, root: fresh, seller: newSeller, query: currentLocation().query };
    try {
      await page(c2);
      if (token !== renderToken) return;
      const old = main.querySelector('.page');
      old?.replaceWith(fresh);
      ctx.root = fresh;
      if (activeId) {
        const el = document.getElementById(activeId) as HTMLInputElement | null;
        el?.focus({ preventScroll: true });
        if (el && sel && sel[0] !== null && typeof el.setSelectionRange === 'function') {
          try {
            el.setSelectionRange(sel[0], sel[1]);
          } catch {
            /* not a text input */
          }
        }
      }
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  }

  try {
    await page(ctx);
  } catch (e) {
    container.innerHTML = errorState((e as Error).message).value;
    container.querySelector('[data-action=retry]')?.addEventListener('click', () => void render());
  }
  if (token !== renderToken) return;
  main.querySelector('.page')?.replaceWith(container);
}

// ---------- chrome behaviour ----------
// Delegated on #app, which persists across renders, so bind exactly once.
function bindShell() {
  const root = app;
  on(root, 'click', '[data-action=open-nav]', (_e, btn) => setNav(true, btn));
  on(root, 'click', '[data-action=close-nav]', () => setNav(false));
  on(root, 'click', '.sidebar .nav-link', () => setNav(false));
  on(root, 'click', '[data-skip]', (e) => {
    e.preventDefault();
    $('#main')?.focus();
  });
  on(root, 'click', '[data-action=proto]', () => openPrototypeControls());
  on(root, 'click', '[data-action=notifs]', (_e, btn) => void toggleNotifications(btn));
}

function setNav(open: boolean, btn?: HTMLElement) {
  const sb = $('#sidebar');
  const scrim = $('.scrim');
  const menu = btn ?? $('[data-action=open-nav]');
  sb?.classList.toggle('open', open);
  if (scrim) scrim.hidden = !open;
  menu?.setAttribute('aria-expanded', String(open));
  if (open) (sb?.querySelector('a') as HTMLElement | null)?.focus();
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if ($('#sidebar.open')) setNav(false);
    const panel = $('#notif-panel');
    if (panel && !panel.hidden) closeNotifications();
  }
});

async function updateBadges() {
  try {
    const [orders, notifs] = await Promise.all([api.listOrders({ status: 'awaiting_confirmation' }), api.listNotifications()]);
    const c = $('[data-count=orders]');
    if (c) {
      c.hidden = orders.length === 0;
      c.textContent = String(orders.length);
      c.setAttribute('aria-label', `${orders.length} awaiting confirmation`);
    }
    const unread = notifs.filter((n) => !n.read).length;
    const dot = $('[data-unread]');
    if (dot) dot.hidden = unread === 0;
    $('[data-action=notifs]')?.setAttribute('aria-label', `Notifications, ${unread} unread`);
  } catch {
    /* badges are non-critical */
  }
}

function closeNotifications() {
  const panel = $('#notif-panel');
  if (panel) panel.hidden = true;
  $('[data-action=notifs]')?.setAttribute('aria-expanded', 'false');
}

async function toggleNotifications(btn: HTMLElement) {
  const panel = $('#notif-panel')!;
  if (!panel.hidden) return closeNotifications();
  panel.hidden = false;
  btn.setAttribute('aria-expanded', 'true');
  panel.innerHTML = loadingState(3).value;
  const items = await api.listNotifications();
  panel.innerHTML = html`
    <div class="notif-head"><strong>Notifications</strong><button class="link-btn" type="button" data-action="read-all">Mark all read</button></div>
    ${items.length
      ? html`<ul class="notif-list">${items.slice(0, 12).map(
          (n) => html`<li class="${n.read ? '' : 'unread'}"><a href="#${n.link ?? '/seller'}" data-id="${n.id}">
            <strong>${n.title}</strong><span>${n.body}</span><time datetime="${n.at}">${timeAgo(n.at)}</time></a></li>`,
        )}</ul>`
      : html`<p class="muted pad">You’re all caught up.</p>`}
    <p class="notif-foot muted">In-app only in this prototype. Email/SMS delivery needs a configured provider.</p>`.value;
  panel.querySelector('[data-action=read-all]')?.addEventListener('click', async () => {
    await api.markNotificationsRead();
    closeNotifications();
    updateBadges();
  });
  panel.querySelectorAll<HTMLAnchorElement>('a[data-id]').forEach((a) =>
    a.addEventListener('click', () => {
      void api.markNotificationsRead([a.dataset.id!]);
      closeNotifications();
    }),
  );
  setTimeout(() => {
    const outside = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('.notif-wrap')) {
        closeNotifications();
        document.removeEventListener('click', outside);
      }
    };
    document.addEventListener('click', outside);
  });
}

function openPrototypeControls() {
  void api.getSeller().then((s) => {
    const statuses: SellerStatus[] = ['not_registered', 'submitted', 'under_review', 'changes_requested', 'approved', 'rejected', 'suspended'];
    modal({
      title: 'Prototype controls',
      body: html`
        <div class="stack">
          <p class="muted">These controls stand in for systems outside the Seller Portal (Admin review, checkout, delivery, network). They don’t exist in production.</p>
          <div class="field">
            <label for="proto-status">Seller account status <span class="muted">(Admin review workflow)</span></label>
            <select id="proto-status">${statuses.map((st) => html`<option value="${st}" ${st === s.status ? raw('selected') : ''}>${SELLER_STATUS_LABEL[st]}</option>`)}</select>
          </div>
          <div class="proto-grid">
            <button class="btn" type="button" data-p="order">${icon('orders', 16)} Simulate a new customer order</button>
            <label class="switch"><input type="checkbox" id="proto-fail" ${api.sim.failWrites ? raw('checked') : ''}/> <span>Simulate network failure on save</span></label>
          </div>
          <div class="proto-iso">
            <p><strong>Seller isolation check</strong> — try to open another seller’s records. The API answers “not found”.</p>
            <div class="row-wrap">
              <a class="btn btn-sm" href="#/seller/products/p_sr_kale" data-close>Seller B product</a>
              <a class="btn btn-sm" href="#/seller/orders/SO-48300-SR" data-close>Seller B order</a>
            </div>
          </div>
          <div class="modal-actions">
            <button class="btn btn-danger-ghost" type="button" data-p="reset">Reset demo data</button>
            <button class="btn btn-primary" type="button" data-close>Done</button>
          </div>
        </div>`,
      onMount(el, close) {
        el.querySelector('#proto-status')!.addEventListener('change', async (e) => {
          const st = (e.target as HTMLSelectElement).value as SellerStatus;
          await api._demoSetSellerStatus(st);
          toast(`Account status set to “${SELLER_STATUS_LABEL[st]}”`, 'info');
          close();
          navigate(st === 'not_registered' ? '/seller/register' : '/seller');
          void render();
        });
        el.querySelector('#proto-fail')!.addEventListener('change', (e) => {
          api.sim.failWrites = (e.target as HTMLInputElement).checked;
          toast(api.sim.failWrites ? 'Saves will now fail with a network error' : 'Network restored', 'info');
        });
        el.querySelector('[data-p=order]')!.addEventListener('click', async () => {
          try {
            const o = await api._demoSimulateNewOrder();
            toast(`New order ${o.id} received`, 'info');
            close();
            navigate(`/seller/orders/${o.id}`);
          } catch (err) {
            toast((err as Error).message, 'error');
          }
        });
        el.querySelector('[data-p=reset]')!.addEventListener('click', () => {
          api.resetDemoData();
          api.sim.failWrites = false;
          toast('Demo data reset', 'info');
          close();
          navigate('/seller/dashboard');
          void render();
        });
      },
    });
  });
}

api.onDataChange(() => void updateBadges());
window.addEventListener('hashchange', () => {
  closeNotifications();
  void render().then(() => {
    window.scrollTo(0, 0);
    // Move focus to the new page for keyboard and screen-reader users.
    ($('#main h1') as HTMLElement | null)?.setAttribute('tabindex', '-1');
    ($('#main h1') as HTMLElement | null)?.focus({ preventScroll: true });
  });
});
initTooltips();
bindShell();
void render();
