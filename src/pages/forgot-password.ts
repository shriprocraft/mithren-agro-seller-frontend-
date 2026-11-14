// /seller/forgot-password — two steps: email a 6-digit OTP, then set a new password with it.

import type { Page } from '../router.js';
import { navigate } from '../router.js';
import { html, on, $, formValues } from '../ui/dom.js';
import { field, showFieldErrors } from '../ui/components.js';
import { toast } from '../ui/overlay.js';
import * as api from '../api.js';

const RESEND_COOLDOWN_MS = 30_000;
const STATE_KEY = 'mithren.forgot-password';
const NOTICE_KEY = 'mithren.sign-in.notice';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** A one-time message for the sign-in page (shown once, then forgotten). */
export function takeSignInNotice(): string | null {
  try {
    const notice = sessionStorage.getItem(NOTICE_KEY);
    if (notice) sessionStorage.removeItem(NOTICE_KEY);
    return notice;
  } catch {
    return null;
  }
}

interface ResetState {
  email: string;
  /** When the emailed OTP stops working. */
  expiresAt: number;
  /** When another OTP may be requested. */
  resendAt: number;
}

// Kept for the tab, so a reload in the middle keeps the email and the real countdown.
function readState(): ResetState | null {
  try {
    const v: unknown = JSON.parse(sessionStorage.getItem(STATE_KEY) ?? 'null');
    if (!v || typeof v !== 'object') return null;
    const { email, expiresAt, resendAt } = v as Record<string, unknown>;
    return typeof email === 'string' && EMAIL_RE.test(email) && typeof expiresAt === 'number' && typeof resendAt === 'number' ? { email, expiresAt, resendAt } : null;
  } catch {
    return null;
  }
}
function writeState(state: ResetState | null) {
  try {
    if (state) sessionStorage.setItem(STATE_KEY, JSON.stringify(state));
    else sessionStorage.removeItem(STATE_KEY);
  } catch {
    /* storage unavailable: the flow still works until the page is reloaded */
  }
}

const mmss = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

const page: Page = ({ root }) => {
  let state = readState();
  let busy = false;

  const stepEmail = () => html`
    <form class="card auth-card" novalidate data-role="send">
      <p class="muted small">Step 1 of 2</p>
      ${field({ name: 'email', label: 'Email', type: 'email', required: true, value: state?.email ?? '', placeholder: 'Enter your registered email address', hint: 'We’ll email a 6-digit OTP to reset your password.', attrs: 'autocomplete="email" autofocus maxlength="120"' })}
      <p class="form-error" role="alert" hidden></p>
      <button type="submit" class="btn btn-primary btn-block">Send OTP</button>
      <p class="muted small center"><a href="#/seller/sign-in">Back to sign in</a></p>
    </form>`;

  const stepReset = (s: ResetState) => html`
    <form class="card auth-card" novalidate data-role="reset">
      <p class="muted small">Step 2 of 2</p>
      <p class="small">If a seller account exists for <strong>${s.email}</strong>, we’ve emailed it a 6-digit OTP. <a href="#/seller/forgot-password" data-action="change-email">Use a different email</a></p>
      ${field({ name: 'otp', label: 'OTP', required: true, placeholder: 'Enter the 6-digit OTP', attrs: 'inputmode="numeric" maxlength="6" autocomplete="one-time-code" pattern="[0-9]*" autofocus' })}
      <div class="row-wrap otp-row">
        <p class="otp-timer small" data-timer aria-live="off"></p>
        <button type="button" class="btn btn-sm btn-ghost" data-action="resend">Resend OTP</button>
      </div>
      ${field({ name: 'password', label: 'New password', type: 'password', reveal: true, required: true, placeholder: 'Create a strong password', hint: 'At least 10 characters, with letters and numbers.', attrs: 'autocomplete="new-password" maxlength="128"' })}
      ${field({ name: 'password2', label: 'Re-enter new password', type: 'password', reveal: true, required: true, placeholder: 'Re-enter your new password', attrs: 'autocomplete="new-password" maxlength="128"' })}
      <p class="form-error" role="alert" hidden></p>
      <button type="submit" class="btn btn-primary btn-block">Reset Password</button>
      <p class="muted small center"><a href="#/seller/sign-in">Back to sign in</a></p>
    </form>`;

  const render = () => {
    root.innerHTML = html`
      <div class="auth-wrap">
        <header class="register-head">
          <h1>Reset your password</h1>
          <p class="muted">${state ? 'Enter the OTP from your email and choose a new password.' : 'Enter the email you registered with.'}</p>
        </header>
        ${state ? stepReset(state) : stepEmail()}
      </div>`.value;
    tick();
    ($('form [autofocus]', root) as HTMLElement | null)?.focus();
  };

  const showError = (message: string, errors?: Record<string, string>) => {
    const form = $('form', root) as HTMLFormElement;
    const box = $('.form-error', root)!;
    box.textContent = message;
    box.hidden = false;
    if (errors && Object.keys(errors).length) showFieldErrors(form, errors);
  };

  // Countdown to expiry, and the wait before another OTP can be requested.
  function tick() {
    if (!state) return;
    const timer = $('[data-timer]', root);
    const resend = root.querySelector<HTMLButtonElement>('[data-action=resend]');
    const left = state.expiresAt - Date.now();
    if (timer) {
      timer.textContent = left > 0 ? `Your OTP expires in ${mmss(left)}` : 'Your OTP has expired. Send a new one.';
      timer.classList.toggle('muted', left > 0);
      timer.classList.toggle('error-text', left <= 0);
    }
    if (resend && !busy) {
      const wait = state.resendAt - Date.now();
      resend.disabled = wait > 0;
      resend.textContent = wait > 0 ? `Resend OTP in ${mmss(wait)}` : 'Resend OTP';
    }
  }
  const ticker = window.setInterval(() => {
    if (!root.isConnected) return window.clearInterval(ticker);
    tick();
  }, 1000);

  async function sendOtp(email: string, btn: HTMLButtonElement, busyLabel: string) {
    if (busy) return;
    busy = true;
    const label = btn.textContent ?? '';
    btn.disabled = true;
    btn.textContent = busyLabel;
    try {
      const r = await api.auth.forgotPassword(email);
      state = { email, expiresAt: Date.now() + r.expiresInSeconds * 1000, resendAt: Date.now() + RESEND_COOLDOWN_MS };
      writeState(state);
      busy = false;
      render();
      toast('If that email has a seller account, an OTP is on its way.');
    } catch (ex) {
      const ae = ex as api.ApiError;
      busy = false;
      if (btn.isConnected) {
        btn.disabled = false;
        btn.textContent = label;
      }
      showError(ae.message, ae.fieldErrors);
      tick();
    }
  }

  on(root, 'submit', '[data-role=send]', (e, el) => {
    e.preventDefault();
    const form = el as HTMLFormElement;
    $('.form-error', root)!.hidden = true;
    const email = (formValues(form).email ?? '').trim().toLowerCase();
    if (!EMAIL_RE.test(email)) return showFieldErrors(form, { email: 'Enter a valid email address.' });
    void sendOtp(email, form.querySelector('[type=submit]') as HTMLButtonElement, 'Sending…');
  });

  on(root, 'click', '[data-action=resend]', (_e, el) => {
    if (!state || state.resendAt > Date.now()) return;
    $('.form-error', root)!.hidden = true;
    void sendOtp(state.email, el as HTMLButtonElement, 'Sending…');
  });

  on(root, 'click', '[data-action=change-email]', (e) => {
    e.preventDefault();
    state = null;
    writeState(null);
    render();
  });

  on(root, 'submit', '[data-role=reset]', async (e, el) => {
    e.preventDefault();
    if (!state || busy) return;
    const form = el as HTMLFormElement;
    const f = formValues(form);
    $('.form-error', root)!.hidden = true;
    const errors: Record<string, string> = {};
    const otp = (f.otp ?? '').trim();
    const pw = f.password ?? '';
    if (!/^\d{6}$/.test(otp)) errors.otp = 'Enter the 6-digit OTP.';
    else if (state.expiresAt <= Date.now()) errors.otp = 'This OTP has expired. Send a new one.';
    if (pw.length < 10) errors.password = 'Use at least 10 characters.';
    else if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) errors.password = 'Use both letters and numbers.';
    if (!errors.password && pw !== f.password2) errors.password2 = 'Passwords don’t match.';
    if (Object.keys(errors).length) return showError('Please fix the highlighted fields.', errors);

    const btn = form.querySelector('[type=submit]') as HTMLButtonElement;
    busy = true;
    btn.disabled = true;
    btn.textContent = 'Resetting…';
    try {
      await api.auth.resetPassword(state.email, otp, pw);
      writeState(null);
      try {
        sessionStorage.setItem(NOTICE_KEY, 'Password reset successful. Please sign in with your new password.');
      } catch {
        /* the sign-in page just won't show the confirmation */
      }
      navigate('/seller/sign-in');
    } catch (ex) {
      const ae = ex as api.ApiError;
      busy = false;
      btn.disabled = false;
      btn.textContent = 'Reset Password';
      showError(ae.message, ae.fieldErrors);
      tick();
    }
  });

  render();
};

export default page;
