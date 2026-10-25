// /seller/store-settings — shop profile, pickup, hours, fulfilment, notifications, staff.

import type { Page } from '../router.js';
import { html, raw, on, $, $$, formValues } from '../ui/dom.js';
import { pageHeader, field, textarea, callout, icon, showFieldErrors, badge } from '../ui/components.js';
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

const page: Page = async ({ root, seller, refresh }) => {
  const readOnly = seller.status === 'suspended';
  let areas = [...seller.serviceAreas];
  let holidays = [...seller.holidays];

  root.innerHTML = html`
    ${pageHeader('Store settings', 'How your shop appears to customers and how you fulfil orders.')}
    ${readOnly ? callout('error', 'Read-only', 'Settings can’t be changed while your account is suspended.') : ''}
    <div class="settings-layout">
      <nav class="settings-nav" aria-label="Settings sections">
        <ul>${SECTIONS.map(([id, l]) => html`<li><a href="#/seller/store-settings" data-jump="${id}">${l}</a></li>`)}</ul>
      </nav>
      <div class="stack">
        <form class="card" id="profile" data-section="profile" novalidate>
          <h2 class="card-title">Shop profile</h2>
          <div class="banner-preview" id="banner-preview" style="--brand:${seller.brandColor}">
            <span class="banner-logo" aria-hidden="true">${seller.shopName.slice(0, 1)}</span>
            <div><strong data-preview="name">${seller.shopName}</strong><span data-preview="tagline">${seller.bannerTagline}</span></div>
          </div>
          <p class="muted small">Logo and banner image uploads connect to file storage in production. The preview uses your brand colour.</p>
          ${field({ name: 'shopName', label: 'Shop name', value: seller.shopName, required: true, attrs: 'maxlength="60"' })}
          ${field({ name: 'bannerTagline', label: 'Banner tagline', value: seller.bannerTagline, attrs: 'maxlength="90"' })}
          <div class="field">
            <label for="f_brandColor">Brand colour</label>
            <input type="color" id="f_brandColor" name="brandColor" value="${seller.brandColor}" />
          </div>
          ${textarea({ name: 'description', label: 'About your shop', value: seller.description, rows: 4, attrs: 'maxlength="800"' })}
          ${saveRow(readOnly)}
        </form>

        <form class="card" id="pickup" data-section="pickup" novalidate>
          <h2 class="card-title">Pickup & service areas</h2>
          ${textarea({ name: 'pickupAddress', label: 'Pickup address', value: seller.pickupAddress, rows: 2, required: true, hint: 'Where the delivery partner collects orders.' })}
          <div class="field" id="f_serviceAreas" tabindex="-1">
            <label for="area-input">Service areas</label>
            <div class="chip-row" id="area-chips"></div>
            <div class="row-wrap">
              <input id="area-input" type="text" placeholder="Add a locality or PIN code" maxlength="40" />
              <button type="button" class="btn btn-sm" data-action="add-area">Add</button>
            </div>
            <p class="field-error" id="f_serviceAreas_err" hidden></p>
          </div>
          ${saveRow(readOnly)}
        </form>

        <form class="card" id="hours" data-section="hours" novalidate>
          <h2 class="card-title">Working hours</h2>
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
            <label class="sr-only" for="hol-note">Note</label><input type="text" id="hol-note" placeholder="Note (optional)" maxlength="60" />
            <button type="button" class="btn btn-sm" data-action="add-holiday">Add holiday</button>
          </div>
          ${saveRow(readOnly)}
        </form>

        <form class="card" id="fulfilment" data-section="fulfilment" novalidate>
          <h2 class="card-title">Fulfilment</h2>
          <label class="check-row"><input type="checkbox" name="autoAccept" ${seller.fulfilment.autoAccept ? raw('checked') : ''} /> <span><strong>Auto-accept orders</strong><span class="muted small block">Orders skip “awaiting confirmation” when every item is in stock.</span></span></label>
          <div class="row-3">
            ${field({ name: 'acceptWindowMins', label: 'Acceptance window (min)', type: 'number', value: seller.fulfilment.acceptWindowMins, attrs: 'min="5" max="120"' })}
            ${field({ name: 'packingTimeMins', label: 'Packing time (min)', type: 'number', value: seller.fulfilment.packingTimeMins, attrs: 'min="5" max="240"' })}
            ${field({ name: 'minOrderValue', label: 'Minimum order (₹)', type: 'number', value: seller.fulfilment.minOrderValue, attrs: 'min="0"' })}
          </div>
          ${saveRow(readOnly)}
        </form>

        <form class="card" id="notifications" data-section="notifications" novalidate>
          <h2 class="card-title">Notifications</h2>
          <div class="table-wrap"><table class="table table-compact">
            <thead><tr><th scope="col">Topic</th>${CHANNELS.map(([, l]) => html`<th scope="col" class="center">${l}</th>`)}</tr></thead>
            <tbody>${TOPICS.map(
              ([t, l, d]) => html`<tr><th scope="row">${l}<span class="muted small block">${d}</span></th>
                ${CHANNELS.map(([c, cl]) => html`<td class="center"><input type="checkbox" name="${t}.${c}" aria-label="${l} by ${cl}" ${seller.notifications[t][c] ? raw('checked') : ''} /></td>`)}</tr>`,
            )}</tbody>
          </table></div>
          <p class="muted small">Email and SMS delivery require a configured provider. In this prototype, only in-app notifications are shown.</p>
          ${saveRow(readOnly)}
        </form>

        <section class="card" id="staff">
          <div class="card-head"><h2 class="card-title">Staff accounts</h2>${readOnly ? '' : html`<button type="button" class="btn btn-sm" data-action="invite">${icon('plus', 14)} Invite</button>`}</div>
          <p class="muted small">Packers can view and fulfil orders and adjust stock. Managers can also edit products. Only you can see earnings, bank details and settings.</p>
          ${seller.staff.length
            ? html`<ul class="staff-list">${seller.staff.map(
                (s) => html`<li><div><strong>${s.name}</strong><span class="muted small block">${s.email} · invited ${fmtDate(s.invitedAt)}</span></div>
                  ${badge(s.role === 'manager' ? 'Manager' : 'Packer', 'blue')} ${s.active ? '' : badge('Deactivated')}
                  ${readOnly ? '' : html`<button type="button" class="btn btn-sm btn-ghost" data-action="toggle-staff" data-id="${s.id}">${s.active ? 'Deactivate' : 'Reactivate'}</button>`}</li>`,
              )}</ul>`
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
            <div><dt>Bank</dt><dd>••••${seller.bank.last4} · ${seller.bank.ifsc}</dd></div>
          </dl>
          <p class="muted small">Legal and bank details are verified, so changes go through <a href="mailto:${seller.supportEmail}">seller support</a> with updated documents.</p>
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

  on(root, 'click', '[data-jump]', (e, el) => {
    e.preventDefault();
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
      await api.updateSeller(patch);
      status.textContent = 'Saved';
      status.className = 'save-status ok-text';
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
        ${field({ name: 'name', label: 'Name', required: true, attrs: 'autofocus maxlength="60"' })}
        ${field({ name: 'email', label: 'Email', type: 'email', required: true })}
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
  return readOnly ? html`` : html`<div class="save-row"><span class="save-status" role="status" aria-live="polite"></span><button type="submit" class="btn btn-primary">Save</button></div>`;
}

export default page;
