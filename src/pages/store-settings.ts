// /seller/store-settings — shop profile, pickup, hours, fulfilment, notifications, staff.

import type { Page } from '../router.js';
import { html, raw, on, $, $$, formValues } from '../ui/dom.js';
import { pageHeader, field, textarea, callout, icon, showFieldErrors, badge, paginate, pager, bindPager, sellerBadge } from '../ui/components.js';
import { toast, modal, confirmDialog } from '../ui/overlay.js';
import * as api from '../api.js';
import { fmtDate, EMAIL_RE } from '../lib.js';
import type { NotificationTopic, NotificationChannel, Seller, StaffMember } from '../types.js';

const TOPICS: [NotificationTopic, string, string][] = [
  ['new_order', 'New orders', 'When a customer places an order with you'],
  ['order_update', 'Order updates', 'Pickups, deliveries, cancellations and returns'],
  ['moderation', 'Account & listings', 'Approval decisions and listing moderation'],
  ['settlement', 'Settlements & refunds', 'Payouts, failures and refunds'],
  ['low_stock', 'Low stock', 'When a variant drops below its threshold'],
  ['support', 'Support replies', 'Replies to your support tickets'],
];
const CHANNELS: [NotificationChannel, string][] = [
  ['email', 'Email'],
  ['sms', 'SMS'],
  ['push', 'In-app'],
];

const SECTIONS = [
  ['profile', 'Shop profile'],
  ['pickup', 'Pickup & service areas'],
  ['hours', 'Hours & holidays'],
  ['fulfilment', 'Fulfilment'],
  ['notifications', 'Notifications'],
  ['staff', 'Staff'],
  ['account', 'Account details'],
];

const page: Page = async ({ root, query, seller, refresh }) => {
  const readOnly = seller.status === 'suspended';
  const staffPage = paginate(seller.staff, query, 'staff');
  let areas = [...seller.serviceAreas];
  let holidays = [...seller.holidays];

  root.innerHTML = html`
    ${pageHeader('Store settings', 'How your shop appears to customers and how you fulfil orders.')}
    ${readOnly ? callout('error', 'Read-only', 'Settings can’t be changed while your account is suspended.') : ''}
    <div class="settings-layout">
      <aside class="settings-aside">
        <nav class="settings-nav" aria-label="Settings sections">
          <ul>${SECTIONS.map(([id, l], i) => html`<li><a href="#/seller/store-settings" data-jump="${id}" class="${i === 0 ? 'is-active' : ''}" ${i === 0 ? raw('aria-current="true"') : ''}>${l}</a></li>`)}</ul>
        </nav>
        ${glanceCard(seller)}
      </aside>
      <div class="stack">
        <form class="card" id="profile" data-section="profile" novalidate>
          ${sectionHead('Shop profile', readOnly)}
          <div class="section-fields" inert>
          <div class="banner-preview" id="banner-preview" style="--brand:${seller.brandColor}">
            <span class="banner-logo" aria-hidden="true">${seller.shopName.slice(0, 1)}</span>
            <div><strong data-preview="name">${seller.shopName}</strong><span data-preview="tagline">${seller.bannerTagline}</span></div>
          </div>
          <p class="muted small">Logo and banner image uploads connect to file storage in production. The preview uses your brand colour.</p>
          ${field({ name: 'shopName', label: 'Shop name', value: seller.shopName, required: true, placeholder: 'Enter your shop name', attrs: 'maxlength="60"' })}
          ${field({ name: 'bannerTagline', label: 'Banner tagline', value: seller.bannerTagline, placeholder: 'Enter a short tagline for your shop banner', attrs: 'maxlength="90"' })}
          <div class="field">
            <label for="f_brandColor">Brand colour</label>
            <input type="color" id="f_brandColor" name="brandColor" value="${seller.brandColor}" />
          </div>
          </div>
          <div class="field-edit-wrap">
            ${readOnly ? '' : editButton('About your shop', 'Shop profile')}
            <div class="section-fields" inert>
              ${textarea({ name: 'description', label: 'About your shop', value: seller.description, rows: 4, placeholder: 'Describe your shop, what you grow and how you sell', attrs: 'maxlength="800"' })}
            </div>
          </div>
          ${saveRow(readOnly)}
        </form>

        <form class="card" id="pickup" data-section="pickup" novalidate>
          ${sectionHead('Pickup & service areas', readOnly)}
          <div class="section-fields" inert>
          ${textarea({ name: 'pickupAddress', label: 'Pickup address', value: seller.pickupAddress, rows: 2, required: true, placeholder: 'Enter the complete address where orders are collected', hint: 'Where the delivery partner collects orders.' })}
          <div class="field" id="f_serviceAreas" tabindex="-1">
            <label for="area-input">Service areas</label>
            <div class="chip-row" id="area-chips"></div>
            <div class="row-wrap">
              <input id="area-input" type="text" placeholder="Add a locality or PIN code, e.g. Baner or 411045" maxlength="40" />
              <button type="button" class="btn btn-sm" data-action="add-area">Add</button>
            </div>
            <p class="field-error" id="f_serviceAreas_err" hidden></p>
          </div>
          </div>
          ${saveRow(readOnly)}
        </form>

        <form class="card" id="hours" data-section="hours" novalidate>
          ${sectionHead('Working hours', readOnly)}
          <div class="section-fields" inert>
          <div class="table-wrap"><table class="table table-compact hours">
            <thead><tr><th scope="col">Day</th><th scope="col">Open</th><th scope="col">Opens</th><th scope="col">Closes</th></tr></thead>
            <tbody>${seller.workingHours.map(
              (h, i) => html`<tr>
                <th scope="row">${h.day}</th>
                <td><label class="toggle"><input type="checkbox" name="open_${i}" ${h.closed ? '' : raw('checked')} /><span class="toggle-ui" aria-hidden="true"></span><span class="sr-only">Open on ${h.day}</span></label></td>
                <td><label class="sr-only" for="o_${i}">${h.day} opening time</label><input type="time" id="o_${i}" name="from_${i}" value="${h.open}" /></td>
                <td><label class="sr-only" for="c_${i}">${h.day} closing time</label><input type="time" id="c_${i}" name="to_${i}" value="${h.close}" /></td>
              </tr>`,
            )}</tbody>
          </table></div>
          <h3 class="sub-title">Holidays</h3>
          <p class="muted small">Customers can’t book delivery slots from you on these dates.</p>
          <ul class="holiday-list" id="holidays"></ul>
          <div class="row-wrap">
            <label class="sr-only" for="hol-date">Holiday date</label><input type="date" id="hol-date" min="${new Date().toISOString().slice(0, 10)}" />
            <label class="sr-only" for="hol-note">Note</label><input type="text" id="hol-note" placeholder="Add a note, e.g. Diwali break (optional)" maxlength="60" />
            <button type="button" class="btn btn-sm" data-action="add-holiday">Add holiday</button>
          </div>
          </div>
          ${saveRow(readOnly)}
        </form>

        <form class="card" id="fulfilment" data-section="fulfilment" novalidate>
          ${sectionHead('Fulfilment', readOnly)}
          <div class="section-fields" inert>
          <label class="check-row"><input type="checkbox" name="autoAccept" ${seller.fulfilment.autoAccept ? raw('checked') : ''} /> <span><strong>Auto-accept orders</strong><span class="muted small block">Orders skip “awaiting confirmation” when every item is in stock.</span></span></label>
          <div class="row-3">
            ${field({ name: 'acceptWindowMins', label: 'Acceptance window (min)', type: 'number', value: seller.fulfilment.acceptWindowMins, placeholder: 'e.g. 30', attrs: 'min="5" max="120"' })}
            ${field({ name: 'packingTimeMins', label: 'Packing time (min)', type: 'number', value: seller.fulfilment.packingTimeMins, placeholder: 'e.g. 45', attrs: 'min="5" max="240"' })}
            ${field({ name: 'minOrderValue', label: 'Minimum order (₹)', type: 'number', value: seller.fulfilment.minOrderValue, placeholder: 'e.g. 200', attrs: 'min="0"' })}
          </div>
          </div>
          ${saveRow(readOnly)}
        </form>

        <form class="card" id="notifications" data-section="notifications" novalidate>
          ${sectionHead('Notifications', readOnly)}
          <div class="section-fields" inert>
          <div class="table-wrap"><table class="table table-compact">
            <thead><tr><th scope="col">Topic</th>${CHANNELS.map(([, l]) => html`<th scope="col" class="center">${l}</th>`)}</tr></thead>
            <tbody>${TOPICS.map(
              ([t, l, d]) => html`<tr><th scope="row">${l}<span class="muted small block">${d}</span></th>
                ${CHANNELS.map(([c, cl]) => html`<td class="center"><input type="checkbox" name="${t}.${c}" aria-label="${l} by ${cl}" ${seller.notifications[t][c] ? raw('checked') : ''} /></td>`)}</tr>`,
            )}</tbody>
          </table></div>
          <p class="muted small">Email and SMS delivery require a configured provider. In this prototype, only in-app notifications are shown.</p>
          </div>
          ${saveRow(readOnly)}
        </form>

        <section class="card" id="staff">
          <div class="card-head"><h2 class="card-title">Staff accounts</h2>${readOnly ? '' : html`<button type="button" class="btn btn-sm" data-action="invite">${icon('plus', 14)} Invite</button>`}</div>
          <p class="muted small">Packers can view and fulfil orders and adjust stock. Managers can also edit products. Only you can see earnings, bank details and settings.</p>
          ${seller.staff.length
            ? html`<div class="table-block"><ul class="staff-list">${staffPage.rows.map(
                (s) => html`<li><div><strong>${s.name}</strong><span class="muted small block">${s.email} · invited ${fmtDate(s.invitedAt)}</span></div>
                  ${badge(s.role === 'manager' ? 'Manager' : 'Packer', 'blue')} ${s.active ? '' : badge('Deactivated')}
                  ${readOnly ? '' : html`<button type="button" class="btn btn-sm btn-ghost" data-action="toggle-staff" data-id="${s.id}">${s.active ? 'Deactivate' : 'Reactivate'}</button>`}</li>`,
              )}</ul>${pager(staffPage.info, 'staff members')}</div>`
            : html`<p class="muted">No staff yet.</p>`}
        </section>

        <section class="card" id="account">
          <h2 class="card-title">Account details</h2>
          <dl class="kv">
            <div><dt>Owner</dt><dd>${seller.ownerName}</dd></div>
            <div><dt>Email</dt><dd>${seller.email} ${seller.emailVerified ? badge('Verified', 'green') : badge('Unverified', 'amber')}</dd></div>
            <div><dt>Phone</dt><dd>${seller.phone} ${seller.phoneVerified ? badge('Verified', 'green') : badge('Unverified', 'amber')}</dd></div>
            <div><dt>GSTIN</dt><dd class="mono">${seller.gstin ?? '—'}</dd></div>
            <div><dt>PAN</dt><dd class="mono">${seller.pan ? seller.pan.slice(0, 2) + '•••••' + seller.pan.slice(-3) : '—'}</dd></div>
            <div><dt>Bank</dt><dd>••••${seller.bank.last4} · ${seller.bank.ifsc} ${seller.bank.verified ? badge('Verified', 'green') : badge('Verification pending', 'amber')}</dd></div>
          </dl>
          <p class="muted small">${seller.bank.verified
            ? html`Legal and bank details are verified, so changes go through <a href="mailto:${seller.supportEmail}">seller support</a> with updated documents.`
            : html`Bank details are awaiting verification by our team. To change them, upload new bank proof on <a href="#/seller/documents">Documents</a>.`}</p>
        </section>
      </div>
    </div>`.value;

  const renderAreas = () => {
    $('#area-chips', root)!.innerHTML = html`${areas.map((a, i) => html`<span class="chip chip-static">${a}${readOnly ? '' : html`<button type="button" class="chip-x" data-action="rm-area" data-i="${i}" aria-label="Remove ${a}">${icon('close', 12)}</button>`}</span>`)}`.value;
  };
  const renderHolidays = () => {
    $('#holidays', root)!.innerHTML = holidays.length
      ? html`${holidays.map((h, i) => html`<li><span>${fmtDate(h.date)}${h.note ? html` — <span class="muted">${h.note}</span>` : ''}</span>${readOnly ? '' : html`<button type="button" class="btn btn-sm btn-ghost" data-action="rm-holiday" data-i="${i}">Remove</button>`}</li>`)}`.value
      : html`<li class="muted">No upcoming holidays.</li>`.value;
  };
  renderAreas();
  renderHolidays();
  if (readOnly) $$('input,select,textarea', root).forEach((el) => ((el as HTMLInputElement).disabled = true));

  bindPager(root, refresh);
  // ---------- sub-navigation: highlight the section in view ----------
  const navLinks = Array.from(root.querySelectorAll<HTMLAnchorElement>('[data-jump]'));
  const setActive = (id: string) => {
    for (const a of navLinks) {
      const on = a.dataset.jump === id;
      a.classList.toggle('is-active', on);
      if (on) a.setAttribute('aria-current', 'true');
      else a.removeAttribute('aria-current');
    }
    // Keep the active tab visible when the tabs scroll sideways on small screens.
    navLinks.find((a) => a.dataset.jump === id)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  };
  let jumping = false;
  const spy = () => {
    if (jumping || !root.isConnected) return;
    const offset = 60 + 16 + 24; // top bar + sticky gap + a little room
    const atBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4;
    let current = SECTIONS[0]![0];
    for (const [id] of SECTIONS) {
      const el = $(`#${id}`, root);
      if (el && el.getBoundingClientRect().top - offset <= 0) current = id;
    }
    setActive(atBottom ? SECTIONS[SECTIONS.length - 1]![0] : current);
  };
  let ticking = false;
  const onScroll = () => {
    // The page may still be off-screen while the portal renders it; it listens once it's attached.
    if (!root.isConnected || ticking) return;
    ticking = true;
    // A short timer rather than requestAnimationFrame, which pauses in background tabs.
    window.setTimeout(() => {
      ticking = false;
      spy();
    }, 60);
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  // Stop listening once the seller leaves this page.
  window.addEventListener('hashchange', () => window.removeEventListener('scroll', onScroll), { once: true });

  on(root, 'click', '[data-jump]', (e, el) => {
    e.preventDefault();
    setActive(el.dataset.jump!);
    // The smooth scroll passes other sections; don't let the scroll spy flicker through them.
    // The clicked tab stays highlighted until the seller scrolls again, even when a short section near
    // the bottom can't reach the top of the screen.
    jumping = true;
    window.setTimeout(() => (jumping = false), 800);
    const target = $(`#${el.dataset.jump}`, root);
    target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    (target?.querySelector('input,textarea,button') as HTMLElement | null)?.focus({ preventScroll: true });
  });
  on(root, 'input', '#profile', () => {
    const f = formValues($('#profile', root) as HTMLFormElement);
    $('[data-preview=name]', root)!.textContent = f.shopName || 'Shop name';
    $('[data-preview=tagline]', root)!.textContent = f.bannerTagline ?? '';
    $('#banner-preview', root)!.style.setProperty('--brand', f.brandColor ?? '#2e7d32');
  });
  const addArea = () => {
    const input = $('#area-input', root) as HTMLInputElement;
    const v = input.value.trim();
    if (v && !areas.some((a) => a.toLowerCase() === v.toLowerCase())) areas.push(v);
    input.value = '';
    renderAreas();
    input.focus();
  };
  on(root, 'click', '[data-action=add-area]', addArea);
  on(root, 'keydown', '#area-input', (e) => {
    if ((e as KeyboardEvent).key === 'Enter') {
      e.preventDefault();
      addArea();
    }
  });
  on(root, 'click', '[data-action=rm-area]', (_e, el) => {
    areas.splice(Number(el.dataset.i), 1);
    renderAreas();
  });
  on(root, 'click', '[data-action=add-holiday]', () => {
    const d = ($('#hol-date', root) as HTMLInputElement).value;
    const note = ($('#hol-note', root) as HTMLInputElement).value.trim();
    if (!d) return toast('Pick a date first', 'error');
    if (holidays.some((h) => h.date === d)) return toast('That date is already a holiday', 'error');
    holidays.push({ id: `h${Date.now()}`, date: d, note });
    holidays.sort((a, b) => a.date.localeCompare(b.date));
    renderHolidays();
  });
  on(root, 'click', '[data-action=rm-holiday]', (_e, el) => {
    holidays.splice(Number(el.dataset.i), 1);
    renderHolidays();
  });

  // ---------- view / edit mode ----------
  // What a section held when editing started, so Cancel can put it back.
  const editStart = new Map<string, { areas: string[]; holidays: typeof holidays }>();
  const controls = (form: HTMLFormElement) => $$<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('input, textarea, select', form);
  const setEditing = (form: HTMLFormElement, editing: boolean) => {
    for (const box of $$<HTMLElement>('.section-fields', form)) box.inert = !editing;
    form.querySelector<HTMLElement>('.save-row')!.hidden = !editing;
    for (const b of $$<HTMLElement>('[data-action=edit-section]', form)) b.hidden = editing;
    form.classList.toggle('is-editing', editing);
  };
  /** After a save, what's on screen becomes what Cancel returns to. */
  const commitDefaults = (form: HTMLFormElement) => {
    for (const c of controls(form)) {
      if (c instanceof HTMLInputElement && (c.type === 'checkbox' || c.type === 'radio')) c.defaultChecked = c.checked;
      else if (c instanceof HTMLSelectElement) for (const o of c.options) o.defaultSelected = o.selected;
      else c.defaultValue = c.value;
    }
  };
  on(root, 'click', '[data-action=edit-section]', (_e, el) => {
    const form = el.closest('form') as HTMLFormElement;
    editStart.set(form.id, { areas: [...areas], holidays: holidays.map((h) => ({ ...h })) });
    setEditing(form, true);
    const status = form.querySelector('.save-status') as HTMLElement;
    status.textContent = '';
    const near = el.closest('.field-edit-wrap') ?? form;
    near.querySelector<HTMLElement>('.section-fields input:not([type=hidden]), .section-fields textarea, .section-fields select')?.focus();
  });
  on(root, 'click', '[data-action=cancel-edit]', (_e, el) => {
    const form = el.closest('form') as HTMLFormElement;
    form.reset();
    const start = editStart.get(form.id);
    if (start && form.id === 'pickup') {
      areas = start.areas;
      renderAreas();
    }
    if (start && form.id === 'hours') {
      holidays = start.holidays;
      renderHolidays();
    }
    if (form.id === 'profile') form.dispatchEvent(new Event('input', { bubbles: true })); // banner preview
    for (const err of $$<HTMLElement>('.field-error', form)) err.hidden = true;
    for (const c of controls(form)) c.removeAttribute('aria-invalid');
    (form.querySelector('.save-status') as HTMLElement).textContent = '';
    setEditing(form, false);
    form.querySelector<HTMLElement>('[data-action=edit-section]')?.focus();
  });

  on(root, 'submit', 'form[data-section]', async (e, el) => {
    e.preventDefault();
    const form = el as HTMLFormElement;
    const f = formValues(form);
    let patch: Parameters<typeof api.updateSeller>[0] = {};
    switch (form.dataset.section) {
      case 'profile':
        patch = { shopName: f.shopName ?? '', bannerTagline: f.bannerTagline ?? '', brandColor: f.brandColor ?? seller.brandColor, description: f.description ?? '' };
        break;
      case 'pickup':
        patch = { pickupAddress: f.pickupAddress ?? '', serviceAreas: areas };
        break;
      case 'hours':
        patch = {
          workingHours: seller.workingHours.map((h, i) => ({ ...h, closed: !form.querySelector<HTMLInputElement>(`[name=open_${i}]`)!.checked, open: f[`from_${i}`] ?? h.open, close: f[`to_${i}`] ?? h.close })),
          holidays,
        };
        break;
      case 'fulfilment':
        patch = { fulfilment: { autoAccept: !!f.autoAccept, acceptWindowMins: Number(f.acceptWindowMins), packingTimeMins: Number(f.packingTimeMins), minOrderValue: Number(f.minOrderValue) } };
        break;
      case 'notifications': {
        const n = structuredClone(seller.notifications) as Seller['notifications'];
        for (const [t] of TOPICS) for (const [c] of CHANNELS) n[t][c] = !!form.querySelector<HTMLInputElement>(`[name="${t}.${c}"]`)?.checked;
        patch = { notifications: n };
        break;
      }
    }
    if (form.dataset.section === 'hours') {
      const bad = patch.workingHours?.find((h) => !h.closed && h.open >= h.close);
      if (bad) return toast(`${bad.day}: closing time must be after opening time.`, 'error');
    }
    const btn = form.querySelector('[type=submit]') as HTMLButtonElement;
    btn.disabled = true;
    const status = form.querySelector('.save-status') as HTMLElement;
    try {
      // The customer and delivery apps read the shop name, description and pickup address from the
      // FastAPI shop details: save them there first so values the backend refuses never end up
      // only in the portal.
      const backendPatch: api.ShopDetailsPatch = {};
      if (form.dataset.section === 'profile') {
        if (patch.shopName?.trim()) backendPatch.shop_name = patch.shopName.trim();
        backendPatch.description = patch.description?.trim() || null;
      }
      if (form.dataset.section === 'pickup') backendPatch.pickup_address = patch.pickupAddress?.trim() || null;
      if (Object.keys(backendPatch).length) {
        const me = await api.auth.me();
        if (me?.seller_id) {
          await api.shopDetails.update(me.seller_id, backendPatch);
          if (backendPatch.shop_name) api.sellerSession.setShopName(backendPatch.shop_name);
        }
      }
      await api.updateSeller(patch);
      commitDefaults(form);
      setEditing(form, false);
      status.textContent = '';
      toast('Settings saved');
      if (form.dataset.section === 'profile') refresh();
    } catch (ex) {
      const ae = ex as api.ApiError;
      status.textContent = ae.message;
      status.className = 'save-status error-text';
      if (ae.fieldErrors) showFieldErrors(form, ae.fieldErrors);
    } finally {
      btn.disabled = false;
    }
  });

  on(root, 'click', '[data-action=invite]', () => {
    modal({
      title: 'Invite a staff member',
      body: html`<form class="stack" novalidate>
        ${field({ name: 'name', label: 'Name', required: true, placeholder: 'Enter the staff member’s full name', attrs: 'autofocus maxlength="60"' })}
        ${field({ name: 'email', label: 'Email', type: 'email', required: true, placeholder: 'Enter the staff member’s email address' })}
        <fieldset class="field"><legend>Role</legend>
          <div class="radio-row"><label><input type="radio" name="role" value="packer" checked /> Packer</label><label><input type="radio" name="role" value="manager" /> Manager</label></div>
        </fieldset>
        <p class="muted small">In production, an invitation email with a secure sign-up link is sent. Not sent in this prototype.</p>
        <div class="modal-actions"><button type="button" class="btn" data-close>Cancel</button><button type="submit" class="btn btn-primary">Add staff member</button></div>
      </form>`,
      onMount(el, close) {
        const form = el.querySelector('form')!;
        form.addEventListener('submit', async (e) => {
          e.preventDefault();
          const f = formValues(form);
          const errs: Record<string, string> = {};
          if (!f.name?.trim()) errs.name = 'Name is required.';
          if (!EMAIL_RE.test(f.email ?? '')) errs.email = 'Enter a valid email address.';
          else if (seller.staff.some((s) => s.email.toLowerCase() === f.email!.toLowerCase())) errs.email = 'This person is already on your staff list.';
          if (Object.keys(errs).length) return showFieldErrors(form, errs);
          const member: StaffMember = { id: `st${Date.now()}`, name: f.name!.trim(), email: f.email!.trim(), role: f.role === 'manager' ? 'manager' : 'packer', invitedAt: new Date().toISOString(), active: true };
          try {
            await api.updateSeller({ staff: [...seller.staff, member] });
            toast(`${member.name} added`);
            close();
            refresh();
          } catch (ex) {
            toast((ex as Error).message, 'error');
          }
        });
      },
    });
  });
  on(root, 'click', '[data-action=toggle-staff]', async (_e, el) => {
    const s = seller.staff.find((x) => x.id === el.dataset.id)!;
    if (s.active) {
      const c = await confirmDialog({ title: `Deactivate ${s.name}?`, message: 'They will be signed out and lose access immediately. You can reactivate them later.', confirmLabel: 'Deactivate', danger: true });
      if (!c.ok) return;
    }
    try {
      await api.updateSeller({ staff: seller.staff.map((x) => (x.id === s.id ? { ...x, active: !x.active } : x)) });
      toast(s.active ? `${s.name} deactivated` : `${s.name} reactivated`);
      refresh();
    } catch (ex) {
      toast((ex as Error).message, 'error');
    }
  });
};

function saveRow(readOnly: boolean) {
  return readOnly
    ? html``
    : html`<div class="save-row" hidden><span class="save-status" role="status" aria-live="polite"></span><button type="button" class="btn" data-action="cancel-edit">Cancel</button><button type="submit" class="btn btn-primary">Save</button></div>`;
}

/** Saved sections are read-only until the seller clicks the pencil. */
function sectionHead(title: string, readOnly: boolean) {
  return html`<div class="card-head"><h2 class="card-title">${title}</h2>${readOnly ? '' : editButton(title)}</div>`;
}

/** Unlocks the whole section; `what` names the field it sits beside, if any. */
function editButton(what: string, section?: string) {
  return html`<button type="button" class="btn btn-sm btn-ghost" data-action="edit-section" aria-label="Edit ${what}${section ? ` (${section})` : ''}" title="Edit">${icon('edit', 16)} Edit</button>`;
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

/** A short summary under the section tabs: account status, today's hours and what customers see. */
function glanceCard(seller: Parameters<Page>[0]['seller']) {
  // Today in India, where the shop operates.
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  const todayIso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const hours = seller.workingHours.find((h) => h.day === DAYS[now.getDay()]);
  const holidayToday = seller.holidays.some((h) => h.date === todayIso);
  const upcoming = seller.holidays.filter((h) => h.date >= todayIso).length;
  const today = holidayToday ? 'Closed (holiday)' : !hours || hours.closed ? 'Closed' : `Open ${hours.open}–${hours.close}`;
  return html`<section class="settings-glance" aria-labelledby="glance-h">
    <h2 id="glance-h" class="settings-glance-title">Store at a glance</h2>
    <dl class="kv kv-compact">
      <div><dt>Account</dt><dd>${sellerBadge(seller.status)}</dd></div>
      <div><dt>Today</dt><dd>${today}</dd></div>
      <div><dt>Delivery areas</dt><dd>${seller.serviceAreas.length ? `${seller.serviceAreas.length} area${seller.serviceAreas.length === 1 ? '' : 's'}` : 'None yet'}</dd></div>
      <div><dt>Holidays</dt><dd>${upcoming ? `${upcoming} upcoming` : 'None planned'}</dd></div>
      <div><dt>New orders</dt><dd>${seller.fulfilment.autoAccept ? 'Accepted automatically' : 'You confirm each'}</dd></div>
    </dl>
    <p class="settings-glance-help small">${icon('info', 13)} Questions about your settings? <a href="mailto:${seller.supportEmail}">Contact seller support</a></p>
  </section>`;
}

export default page;
