// /seller/sign-in — email and password sign-in.

import type { Page } from '../router.js';
import { navigate } from '../router.js';
import { html, on, formValues } from '../ui/dom.js';
import { field, callout, showFieldErrors } from '../ui/components.js';
import * as api from '../api.js';

const page: Page = ({ root, query }) => {
  const next = query.get('next');
  const safeNext = next && /^\/seller(\/[\w/-]*)?$/.test(next) ? next : '/seller';
  root.innerHTML = html`
    <div class="auth-wrap">
      <header class="register-head">
        <h1>Sign in to your seller account</h1>
        <p class="muted">Manage your shop, orders and payouts.</p>
      </header>
      <form class="card auth-card" novalidate data-role="sign-in">
        ${field({ name: 'email', label: 'Email', type: 'email', required: true, attrs: 'autocomplete="email" autofocus' })}
        ${field({ name: 'password', label: 'Password', type: 'password', required: true, attrs: 'autocomplete="current-password"' })}
        <p class="form-error" role="alert" hidden></p>
        <button type="submit" class="btn btn-primary btn-block">Sign in</button>
        <p class="muted small center">New to Mithren Agro? <a href="#/seller/register">Create a seller account</a></p>
      </form>
      ${api.PREVIEW_DEMO
        ? callout('info', 'Preview demo account', html`This preview runs without a server. Sign in as the demo seller with <strong>${api.PREVIEW_DEMO.email}</strong> and password <strong>${api.PREVIEW_DEMO.password}</strong>, or create a new account.`)
        : ''}
    </div>`.value;

  on(root, 'submit', '[data-role=sign-in]', async (e, el) => {
    e.preventDefault();
    const form = el as HTMLFormElement;
    const f = formValues(form);
    const err = form.querySelector('.form-error') as HTMLElement;
    err.hidden = true;
    const errors: Record<string, string> = {};
    if (!f.email?.trim()) errors.email = 'Enter your email address.';
    if (!f.password) errors.password = 'Enter your password.';
    if (Object.keys(errors).length) return showFieldErrors(form, errors);
    const btn = form.querySelector('[type=submit]') as HTMLButtonElement;
    btn.disabled = true;
    btn.textContent = 'Signing in…';
    try {
      await api.auth.signIn(f.email!.trim(), f.password!);
      navigate(safeNext);
    } catch (ex) {
      err.textContent = (ex as Error).message;
      err.hidden = false;
      btn.disabled = false;
      btn.textContent = 'Sign in';
      (form.querySelector('#f_password') as HTMLInputElement).value = '';
    }
  });
};

export default page;
