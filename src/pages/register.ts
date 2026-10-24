// /seller/register — multi-step seller application.

import type { Page } from '../router.js';
import { navigate } from '../router.js';
import { html, raw, on, $, $$, formValues, type Raw } from '../ui/dom.js';
import { field, textarea, select, icon, callout, showFieldErrors } from '../ui/components.js';
import { toast } from '../ui/overlay.js';
import * as api from '../api.js';
import { EMAIL_RE, PHONE_RE, PAN_RE, GSTIN_RE, IFSC_RE, PINCODE_RE, passwordIssues, validateUpload, UPLOAD_RULES } from '../lib.js';
import { CATEGORIES } from '../data/seed.js';
import type { DocumentType } from '../types.js';

const STEPS = ['Account', 'Shop', 'Business & tax', 'Bank & documents', 'Review'];
const DEMO_OTP = '123456';

interface State {
  ownerName: string;
  email: string;
  phone: string;
  password: string;
  password2: string;
  emailVerified: boolean;
  phoneVerified: boolean;
  otpSent: { email: boolean; phone: boolean };
  shopName: string;
  description: string;
  address: string;
  pincode: string;
  pickupSame: boolean;
  pickupAddress: string;
  serviceAreas: string;
  productTypes: string[];
  claimsOrganic: boolean;
  businessType: string;
  pan: string;
  gstRegistered: boolean;
  gstin: string;
  bankAccountName: string;
  bankAccountNumber: string;
  ifsc: string;
  files: Partial<Record<DocumentType, { name: string; type: string; size: number }>>;
  consent: boolean;
}

const page: Page = ({ root }) => {
  // Kept in memory only: bank and identity details are never written to browser storage.
  const s: State = {
    ownerName: '', email: '', phone: '', password: '', password2: '', emailVerified: false, phoneVerified: false, otpSent: { email: false, phone: false },
    shopName: '', description: '', address: '', pincode: '', pickupSame: true, pickupAddress: '', serviceAreas: '', productTypes: [], claimsOrganic: false,
    businessType: 'proprietorship', pan: '', gstRegistered: false, gstin: '',
    bankAccountName: '', bankAccountNumber: '', ifsc: '', files: {}, consent: false,
  };
  let step = 0;

  const render = () => {
    root.innerHTML = html`
      <div class="register">
        <header class="register-head">
          <h1>Sell on Mithren Agro</h1>
          <p class="muted">Apply in about 10 minutes. We review every seller before listings go live.</p>
        </header>
        <ol class="wizard-steps" aria-label="Application progress">
          ${STEPS.map((l, i) => html`<li class="${i < step ? 'done' : i === step ? 'current' : ''}" ${i === step ? raw('aria-current="step"') : ''}><span aria-hidden="true">${i < step ? icon('check', 12) : i + 1}</span><span class="wl">${l}</span></li>`)}
        </ol>
        <form class="card register-card" novalidate data-step="${step}">
          <h2 class="card-title">Step ${step + 1} of ${STEPS.length}: ${STEPS[step]}</h2>
          ${[stepAccount, stepShop, stepBusiness, stepBank, stepReview][step]!(s)}
          <p class="form-error" role="alert" hidden></p>
          <div class="wizard-actions">
            ${step > 0 ? html`<button type="button" class="btn" data-action="back">Back</button>` : html`<span></span>`}
            <button type="submit" class="btn btn-primary">${step === STEPS.length - 1 ? 'Submit application' : 'Continue'}</button>
          </div>
        </form>
        <p class="muted small center">Already a seller? Sign-in is handled by the shared marketplace auth service in production.</p>
      </div>`.value;
    ($('form input:not([type=hidden]):not([disabled])', root) as HTMLElement | null)?.focus();
  };

  const form = () => $('form', root) as HTMLFormElement;
  const collect = () => {
    const f = formValues(form());
    const cb = (n: string) => !!form().querySelector<HTMLInputElement>(`[name=${n}]`)?.checked;
    switch (step) {
      case 0:
        Object.assign(s, { ownerName: f.ownerName?.trim() ?? '', email: f.email?.trim() ?? '', phone: f.phone?.replace(/\s/g, '') ?? '', password: f.password ?? '', password2: f.password2 ?? '' });
        break;
      case 1:
        Object.assign(s, {
          shopName: f.shopName?.trim() ?? '', description: f.description?.trim() ?? '', address: f.address?.trim() ?? '', pincode: f.pincode?.trim() ?? '',
          pickupSame: cb('pickupSame'), pickupAddress: f.pickupAddress?.trim() ?? '', serviceAreas: f.serviceAreas ?? '',
          productTypes: $$<HTMLInputElement>('[name=productTypes]:checked', form()).map((c) => c.value), claimsOrganic: cb('claimsOrganic'),
        });
        break;
      case 2:
        Object.assign(s, { businessType: f.businessType ?? '', pan: (f.pan ?? '').toUpperCase().trim(), gstRegistered: cb('gstRegistered'), gstin: (f.gstin ?? '').toUpperCase().trim() });
        break;
      case 3:
        Object.assign(s, { bankAccountName: f.bankAccountName?.trim() ?? '', bankAccountNumber: (f.bankAccountNumber ?? '').replace(/\s/g, ''), ifsc: (f.ifsc ?? '').toUpperCase().trim() });
        break;
      case 4:
        s.consent = cb('consent');
        break;
    }
    return f;
  };

  const validate = (f: Record<string, string>): Record<string, string> => {
    const e: Record<string, string> = {};
    if (step === 0) {
      if (s.ownerName.length < 2) e.ownerName = 'Enter your full name.';
      if (!EMAIL_RE.test(s.email)) e.email = 'Enter a valid email address.';
      else if (!s.emailVerified) e.emailOtp = 'Verify your email address.';
      if (!PHONE_RE.test(s.phone)) e.phone = 'Enter a 10-digit Indian mobile number.';
      else if (!s.phoneVerified) e.phoneOtp = 'Verify your phone number.';
      const pw = passwordIssues(s.password);
      if (pw.length) e.password = `Password needs ${pw.join(' and ')}.`;
      else if (s.password !== s.password2) e.password2 = 'Passwords don’t match.';
    }
    if (step === 1) {
      if (s.shopName.length < 3) e.shopName = 'Shop name must be at least 3 characters.';
      if (s.description.length < 30) e.description = 'Tell customers a bit more (at least 30 characters).';
      if (s.address.length < 10) e.address = 'Enter your full business address.';
      if (!PINCODE_RE.test(s.pincode)) e.pincode = 'Enter a valid 6-digit PIN code.';
      if (!s.pickupSame && s.pickupAddress.length < 10) e.pickupAddress = 'Enter the pickup address.';
      if (!s.serviceAreas.split(',').some((a) => a.trim())) e.serviceAreas = 'Add at least one area you deliver to.';
      if (!s.productTypes.length) e.productTypes = 'Choose at least one product type.';
    }
    if (step === 2) {
      if (!PAN_RE.test(s.pan)) e.pan = 'PAN should look like ABCDE1234F.';
      if (s.gstRegistered && !GSTIN_RE.test(s.gstin)) e.gstin = 'GSTIN should be 15 characters, like 27ABCDE1234F1Z5.';
      if (s.gstRegistered && GSTIN_RE.test(s.gstin) && s.gstin.slice(2, 12) !== s.pan) e.gstin = 'GSTIN doesn’t match the PAN entered above.';
    }
    if (step === 3) {
      if (s.bankAccountName.length < 3) e.bankAccountName = 'Enter the account holder name as per bank records.';
      if (!/^\d{9,18}$/.test(s.bankAccountNumber)) e.bankAccountNumber = 'Account number should be 9–18 digits.';
      else if (s.bankAccountNumber !== (f.bankAccountNumber2 ?? '').replace(/\s/g, '')) e.bankAccountNumber2 = 'Account numbers don’t match.';
      if (!IFSC_RE.test(s.ifsc)) e.ifsc = 'IFSC should look like HDFC0001234.';
      for (const t of requiredDocs(s)) if (!s.files[t]) e[`doc_${t}`] = 'This document is required.';
    }
    if (step === 4 && !s.consent) e.consent = 'Please confirm to submit.';
    return e;
  };

  render();

  on(root, 'submit', 'form', async (ev) => {
    ev.preventDefault();
    const f = collect();
    const errs = validate(f);
    const errBox = $('.form-error', root)!;
    errBox.hidden = true;
    if (Object.keys(errs).length) {
      showFieldErrors(form(), errs);
      errBox.textContent = `Please fix ${Object.keys(errs).length} field${Object.keys(errs).length > 1 ? 's' : ''} to continue.`;
      errBox.hidden = false;
      return;
    }
    if (step < STEPS.length - 1) {
      step++;
      render();
      window.scrollTo(0, 0);
      return;
    }
    const btn = $('[type=submit]', root) as HTMLButtonElement;
    btn.disabled = true;
    btn.textContent = 'Submitting…';
    try {
      await api.submitApplication({
        shopName: s.shopName,
        ownerName: s.ownerName,
        email: s.email,
        phone: s.phone,
        address: `${s.address}, ${s.pincode}`,
        pickupAddress: s.pickupSame ? `${s.address}, ${s.pincode}` : s.pickupAddress,
        serviceAreas: s.serviceAreas.split(',').map((a) => a.trim()).filter(Boolean),
        productTypes: s.productTypes,
        description: s.description,
        ...(s.gstRegistered ? { gstin: s.gstin } : {}),
        pan: s.pan,
        bankAccountName: s.bankAccountName,
        bankAccountNumber: s.bankAccountNumber,
        ifsc: s.ifsc,
        claimsOrganic: s.claimsOrganic,
        documents: Object.entries(s.files).map(([type, file]) => ({ type: type as DocumentType, fileName: file!.name, mimeType: file!.type, sizeKb: Math.max(1, Math.round(file!.size / 1024)) })),
      });
      toast('Application submitted');
      navigate('/seller');
    } catch (ex) {
      const ae = ex as api.ApiError;
      errBox.textContent = ae.message;
      errBox.hidden = false;
      btn.disabled = false;
      btn.textContent = 'Submit application';
    }
  });

  on(root, 'click', '[data-action=back]', () => {
    collect();
    step--;
    render();
  });
  on(root, 'click', '[data-goto]', (_e, el) => {
    step = Number(el.dataset.goto);
    render();
  });

  // OTP flow (simulated; production sends a code through the notification service)
  on(root, 'click', '[data-otp-send]', (_e, el) => {
    const kind = el.dataset.otpSend as 'email' | 'phone';
    collect();
    const ok = kind === 'email' ? EMAIL_RE.test(s.email) : PHONE_RE.test(s.phone);
    if (!ok) return showFieldErrors(form(), { [kind]: kind === 'email' ? 'Enter a valid email address first.' : 'Enter a valid mobile number first.' });
    s.otpSent[kind] = true;
    render();
    toast(`Demo code sent: ${DEMO_OTP}`, 'info');
    ($(`#f_${kind}Otp`, root) as HTMLInputElement | null)?.focus();
  });
  on(root, 'click', '[data-otp-verify]', (_e, el) => {
    const kind = el.dataset.otpVerify as 'email' | 'phone';
    collect();
    const code = ($(`#f_${kind}Otp`, root) as HTMLInputElement).value.trim();
    if (code !== DEMO_OTP) return showFieldErrors(form(), { [`${kind}Otp`]: 'That code is incorrect. Check the code and try again.' });
    if (kind === 'email') s.emailVerified = true;
    else s.phoneVerified = true;
    render();
  });
  on(root, 'input', '#f_email', () => {
    if (s.emailVerified) {
      s.emailVerified = false;
      s.otpSent.email = false;
    }
  });
  on(root, 'change', '[name=pickupSame]', (_e, el) => {
    $('#pickup-wrap', root)!.hidden = (el as HTMLInputElement).checked;
  });
  on(root, 'change', '[name=gstRegistered]', (_e, el) => {
    $('#gst-wrap', root)!.hidden = !(el as HTMLInputElement).checked;
  });
  on(root, 'change', 'input[type=file][data-doc]', (_e, el) => {
    const input = el as HTMLInputElement;
    const t = input.dataset.doc as DocumentType;
    const file = input.files?.[0];
    if (!file) return;
    const err = validateUpload(file);
    if (err) {
      input.value = '';
      delete s.files[t];
      return showFieldErrors(form(), { [`doc_${t}`]: err });
    }
    s.files[t] = { name: file.name, type: file.type, size: file.size };
    const status = $(`#doc-status-${t}`, root);
    if (status) status.innerHTML = html`${icon('check', 14)} ${file.name}`.value;
    const errEl = $(`#f_doc_${t}_err`, root);
    if (errEl) errEl.hidden = true;
  });
};

function requiredDocs(s: State): DocumentType[] {
  const d: DocumentType[] = ['pan', 'bank_proof', 'address_proof'];
  if (s.gstRegistered) d.push('gst');
  if (s.claimsOrganic) d.push('organic_cert');
  return d;
}

function otpBlock(kind: 'email' | 'phone', s: State): Raw {
  const verified = kind === 'email' ? s.emailVerified : s.phoneVerified;
  if (verified) return html`<p class="small ok-text">${icon('check', 14)} ${kind === 'email' ? 'Email' : 'Phone'} verified</p>`;
  if (!s.otpSent[kind]) return html`<button type="button" class="btn btn-sm" data-otp-send="${kind}">Send verification code</button><p class="field-error" id="f_${kind}Otp_err" hidden></p>`;
  return html`<div class="otp-row">
    ${field({ name: `${kind}Otp`, label: `Code sent to your ${kind}`, hint: `Demo code: ${DEMO_OTP}`, attrs: 'inputmode="numeric" maxlength="6" autocomplete="one-time-code"' })}
    <button type="button" class="btn btn-sm" data-otp-verify="${kind}">Verify</button>
  </div>`;
}

function stepAccount(s: State) {
  return html`
    ${field({ name: 'ownerName', label: 'Your full name', value: s.ownerName, required: true, attrs: 'autocomplete="name"' })}
    <div class="row-2 align-start">
      <div>${field({ name: 'email', label: 'Email', type: 'email', value: s.email, required: true, attrs: `autocomplete="email" ${s.emailVerified ? 'readonly' : ''}` })}${otpBlock('email', s)}</div>
      <div>${field({ name: 'phone', label: 'Mobile number', type: 'tel', value: s.phone, required: true, placeholder: '98XXXXXXXX', attrs: `autocomplete="tel" ${s.phoneVerified ? 'readonly' : ''}` })}${otpBlock('phone', s)}</div>
    </div>
    <div class="row-2">
      ${field({ name: 'password', label: 'Password', type: 'password', value: s.password, required: true, hint: 'At least 10 characters with letters and numbers.', attrs: 'autocomplete="new-password"' })}
      ${field({ name: 'password2', label: 'Confirm password', type: 'password', value: s.password2, required: true, attrs: 'autocomplete="new-password"' })}
    </div>
    <p class="muted small">This creates a <strong>seller</strong> account only. Admin accounts can’t be created through public registration.</p>`;
}

function stepShop(s: State) {
  return html`
    ${field({ name: 'shopName', label: 'Shop name', value: s.shopName, required: true, attrs: 'maxlength="60"' })}
    ${textarea({ name: 'description', label: 'About your farm or business', value: s.description, required: true, rows: 3, hint: 'What you grow, where, and how.', attrs: 'maxlength="800"' })}
    <div class="row-2">
      ${textarea({ name: 'address', label: 'Business address', value: s.address, required: true, rows: 2, attrs: 'autocomplete="street-address"' })}
      ${field({ name: 'pincode', label: 'PIN code', value: s.pincode, required: true, attrs: 'inputmode="numeric" maxlength="6" autocomplete="postal-code"' })}
    </div>
    <label class="check-row"><input type="checkbox" name="pickupSame" ${s.pickupSame ? raw('checked') : ''}/> <span>Pickup location is the same as business address</span></label>
    <div id="pickup-wrap" ${s.pickupSame ? raw('hidden') : ''}>${textarea({ name: 'pickupAddress', label: 'Pickup address', value: s.pickupAddress, rows: 2 })}</div>
    ${field({ name: 'serviceAreas', label: 'Service areas', value: s.serviceAreas, required: true, hint: 'Localities or PIN codes you can serve, separated by commas.' })}
    <fieldset class="field" id="f_productTypes" tabindex="-1">
      <legend>Product types<span class="req" aria-hidden="true"> *</span></legend>
      <div class="chip-row">${CATEGORIES.map((c) => html`<label class="chip"><input type="checkbox" name="productTypes" value="${c}" ${s.productTypes.includes(c) ? raw('checked') : ''}/><span>${c}</span></label>`)}</div>
      <p class="field-error" id="f_productTypes_err" hidden></p>
    </fieldset>
    <label class="check-row"><input type="checkbox" name="claimsOrganic" ${s.claimsOrganic ? raw('checked') : ''}/> <span><strong>I sell certified organic or in-conversion produce</strong><span class="muted small block">You’ll need to upload a valid certificate. Products are never labelled organic automatically.</span></span></label>`;
}

function stepBusiness(s: State) {
  return html`
    ${select({ name: 'businessType', label: 'Business type', value: s.businessType, options: [['individual', 'Individual farmer'], ['proprietorship', 'Sole proprietorship'], ['partnership', 'Partnership / LLP'], ['company', 'Private limited company'], ['fpo', 'Farmer producer organisation (FPO)']] })}
    ${field({ name: 'pan', label: 'PAN', value: s.pan, required: true, placeholder: 'ABCDE1234F', attrs: 'maxlength="10" autocapitalize="characters"' })}
    <label class="check-row"><input type="checkbox" name="gstRegistered" ${s.gstRegistered ? raw('checked') : ''}/> <span>I am registered for GST</span></label>
    <div id="gst-wrap" ${s.gstRegistered ? '' : raw('hidden')}>${field({ name: 'gstin', label: 'GSTIN', value: s.gstin, placeholder: '27ABCDE1234F1Z5', attrs: 'maxlength="15" autocapitalize="characters"' })}</div>
    ${callout('info', 'Tax requirements vary', 'Whether you need GST or other registrations depends on your business. The marketplace operator will confirm what applies to you; this form doesn’t determine legal compliance.')}`;
}

function stepBank(s: State) {
  const docLabel: Record<DocumentType, string> = { pan: 'PAN card', bank_proof: 'Bank proof (cancelled cheque or statement)', address_proof: 'Address proof', gst: 'GST registration certificate', organic_cert: 'Organic certificate', fssai: 'FSSAI registration' };
  const docs: DocumentType[] = [...requiredDocs(s), ...(['fssai'] as DocumentType[])];
  return html`
    <h3 class="sub-title">Payout bank account</h3>
    ${field({ name: 'bankAccountName', label: 'Account holder name', value: s.bankAccountName, required: true })}
    <div class="row-2">
      ${field({ name: 'bankAccountNumber', label: 'Account number', type: 'password', value: s.bankAccountNumber, required: true, attrs: 'inputmode="numeric" autocomplete="off"' })}
      ${field({ name: 'bankAccountNumber2', label: 'Re-enter account number', value: s.bankAccountNumber, required: true, attrs: 'inputmode="numeric" autocomplete="off"' })}
    </div>
    ${field({ name: 'ifsc', label: 'IFSC', value: s.ifsc, required: true, attrs: 'maxlength="11" autocapitalize="characters"' })}
    <p class="muted small">${icon('shield', 13)} Bank details are sent over an encrypted connection and stored securely. Only the last 4 digits are shown in the portal afterwards.</p>
    <h3 class="sub-title">Documents</h3>
    <p class="muted small">${UPLOAD_RULES.label} each.</p>
    <ul class="upload-list">
      ${docs.map((t) => {
        const req = requiredDocs(s).includes(t);
        return html`<li class="field" id="f_doc_${t}" tabindex="-1">
          <label for="doc-${t}">${docLabel[t]}${req ? html`<span class="req" aria-hidden="true"> *</span>` : html` <span class="muted small">(optional)</span>`}</label>
          <input type="file" id="doc-${t}" data-doc="${t}" accept=".pdf,.jpg,.jpeg,.png" aria-describedby="f_doc_${t}_err" />
          <span class="small ok-text" id="doc-status-${t}">${s.files[t] ? html`${icon('check', 14)} ${s.files[t]!.name}` : ''}</span>
          <p class="field-error" id="f_doc_${t}_err" hidden></p>
        </li>`;
      })}
    </ul>`;
}

function stepReview(s: State) {
  const row = (label: string, value: string) => html`<div><dt>${label}</dt><dd>${value || '—'}</dd></div>`;
  return html`
    <section class="review-block"><div class="card-head"><h3 class="sub-title">Account</h3><button type="button" class="link-btn" data-goto="0">Edit</button></div>
      <dl class="kv">${row('Name', s.ownerName)}${row('Email', s.email + ' ✓')}${row('Phone', s.phone + ' ✓')}</dl></section>
    <section class="review-block"><div class="card-head"><h3 class="sub-title">Shop</h3><button type="button" class="link-btn" data-goto="1">Edit</button></div>
      <dl class="kv">${row('Shop name', s.shopName)}${row('Address', `${s.address}, ${s.pincode}`)}${row('Pickup', s.pickupSame ? 'Same as business address' : s.pickupAddress)}${row('Service areas', s.serviceAreas)}${row('Product types', s.productTypes.join(', '))}${row('Organic claim', s.claimsOrganic ? 'Yes — certificate provided' : 'No')}</dl></section>
    <section class="review-block"><div class="card-head"><h3 class="sub-title">Business & tax</h3><button type="button" class="link-btn" data-goto="2">Edit</button></div>
      <dl class="kv">${row('PAN', s.pan)}${row('GSTIN', s.gstRegistered ? s.gstin : 'Not registered')}</dl></section>
    <section class="review-block"><div class="card-head"><h3 class="sub-title">Bank & documents</h3><button type="button" class="link-btn" data-goto="3">Edit</button></div>
      <dl class="kv">${row('Account', `${s.bankAccountName} · ••••${s.bankAccountNumber.slice(-4)} · ${s.ifsc}`)}${row('Documents', Object.values(s.files).map((f) => f!.name).join(', '))}</dl></section>
    <div class="field" id="f_consent" tabindex="-1">
      <label class="check-row"><input type="checkbox" name="consent" ${s.consent ? raw('checked') : ''}/> <span>I confirm the information is accurate, that any organic claims I make will be truthful and backed by valid certification, and I agree to the seller terms.</span></label>
      <p class="field-error" id="f_consent_err" hidden></p>
    </div>`;
}

export default page;
