// App shell: routes, layout chrome, notifications and prototype controls.

import * as api from './api.js';
import { route, match, currentLocation, navigate, type PageContext } from './router.js';
import { html, raw, $, on } from './ui/dom.js';
import { icon, sellerBadge, callout, errorState, loadingState, emptyState } from './ui/components.js';
import { modal, toast, initTooltips } from './ui/overlay.js';
import { timeAgo, SELLER_STATUS_LABEL } from './lib.js';
import type { Seller } from './types.js';
import type { AccountView } from './application.js';

// ---------- routes (source: scope doc §9) ----------
route('/seller', 'Seller portal', async () => (await import('./pages/entry.js')).default);
route('/seller/register', 'Seller registration', async () => (await import('./pages/register.js')).default);
route('/seller/sign-in', 'Sign in', async () => (await import('./pages/sign-in.js')).default);
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

/** Pages reachable without signing in. */
const PUBLIC_PATHS = ['/seller/sign-in', '/seller/register'];

/** Placeholder for the shell while nobody is signed in (no seller data is shown). */
const GUEST: Seller = { shopName: '', ownerName: '', brandColor: '#2e7d32', status: 'incomplete', supportEmail: 'seller-support@mithrenagro.example' } as Seller;

function shell(seller: Seller, navKey: string | undefined, bare: boolean, account: AccountView | null) {
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
          ${account
            ? html`<div class="topbar-shop">
                <span class="shop-avatar" style="background:${seller.brandColor}" aria-hidden="true">${(seller.shopName || account.fullName).slice(0, 1)}</span>
                <div class="shop-meta"><strong>${seller.shopName || 'New seller'}</strong>${sellerBadge(seller.status)}</div>
              </div>
              <div class="topbar-actions">
                ${bare
                  ? ''
                  : html`<div class="action-pill">
                      <div class="notif-wrap">
                        <button class="icon-btn" type="button" data-action="notifs" aria-haspopup="true" aria-expanded="false" aria-controls="notif-panel" aria-label="Notifications">
                          ${icon('bell', 21)}<span class="dot" data-unread hidden></span>
                        </button>
                        <div class="notif-panel" id="notif-panel" hidden></div>
                      </div>
                    </div>`}
                <div class="account-wrap">
                  <button class="account-trigger" type="button" data-action="account" aria-haspopup="true" aria-expanded="false" aria-controls="account-menu" aria-label="Account menu for ${account.fullName}" title="${account.fullName}">
                    <span class="account-avatar" aria-hidden="true">${icon('user', 22)}</span>
                    <span class="account-label">Account</span>
                    <span class="account-chevron" aria-hidden="true">${icon('chevronDown', 18)}</span>
                  </button>
                  <div class="account-menu" id="account-menu" hidden>
                    <p><strong>${account.fullName}</strong><span class="muted small block">${account.email}</span></p>
                    <a href="#/seller?view=status" class="account-link">Application status</a>
                    <button type="button" class="account-link" data-action="sign-out">${icon('logout', 16)} Sign out</button>
                  </div>
                </div>
              </div>`
            : html`<div class="topbar-actions"><a class="btn btn-sm" href="#/seller/sign-in">Sign in</a></div>`}
        </header>
        <main id="main" tabindex="-1"></main>
        <footer class="app-footer">
          <p>Powered by <a href="https://shriprocraft.com/" target="_blank" rel="noopener noreferrer">Shri Pro Craft</a></p>
        </footer>
      </div>
    </div>`;
}

function statusBanner(s: Seller) {
  if (s.status === 'approved') return '';
  if (s.status === 'suspended')
    return callout('error', 'Your account is suspended', s.reviewMessage ?? 'Listings are hidden from customers and the portal is read-only.', html`<a class="btn btn-sm" href="mailto:${s.supportEmail}">Contact support</a>`);
  return callout(
    s.status === 'rejected' ? 'error' : 'warn',
    `Application status: ${SELLER_STATUS_LABEL[s.status]}`,
    s.status === 'incomplete'
      ? 'Finish your seller application to submit it for review. You can prepare draft listings, but nothing can be published until your account is approved.'
      : 'You can prepare draft listings, but nothing can be published for sale until your account is approved.',
    html`<a class="btn btn-sm" href="#/seller">View status</a>`,
  );
}

async function render() {
  const token = ++renderToken;
  const { path, query } = currentLocation();
  const m = match(path);
  let account: AccountView | null;
  let seller: Seller = GUEST;
  try {
    account = await api.auth.current();
    if (account) seller = await api.getSeller();
  } catch (e) {
    if (e instanceof api.ApiError && e.status === 401) account = null;
    else {
      app.innerHTML = errorState((e as Error).message).value;
      app.querySelector('[data-action=retry]')?.addEventListener('click', () => void render());
      return;
    }
  }
  if (token !== renderToken) return;

  // Sign-in gate: every seller page needs an authenticated session (the server enforces this too).
  const isPublic = PUBLIC_PATHS.includes(path);
  if (!account && !isPublic) return navigate(`/seller/sign-in${path !== '/seller' ? `?next=${encodeURIComponent(path)}` : ''}`, true);
  if (account && path === '/seller/sign-in') return navigate('/seller', true);

  const bare = isPublic;
  app.innerHTML = shell(seller, m?.route.nav, bare, account).value;
  const main = $('#main')!;
  document.title = `${m?.route.title ?? 'Not found'} · Mithren Agro Seller Portal`;

  const banner = bare || !account || path === '/seller' ? '' : statusBanner(seller);
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
  const ctx: PageContext = { root: container, params: m.params, query, seller, account, refresh: () => void rerenderPage(), isCurrent: () => token === renderToken };

  async function rerenderPage() {
    // Preserve focus (e.g. a search box) across re-renders.
    const active = document.activeElement as HTMLInputElement | null;
    const activeId = active?.id;
    const sel = active && 'selectionStart' in active ? [active.selectionStart, active.selectionEnd] : null;
    const fresh = document.createElement('div');
    fresh.className = 'page';
    const newAccount = await api.auth.current();
    const newSeller = newAccount ? await api.getSeller() : GUEST;
    const c2: PageContext = { ...ctx, root: fresh, seller: newSeller, account: newAccount, query: currentLocation().query };
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
  // Prototype controls have no visible button; open them with Alt+Shift+P.
  document.addEventListener('keydown', (e) => {
    if (e.altKey && e.shiftKey && e.code === 'KeyP') {
      e.preventDefault();
      openPrototypeControls();
    }
  });
  on(root, 'click', '[data-action=notifs]', (_e, btn) => void toggleNotifications(btn));
  on(root, 'click', '[data-action=account]', (_e, btn) => {
    const menu = $('#account-menu');
    if (!menu) return;
    menu.hidden = !menu.hidden;
    btn.setAttribute('aria-expanded', String(!menu.hidden));
    if (!menu.hidden) (menu.querySelector('a,button') as HTMLElement | null)?.focus();
  });
  on(root, 'click', '[data-action=sign-out]', async () => {
    try {
      await api.auth.signOut();
      toast('You’re signed out');
      navigate('/seller/sign-in');
      void render();
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  });
  document.addEventListener('click', (e) => {
    const menu = $('#account-menu');
    if (menu && !menu.hidden && !(e.target as HTMLElement).closest('.account-wrap')) {
      menu.hidden = true;
      $('[data-action=account]')?.setAttribute('aria-expanded', 'false');
    }
  });
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
    const menu = $('#account-menu');
    if (menu && !menu.hidden) {
      menu.hidden = true;
      ($('[data-action=account]') as HTMLElement | null)?.focus();
    }
    const panel = $('#notif-panel');
    if (panel && !panel.hidden) closeNotifications();
  }
});

async function updateBadges() {
  if (!$('[data-action=notifs]')) return;
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
    <p class="notif-foot muted">In-app notifications. Email and SMS delivery need a configured provider.</p>`.value;
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

/**
 * Hidden controls (Alt+Shift+P) for the preview only. They stand in for the
 * Super Admin Portal, checkout and delivery, which are outside this portal.
 * On the server, review actions come from the Super Admin Portal's API calls.
 */
function openPrototypeControls() {
  const admin = api.previewAdmin;
  if (!admin && !api.DEMO_TOOLS) return;
  modal({
    title: 'Prototype controls',
    body: html`
      <div class="stack">
        <p class="muted">These stand in for systems outside the Seller Portal. They don’t exist in production.</p>
        ${admin
          ? html`<fieldset class="field proto-review">
              <legend>Super Admin review (preview stand-in)</legend>
              <label for="proto-msg">Message to the seller</label>
              <textarea id="proto-msg" rows="2" placeholder="Required for reject, request changes and suspend"></textarea>
              <label for="proto-items">Requested items (one per line, for “Request changes”)</label>
              <textarea id="proto-items" rows="2" placeholder="Enter one requested item per line"></textarea>
              <div class="row-wrap">
                <button class="btn btn-sm" type="button" data-decide="approve">Approve</button>
                <button class="btn btn-sm" type="button" data-decide="request_changes">Request changes</button>
                <button class="btn btn-sm" type="button" data-decide="reject">Reject</button>
                <button class="btn btn-sm" type="button" data-decide="suspend">Suspend</button>
                <button class="btn btn-sm" type="button" data-decide="reinstate">Reinstate</button>
              </div>
              <div class="row-wrap">
                <button class="btn btn-sm" type="button" data-organic="verified">Verify organic certificate</button>
                <button class="btn btn-sm" type="button" data-organic="rejected">Reject organic certificate</button>
              </div>
            </fieldset>`
          : ''}
        <div class="proto-grid">
          ${api.DEMO_TOOLS ? html`<button class="btn" type="button" data-p="order">${icon('orders', 16)} Simulate a new customer order</button>` : ''}
          ${admin ? html`<label class="switch"><input type="checkbox" id="proto-fail" ${api.sim.failWrites ? raw('checked') : ''}/> <span>Simulate network failure on save</span></label>` : ''}
        </div>
        <div class="modal-actions">
          ${admin
            ? html`<button class="btn btn-danger-ghost" type="button" data-p="clear">Clear all data</button>
                <button class="btn" type="button" data-p="reset">Load sample data</button>`
            : ''}
          <button class="btn btn-primary" type="button" data-close>Done</button>
        </div>
      </div>`,
    onMount(el, close) {
      const after = (msg: string, to = '/seller') => {
        toast(msg, 'info');
        close();
        navigate(to);
        void render();
      };
      el.querySelectorAll<HTMLButtonElement>('[data-decide]').forEach((b) =>
        b.addEventListener('click', async () => {
          const msg = (el.querySelector('#proto-msg') as HTMLTextAreaElement).value;
          const items = (el.querySelector('#proto-items') as HTMLTextAreaElement).value.split('\n').map((x) => x.trim()).filter(Boolean);
          try {
            await admin!.decide(b.dataset.decide as 'approve', msg, items);
            after(`Reviewer action: ${b.textContent}`);
          } catch (err) {
            toast((err as Error).message, 'error');
          }
        }),
      );
      el.querySelectorAll<HTMLButtonElement>('[data-organic]').forEach((b) =>
        b.addEventListener('click', async () => {
          const msg = (el.querySelector('#proto-msg') as HTMLTextAreaElement).value;
          try {
            await admin!.reviewOrganic(b.dataset.organic as 'verified', msg);
            after(b.dataset.organic === 'verified' ? 'Organic certificate verified' : 'Organic certificate rejected', '/seller/documents');
          } catch (err) {
            toast((err as Error).message, 'error');
          }
        }),
      );
      el.querySelector('#proto-fail')?.addEventListener('change', (e) => {
        api.sim.failWrites = (e.target as HTMLInputElement).checked;
        toast(api.sim.failWrites ? 'Saves will now fail with a network error' : 'Network restored', 'info');
      });
      el.querySelector('[data-p=order]')?.addEventListener('click', async () => {
        try {
          const o = await api._demoSimulateNewOrder();
          toast(`New order ${o.id} received`, 'info');
          close();
          navigate(`/seller/orders/${o.id}`);
        } catch (err) {
          toast((err as Error).message, 'error');
        }
      });
      el.querySelector('[data-p=clear]')?.addEventListener('click', () => {
        api.clearAllData();
        api.sim.failWrites = false;
        after('All business data cleared', '/seller/dashboard');
      });
      el.querySelector('[data-p=reset]')?.addEventListener('click', () => {
        api.resetDemoData();
        api.sim.failWrites = false;
        after('Sample data loaded', '/seller/dashboard');
      });
    },
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
