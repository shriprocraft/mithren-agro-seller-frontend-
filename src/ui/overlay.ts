// Toasts, modal dialogs and tooltips.

import { html, raw, type Raw, $, $$, EMBEDDED, download } from './dom.js';
import { icon } from './components.js';

export function toast(message: string, tone: 'success' | 'error' | 'info' = 'success') {
  const region = $('#toasts');
  if (!region) return;
  const el = document.createElement('div');
  el.className = `toast toast-${tone}`;
  el.setAttribute('role', tone === 'error' ? 'alert' : 'status');
  el.innerHTML = html`${icon(tone === 'error' ? 'alert' : tone === 'info' ? 'info' : 'check', 18)}<span>${message}</span>`.value;
  region.appendChild(el);
  setTimeout(() => el.classList.add('toast-out'), tone === 'error' ? 6000 : 3500);
  setTimeout(() => el.remove(), tone === 'error' ? 6400 : 3900);
}

interface ModalOpts {
  title: string;
  body: Raw;
  /** Called with the modal element once mounted. Return a cleanup if needed. */
  onMount?: (el: HTMLElement, close: () => void) => void;
  wide?: boolean;
}

let openCount = 0;

export function modal(o: ModalOpts): { close: () => void; el: HTMLElement } {
  const previouslyFocused = document.activeElement as HTMLElement | null;
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  const titleId = `mt_${Date.now()}`;
  backdrop.innerHTML = html`
    <div class="modal ${o.wide ? 'modal-wide' : ''}" role="dialog" aria-modal="true" aria-labelledby="${titleId}">
      <div class="modal-head">
        <h2 id="${titleId}">${o.title}</h2>
        <button type="button" class="icon-btn" data-close aria-label="Close dialog">${icon('close', 18)}</button>
      </div>
      <div class="modal-body">${o.body}</div>
    </div>`.value;
  document.body.appendChild(backdrop);
  openCount++;
  document.body.classList.add('no-scroll');
  const dialog = backdrop.firstElementChild as HTMLElement;

  const close = () => {
    backdrop.remove();
    document.removeEventListener('keydown', onKey, true);
    openCount--;
    if (!openCount) document.body.classList.remove('no-scroll');
    previouslyFocused?.focus?.();
  };
  const focusables = () => $$('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])', dialog);
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
    }
    if (e.key === 'Tab') {
      const f = focusables();
      if (!f.length) return;
      const first = f[0]!;
      const last = f[f.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  };
  document.addEventListener('keydown', onKey, true);
  backdrop.addEventListener('mousedown', (e) => {
    if (e.target === backdrop) close();
  });
  $$('[data-close]', backdrop).forEach((b) => b.addEventListener('click', close));
  o.onMount?.(dialog, close);
  const auto = $('[autofocus]', dialog) ?? focusables()[1] ?? focusables()[0];
  auto?.focus();
  return { close, el: dialog };
}

export function confirmDialog(o: { title: string; message: string; confirmLabel: string; danger?: boolean; reasonLabel?: string; reasonRequired?: boolean }): Promise<{ ok: boolean; reason: string }> {
  return new Promise((resolve) => {
    let settled = false;
    const m = modal({
      title: o.title,
      body: html`
        <form class="stack" novalidate>
          <p>${o.message}</p>
          ${o.reasonLabel
            ? html`<div class="field">
                <label for="f_reason">${o.reasonLabel}${o.reasonRequired ? html`<span class="req" aria-hidden="true"> *</span>` : ''}</label>
                <textarea id="f_reason" name="reason" rows="3" autofocus ${o.reasonRequired ? raw('required') : ''} aria-describedby="f_reason_err"></textarea>
                <p class="field-error" id="f_reason_err" hidden></p>
              </div>`
            : ''}
          <div class="modal-actions">
            <button type="button" class="btn" data-close>Cancel</button>
            <button type="submit" class="btn ${o.danger ? 'btn-danger' : 'btn-primary'}" ${o.reasonLabel ? '' : raw('autofocus')}>${o.confirmLabel}</button>
          </div>
        </form>`,
      onMount(el, close) {
        const form = el.querySelector('form')!;
        form.addEventListener('submit', (e) => {
          e.preventDefault();
          const reason = (form.querySelector('textarea') as HTMLTextAreaElement | null)?.value.trim() ?? '';
          if (o.reasonRequired && !reason) {
            const err = $('#f_reason_err', el)!;
            err.textContent = 'Please enter a reason. It is shared with the customer.';
            err.hidden = false;
            $('#f_reason', el)?.setAttribute('aria-invalid', 'true');
            $('#f_reason', el)?.focus();
            return;
          }
          settled = true;
          close();
          resolve({ ok: true, reason });
        });
      },
    });
    // Resolve as cancelled when dismissed any other way (Esc, backdrop, Cancel).
    const observer = new MutationObserver(() => {
      if (!document.body.contains(m.el)) {
        observer.disconnect();
        if (!settled) resolve({ ok: false, reason: '' });
      }
    });
    observer.observe(document.body, { childList: true });
  });
}

/** Save a file, or, where downloads are blocked, show the content to copy. */
export function saveFile(filename: string, content: string) {
  if (!EMBEDDED) {
    download(filename, content);
    toast(`Downloaded ${filename}`);
    return;
  }
  modal({
    title: `Export ${filename}`,
    wide: true,
    body: html`<div class="stack">
      <p class="muted">Downloads aren’t available in this preview. Copy the CSV below and paste it into a spreadsheet or a .csv file.</p>
      <label class="sr-only" for="export-text">CSV content</label>
      <textarea id="export-text" rows="12" readonly class="mono">${content}</textarea>
      <div class="modal-actions">
        <button type="button" class="btn" data-close>Close</button>
        <button type="button" class="btn btn-primary" data-copy autofocus>Copy CSV</button>
      </div>
    </div>`,
    onMount(el) {
      const ta = el.querySelector('#export-text') as HTMLTextAreaElement;
      el.querySelector('[data-copy]')!.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(content);
          toast('CSV copied to clipboard');
        } catch {
          ta.focus();
          ta.select();
          toast('Text selected — press Ctrl+C or ⌘C to copy', 'info');
        }
      });
    },
  });
}

// ---------- tooltips for [data-tip] (hover, focus and tap) ----------
export function initTooltips() {
  const tip = document.createElement('div');
  tip.className = 'tooltip';
  tip.setAttribute('role', 'tooltip');
  tip.id = 'global-tooltip';
  tip.hidden = true;
  document.body.appendChild(tip);
  let current: HTMLElement | null = null;

  const show = (el: HTMLElement) => {
    current = el;
    tip.textContent = el.dataset.tip ?? '';
    tip.hidden = false;
    el.setAttribute('aria-describedby', tip.id);
    const r = el.getBoundingClientRect();
    const w = Math.min(280, window.innerWidth - 24);
    tip.style.maxWidth = `${w}px`;
    const tw = tip.offsetWidth;
    const left = Math.max(12, Math.min(window.innerWidth - tw - 12, r.left + r.width / 2 - tw / 2));
    const above = r.top > tip.offsetHeight + 16;
    tip.style.left = `${left}px`;
    tip.style.top = `${above ? r.top - tip.offsetHeight - 8 + window.scrollY : r.bottom + 8 + window.scrollY}px`;
  };
  const hide = () => {
    current?.removeAttribute('aria-describedby');
    current = null;
    tip.hidden = true;
  };
  document.addEventListener('mouseover', (e) => {
    const el = (e.target as HTMLElement).closest?.('[data-tip]') as HTMLElement | null;
    if (el) show(el);
    else if (current) hide();
  });
  document.addEventListener('focusin', (e) => {
    const el = (e.target as HTMLElement).closest?.('[data-tip]') as HTMLElement | null;
    if (el) show(el);
    else hide();
  });
  document.addEventListener('click', (e) => {
    const el = (e.target as HTMLElement).closest?.('[data-tip]') as HTMLElement | null;
    if (el && el.tagName === 'BUTTON') {
      e.preventDefault();
      if (current === el && !tip.hidden) hide();
      else show(el);
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') hide();
  });
  window.addEventListener('scroll', hide, { passive: true });
}
