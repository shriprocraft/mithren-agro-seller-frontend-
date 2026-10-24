// /seller/register — account creation, verification and the 8-step seller application.
// Every step is validated in the browser for quick feedback and again by the
// backend, which is the only place progress and status are recorded.

import type { Page } from '../router.js';
import { navigate } from '../router.js';
import { html, raw, on, $, $$, formValues, type Raw } from '../ui/dom.js';
import { field, textarea, select, icon, callout, showFieldErrors, badge } from '../ui/components.js';
import { toast } from '../ui/overlay.js';
import * as api from '../api.js';
import { CATEGORIES } from '../data/seed.js';
import { fmtDate, fileSize } from '../lib.js';
import {
  STEPS,
  BUSINESS_TYPES,
  GST_STATUSES,
  INDIAN_STATES,
  DOC_KIND_LABEL,
  CERTIFICATION_STATUS_LABEL,
  UPLOAD_LIMITS,
  PAYOUT_DETAILS_REQUIRED,
  kycRules,
  requiredDocuments,
  validateStep,
  validateBank,
  maskAccount,
  normaliseApplicationData,
  type AccountView,
  type ApplicationData,
  type ApplicationDocKind,
  type ApplicationDocument,
  type ApplicationView,
} from '../application.js';

const page: Page = async ({ root, account: initialAccount }) => {
  let account: AccountView | null = initialAccount;
  let view: ApplicationView | null = null;
  let data: ApplicationData;
  let step = 1;
  let previewCodes: Partial<Record<'email' | 'phone', string>> = {};
  let busy = false;

  if (account) {
    view = await api.application.get();
    if (!view.editable) return navigate('/seller', true);
    data = view.data;
    step = account.emailVerified && account.phoneVerified ? Math.max(2, view.currentStep) : 1;
  } else {
    data = normaliseApplicationData({});
  }

  const submitKeyStore = () => `mithren-submit-key:${account?.userId ?? ''}`;
  const submitKey = () => {
    try {
      let k = sessionStorage.getItem(submitKeyStore());
      if (!k) {
        k = crypto.randomUUID();
        sessionStorage.setItem(submitKeyStore(), k);
      }
      return k;
    } catch {
      return crypto.randomUUID();
    }
  };

  const docsOf = (kind: ApplicationDocKind) => (view?.documents ?? []).filter((d) => d.kind === kind);

  // ---------- rendering ----------
  const render = () => {
    const furthest = view ? Math.max(view.currentStep, step) : 1;
    root.innerHTML = html`
      <div class="register">
        <header class="register-head">
          <h1>Sell on Mithren Agro</h1>
          <p class="muted">${account ? `Signed in as ${account.email}. Your progress is saved as you go.` : 'Create your seller account, then tell us about your business. It takes about 15 minutes.'}</p>
        </header>
        ${view?.status === 'changes_requested'
          ? callout('warn', 'A reviewer has asked for changes', html`${view.reviewerMessage ?? ''}${view.requestedItems.length ? html`<ul class="requested">${view.requestedItems.map((i) => html`<li>${i}</li>`)}</ul>` : ''}`)
          : ''}
        <nav aria-label="Application progress">
          <p class="sr-only" aria-live="polite">Step ${step} of ${STEPS.length}: ${STEPS[step - 1]!.label}</p>
          <ol class="wizard-steps wizard-8">
            ${STEPS.map((s) => {
              const state = s.n < step ? 'done' : s.n === step ? 'current' : '';
              const reachable = account && s.n !== step && s.n <= furthest && (s.n === 1 || (account.emailVerified && account.phoneVerified));
              const inner = html`<span aria-hidden="true">${s.n < step ? icon('check', 12) : s.n}</span><span class="wl">${s.label}</span>`;
              return html`<li class="${state}" ${s.n === step ? raw('aria-current="step"') : ''}>
                ${reachable ? html`<button type="button" class="step-link" data-goto="${s.n}">${inner}<span class="sr-only"> (go to step)</span></button>` : inner}
              </li>`;
            })}
          </ol>
        </nav>
        <form class="card register-card" novalidate data-role="step">
          <h2 class="card-title">Step ${step} of ${STEPS.length}: ${STEPS[step - 1]!.label}</h2>
          ${body()}
          <p class="form-error" role="alert" hidden></p>
          ${actions()}
        </form>
        ${account ? '' : html`<p class="muted small center">Already have a seller account? <a href="#/seller/sign-in">Sign in</a></p>`}
      </div>`.value;
    ($('form [autofocus]', root) as HTMLElement | null)?.focus();
  };

  const actions = () => {
    if (step === 1 && !account) return html`<div class="wizard-actions"><span></span><button type="submit" class="btn btn-primary">Create account</button></div>`;
    return html`<div class="wizard-actions">
      ${step > 1 ? html`<button type="button" class="btn" data-action="prev">Previous</button>` : html`<span></span>`}
      <div class="row-wrap">
        ${step > 1 ? html`<button type="button" class="btn btn-ghost" data-action="save">Save draft</button>` : ''}
        <button type="submit" class="btn btn-primary">${step === 8 ? 'Submit application' : 'Next'}</button>
      </div>
    </div>`;
  };

  const body = (): Raw => {
    switch (step) {
      case 1:
        return account ? stepVerify(account) : stepCreateAccount();
      case 2:
        return stepShop();
      case 3:
        return stepAddress();
      case 4:
        return stepProducts();
      case 5:
        return stepKyc();
      case 6:
        return stepBank();
      case 7:
        return stepOrganic();
      default:
        return stepReview();
    }
  };

  const stepCreateAccount = () => html`
    <p class="muted">This creates a <strong>seller</strong> account. Admin accounts can’t be created through public registration.</p>
    ${field({ name: 'fullName', label: 'Your full name', required: true, attrs: 'autocomplete="name" autofocus maxlength="80"' })}
    <div class="row-2">
      ${field({ name: 'email', label: 'Email', type: 'email', required: true, hint: 'We’ll send a verification code.', attrs: 'autocomplete="email" maxlength="120"' })}
      ${field({ name: 'phone', label: 'Mobile number', type: 'tel', required: true, placeholder: '98XXXXXXXX', hint: 'Indian mobile number. We’ll send an OTP.', attrs: 'autocomplete="tel" maxlength="16"' })}
    </div>
    <div class="row-2">
      ${field({ name: 'password', label: 'Password', type: 'password', required: true, hint: 'At least 10 characters, with letters and numbers.', attrs: 'autocomplete="new-password" maxlength="200"' })}
      ${field({ name: 'password2', label: 'Confirm password', type: 'password', required: true, attrs: 'autocomplete="new-password" maxlength="200"' })}
    </div>`;

  const verifyBlock = (channel: 'email' | 'phone', verified: boolean, target: string) => {
    const label = channel === 'email' ? 'Email' : 'Mobile number';
    if (verified) return html`<div class="verify-row verified">${icon('check', 16)} <span><strong>${label} verified</strong><span class="muted small block">${target}</span></span></div>`;
    return html`<div class="verify-row">
      <div class="verify-target"><strong>${label}</strong><span class="muted small block">${target}</span></div>
      ${field({ name: `${channel}Code`, label: `${channel === 'email' ? 'Email' : 'SMS'} code`, hint: previewCodes[channel] ? `Preview only, no ${channel === 'email' ? 'email' : 'SMS'} is sent: your code is ${previewCodes[channel]}` : 'Enter the 6-digit code we sent.', attrs: 'inputmode="numeric" maxlength="6" autocomplete="one-time-code" pattern="[0-9]*"' })}
      <div class="row-wrap">
        <button type="button" class="btn btn-sm btn-primary" data-verify="${channel}">Verify</button>
        <button type="button" class="btn btn-sm btn-ghost" data-send="${channel}">Send a new code</button>
      </div>
    </div>`;
  };

  const stepVerify = (a: AccountView) => html`
    <p class="muted">Verify your email and mobile number to continue. Codes expire after 10 minutes.</p>
    <div class="stack">
      ${verifyBlock('email', a.emailVerified, a.email)}
      ${verifyBlock('phone', a.phoneVerified, a.phoneMasked)}
    </div>`;

  const stepShop = () => html`
    <p class="muted small">Fields marked <span class="req">*</span> are required.</p>
    ${field({ name: 'shopName', label: 'Shop or store name', value: data.shopName, required: true, attrs: 'maxlength="60" autofocus' })}
    <div class="row-2">
      ${field({ name: 'ownerName', label: 'Owner’s full name', value: data.ownerName, required: true, attrs: 'maxlength="80" autocomplete="name"' })}
      ${field({ name: 'contactName', label: 'Contact person', value: data.contactName, hint: 'Optional. Only if different from the owner.', attrs: 'maxlength="80"' })}
    </div>
    ${field({ name: 'businessEmail', label: 'Business email', type: 'email', value: data.businessEmail, required: true, attrs: 'maxlength="120" autocomplete="email"' })}
    <div class="row-2">
      ${field({ name: 'primaryPhone', label: 'Primary phone', type: 'tel', value: data.primaryPhone, required: true, attrs: 'maxlength="16" autocomplete="tel"' })}
      ${field({ name: 'altPhone', label: 'Alternate phone', type: 'tel', value: data.altPhone, hint: 'Optional.', attrs: 'maxlength="16"' })}
    </div>
    ${textarea({ name: 'description', label: 'Business description', value: data.description, required: true, rows: 4, hint: 'What you grow or sell, where, and how. At least 30 characters.', attrs: 'maxlength="800"' })}
    <h3 class="sub-title">Store logo <span class="muted small">(optional)</span></h3>
    ${docSlot('logo', false)}`;

  const stepAddress = () => html`
    ${field({ name: 'addressLine1', label: 'Building and street', value: data.addressLine1, required: true, attrs: 'maxlength="120" autocomplete="address-line1" autofocus' })}
    ${field({ name: 'addressLine2', label: 'Area or landmark', value: data.addressLine2, hint: 'Optional.', attrs: 'maxlength="120" autocomplete="address-line2"' })}
    <div class="row-2">
      ${select({ name: 'country', label: 'Country', value: 'India', options: [['India', 'India']], hint: 'Selling is currently available in India only.' })}
      ${select({ name: 'state', label: 'State or union territory', value: data.state, required: true, options: [['', 'Choose…'], ...INDIAN_STATES.map((s) => [s, s] as [string, string])] })}
    </div>
    <div class="row-3">
      ${field({ name: 'district', label: 'District', value: data.district, required: true, attrs: 'maxlength="60"' })}
      ${field({ name: 'city', label: 'City, town or village', value: data.city, required: true, attrs: 'maxlength="60" autocomplete="address-level2"' })}
      ${field({ name: 'pincode', label: 'PIN code', value: data.pincode, required: true, attrs: 'inputmode="numeric" maxlength="6" autocomplete="postal-code"' })}
    </div>
    ${textarea({ name: 'serviceAreas', label: 'Service area', value: data.serviceAreas.join(', '), required: true, rows: 2, hint: 'Localities or PIN codes you can deliver to, separated by commas.', attrs: 'maxlength="1500"' })}`;

  const stepProducts = () => html`
    <fieldset class="field" id="f_productTypes" tabindex="-1">
      <legend>Product types and categories<span class="req" aria-hidden="true"> *</span></legend>
      <div class="chip-row">${CATEGORIES.map((c) => html`<label class="chip"><input type="checkbox" name="productTypes" value="${c}" ${data.productTypes.includes(c) ? raw('checked') : ''}/><span>${c}</span></label>`)}</div>
      <p class="field-error" id="f_productTypes_err" hidden></p>
    </fieldset>
    <h3 class="sub-title">Pickup location</h3>
    <label class="check-row"><input type="checkbox" name="pickupSameAsBusiness" ${data.pickupSameAsBusiness ? raw('checked') : ''}/> <span>Orders are picked up from my business address</span></label>
    <div id="pickup-wrap" ${data.pickupSameAsBusiness ? raw('hidden') : ''}>
      ${textarea({ name: 'pickupAddress', label: 'Pickup address', value: data.pickupAddress, required: true, rows: 2, hint: 'Where the delivery partner collects orders, e.g. your packhouse.', attrs: 'maxlength="240"' })}
      ${field({ name: 'pickupPincode', label: 'Pickup PIN code', value: data.pickupPincode, required: true, attrs: 'inputmode="numeric" maxlength="6"' })}
    </div>`;

  const stepKyc = () => {
    const r = kycRules(data);
    const needed = requiredDocuments(data);
    return html`
      <div class="row-2">
        ${select({ name: 'businessType', label: 'Business type and legal structure', value: data.businessType, required: true, options: [['', 'Choose…'], ...BUSINESS_TYPES] })}
        ${select({ name: 'gstStatus', label: 'GST registration status', value: data.gstStatus, required: true, options: [['', 'Choose…'], ...GST_STATUSES] })}
      </div>
      <div id="kyc-conditional">
        ${field({ name: 'pan', label: 'PAN', value: data.pan, required: r.panRequired, hint: r.panRequired ? 'Required for your business type or GST registration.' : 'Optional for individual farmers who aren’t GST-registered.', placeholder: 'ABCDE1234F', attrs: 'maxlength="10" autocapitalize="characters"' })}
        ${r.gstinRequired ? field({ name: 'gstin', label: 'GSTIN', value: data.gstin, required: true, placeholder: '27ABCDE1234F1Z5', attrs: 'maxlength="15" autocapitalize="characters"' }) : ''}
        ${r.registrationRequired ? field({ name: 'registrationNumber', label: r.registrationLabel, value: data.registrationNumber, required: true, attrs: 'maxlength="40" autocapitalize="characters"' }) : ''}
      </div>
      ${callout('info', 'Requirements depend on your business', 'We only ask for the tax and registration details that apply to your business type and GST status. Our team will tell you if anything else is needed.')}
      <h3 class="sub-title">Documents</h3>
      <p class="muted small">PDF, JPG or PNG, up to 5 MB each. Files are stored privately and seen only by you and authorised reviewers.</p>
      <div class="doc-slots">
        ${(['address_proof', 'pan', 'gst', 'business_registration'] as ApplicationDocKind[]).filter((k) => needed.includes(k) || docsOf(k).length).map((k) => docSlot(k, needed.includes(k)))}
        ${docSlot('additional', false, 'Upload any extra documents a reviewer asked for.')}
      </div>`;
  };

  const stepBank = () => html`
    <p class="muted">${PAYOUT_DETAILS_REQUIRED ? 'Settlements are paid by bank transfer, so payout details are required before approval.' : 'Add payout details now or later.'}</p>
    ${view?.bank
      ? html`<div class="bank-saved" id="f_bank" tabindex="-1">
          ${icon('shield', 18)}
          <div><strong>${view.bank.holderName}</strong><span class="block mono">${maskAccount(view.bank.last4)}</span><span class="muted small block">${view.bank.ifsc}${view.bank.bankName ? ` · ${view.bank.bankName}` : ''} · saved ${fmtDate(view.bank.updatedAt)}</span></div>
          <button type="button" class="btn btn-sm" data-action="edit-bank">Replace</button>
        </div>`
      : ''}
    <div id="bank-form" ${view?.bank ? raw('hidden') : ''}>
      ${view?.bank ? '' : html`<div id="f_bank" tabindex="-1"><p class="field-error" id="f_bank_err" hidden></p></div>`}
      ${field({ name: 'holderName', label: 'Account holder name', required: true, hint: 'As it appears in your bank records.', attrs: 'maxlength="100" autocomplete="off"' })}
      <div class="row-2">
        ${field({ name: 'accountNumber', label: 'Bank account number', type: 'password', required: true, attrs: 'inputmode="numeric" maxlength="18" autocomplete="off"' })}
        ${field({ name: 'accountNumberConfirm', label: 'Re-enter account number', type: 'password', required: true, attrs: 'inputmode="numeric" maxlength="18" autocomplete="off"' })}
      </div>
      <div class="row-2">
        ${field({ name: 'ifsc', label: 'IFSC', required: true, placeholder: 'HDFC0001234', attrs: 'maxlength="11" autocapitalize="characters" autocomplete="off"' })}
        ${field({ name: 'bankName', label: 'Bank name', hint: 'Optional.', attrs: 'maxlength="80" autocomplete="off"' })}
      </div>
      <div class="row-wrap"><button type="button" class="btn btn-primary btn-sm" data-action="save-bank">Save bank details</button></div>
    </div>
    <p class="muted small">${icon('shield', 13)} Sent over an encrypted connection and stored encrypted. Only the last 4 digits are ever shown. We never ask for card PINs, banking passwords or OTPs.</p>
    <h3 class="sub-title">Bank proof</h3>
    ${docSlot('bank_proof', PAYOUT_DETAILS_REQUIRED)}`;

  const stepOrganic = () => {
    const status = view?.organic.status ?? 'not_submitted';
    return html`
      <fieldset class="field" id="f_claimsOrganic" tabindex="-1">
        <legend>Do you sell certified organic products?<span class="req" aria-hidden="true"> *</span></legend>
        <div class="radio-stack">
          <label class="radio-card"><input type="radio" name="claimsOrganic" value="no" ${data.claimsOrganic === false ? raw('checked') : ''}/><span><strong>No</strong><span class="muted small">My products are sold without an organic label. That’s fine: certification isn’t required to sell.</span></span></label>
          <label class="radio-card"><input type="radio" name="claimsOrganic" value="yes" ${data.claimsOrganic ? raw('checked') : ''}/><span><strong>Yes, certified organic</strong><span class="muted small">Upload your certificate. It stays unverified until a reviewer checks it.</span></span></label>
        </div>
        <p class="field-error" id="f_claimsOrganic_err" hidden></p>
      </fieldset>
      <div id="organic-wrap" ${data.claimsOrganic ? '' : raw('hidden')}>
        <p class="cert-status">Certification status: ${certBadge(status)}</p>
        ${field({ name: 'certBody', label: 'Certification body or issuing organisation', value: data.certBody, required: true, attrs: 'maxlength="120"' })}
        ${field({ name: 'certNumber', label: 'Certificate number', value: data.certNumber, hint: 'If your certificate has one.', attrs: 'maxlength="60"' })}
        <div class="row-2">
          ${field({ name: 'certIssueDate', label: 'Issue date', type: 'date', value: data.certIssueDate, hint: 'If available.' })}
          ${field({ name: 'certExpiryDate', label: 'Expiry date', type: 'date', value: data.certExpiryDate, hint: 'If available.' })}
        </div>
        <div class="doc-slots">
          ${docSlot('organic_cert', true)}
          ${docSlot('organic_evidence', false, 'Optional: inspection reports, farm photos or supplier certificates.')}
        </div>
      </div>`;
  };

  const certBadge = (s: keyof typeof CERTIFICATION_STATUS_LABEL) =>
    badge(CERTIFICATION_STATUS_LABEL[s], s === 'verified' ? 'green' : s === 'submitted' ? 'amber' : s === 'not_submitted' ? 'neutral' : 'red');

  const stepReview = () => {
    const d = data;
    const row = (label: string, value: string) => html`<div><dt>${label}</dt><dd>${value || '—'}</dd></div>`;
    const section = (n: number, title: string, rows: Raw) => html`<section class="review-block"><div class="card-head"><h3 class="sub-title">${title}</h3><button type="button" class="link-btn" data-goto="${n}">Edit</button></div><dl class="kv">${rows}</dl></section>`;
    const docs = view?.documents ?? [];
    const needed = requiredDocuments(d);
    return html`
      ${section(2, 'Shop and owner', html`${row('Shop name', d.shopName)}${row('Owner', d.ownerName)}${row('Contact person', d.contactName)}${row('Business email', d.businessEmail)}${row('Phone', [d.primaryPhone, d.altPhone].filter(Boolean).join(', '))}${row('Description', d.description)}`)}
      ${section(3, 'Address and service area', html`${row('Address', [d.addressLine1, d.addressLine2, d.city, d.district, d.state, d.pincode, d.country].filter(Boolean).join(', '))}${row('Service area', d.serviceAreas.join(', '))}`)}
      ${section(4, 'Products and pickup', html`${row('Categories', d.productTypes.join(', '))}${row('Pickup', d.pickupSameAsBusiness ? 'Business address' : `${d.pickupAddress}, ${d.pickupPincode}`)}`)}
      ${section(5, 'Business and KYC', html`${row('Business type', BUSINESS_TYPES.find((b) => b[0] === d.businessType)?.[1] ?? '')}${row('GST', GST_STATUSES.find((g) => g[0] === d.gstStatus)?.[1] ?? '')}${row('GSTIN', d.gstin)}${row('PAN', d.pan ? `${d.pan.slice(0, 2)}•••••${d.pan.slice(-3)}` : '')}${row(kycRules(d).registrationLabel, d.registrationNumber)}`)}
      ${section(6, 'Bank and payout', html`${row('Account', view?.bank ? `${view.bank.holderName} · ${maskAccount(view.bank.last4)} · ${view.bank.ifsc}` : 'Not added')}`)}
      ${section(7, 'Organic certification', html`${row('Claim', d.claimsOrganic ? `Yes — ${d.certBody}${d.certNumber ? `, ${d.certNumber}` : ''}` : 'No organic claim')}${d.claimsOrganic ? row('Status', 'Unverified until a reviewer checks your certificate') : ''}`)}
      <section class="review-block">
        <h3 class="sub-title">Documents</h3>
        <ul class="doc-check">
          ${needed.map((k) => {
            const has = docs.some((x) => x.kind === k && x.status !== 'rejected');
            return html`<li class="${has ? 'ok' : 'missing'}">${icon(has ? 'check' : 'alert', 15)} ${DOC_KIND_LABEL[k]} ${has ? '' : html`<span class="error-text small">— missing</span>`}</li>`;
          })}
        </ul>
      </section>
      <div class="field" id="f_consent" tabindex="-1">
        <label class="check-row"><input type="checkbox" name="consent" /> <span>I confirm this information is accurate, that any organic claim is truthful and backed by a valid certificate, and I agree to the seller terms.</span></label>
        <p class="field-error" id="f_consent_err" hidden></p>
      </div>`;
  };

  function docSlot(kind: ApplicationDocKind, required: boolean, help?: string): Raw {
    const current = docsOf(kind);
    const many = kind === 'additional' || kind === 'organic_evidence';
    const accept = kind === 'logo' ? '.png,.jpg,.jpeg,image/png,image/jpeg' : '.pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png';
    return html`<div class="doc-slot field" id="f_doc_${kind}" tabindex="-1">
      <div class="doc-slot-head">
        <strong>${DOC_KIND_LABEL[kind]}${required ? html`<span class="req" aria-hidden="true"> *</span>` : html` <span class="muted small">(optional)</span>`}</strong>
        <label class="btn btn-sm upload-btn">${icon('upload', 14)} ${current.length && !many ? 'Replace' : 'Upload'}<input type="file" class="sr-only" data-upload="${kind}" accept="${accept}" aria-label="Upload ${DOC_KIND_LABEL[kind]}" /></label>
      </div>
      ${help ? html`<p class="hint">${help}</p>` : ''}
      ${current.map((d) => docLine(d))}
      <p class="field-error" id="f_doc_${kind}_err" hidden></p>
    </div>`;
  }

  function docLine(d: ApplicationDocument) {
    const url = api.application.fileUrl(d.id);
    return html`<div class="doc-line">
      ${icon('documents', 16)}
      <span class="doc-name">${url ? html`<a href="${url}" target="_blank" rel="noopener">${d.fileName}</a>` : d.fileName} <span class="muted small">· ${fileSize(d.sizeBytes)}</span></span>
      ${d.status === 'verified' ? badge('Verified', 'green') : d.status === 'rejected' ? badge('Rejected', 'red') : badge('Unverified', 'neutral')}
      ${d.reviewerNote ? html`<span class="small error-text block">${d.reviewerNote}</span>` : ''}
    </div>`;
  }

  // ---------- reading the form ----------
  const form = () => $('form[data-role=step]', root) as HTMLFormElement;
  function collect() {
    const f = formValues(form());
    const has = (n: string) => form().querySelector(`[name="${n}"]`) !== null;
    const next: Record<string, unknown> = { ...data };
    for (const k of ['shopName', 'ownerName', 'contactName', 'businessEmail', 'primaryPhone', 'altPhone', 'description', 'addressLine1', 'addressLine2', 'state', 'district', 'city', 'pincode', 'pickupAddress', 'pickupPincode', 'businessType', 'gstStatus', 'gstin', 'pan', 'registrationNumber', 'certBody', 'certNumber', 'certIssueDate', 'certExpiryDate'])
      if (has(k)) next[k] = f[k] ?? '';
    if (has('serviceAreas')) next.serviceAreas = (f.serviceAreas ?? '').split(/[,\n]/).map((x) => x.trim()).filter(Boolean);
    if (has('productTypes')) next.productTypes = $$<HTMLInputElement>('[name=productTypes]:checked', form()).map((c) => c.value);
    if (has('pickupSameAsBusiness')) next.pickupSameAsBusiness = !!form().querySelector<HTMLInputElement>('[name=pickupSameAsBusiness]')?.checked;
    if (has('claimsOrganic')) {
      const v = form().querySelector<HTMLInputElement>('[name=claimsOrganic]:checked')?.value;
      next.claimsOrganic = v === 'yes' ? true : v === 'no' ? false : null;
    }
    data = normaliseApplicationData(next);
  }

  const showError = (message: string, errors?: Record<string, string>) => {
    const box = $('.form-error', root)!;
    box.textContent = message;
    box.hidden = false;
    if (errors) showFieldErrors(form(), errors);
  };

  const ctxFor = () => ({
    documentKinds: (view?.documents ?? []).filter((d) => d.status !== 'rejected').map((d) => d.kind),
    bankProvided: !!view?.bank,
    emailVerified: !!account?.emailVerified,
    phoneVerified: !!account?.phoneVerified,
  });

  async function guarded(btn: HTMLButtonElement | null, label: string, fn: () => Promise<void>) {
    if (busy) return;
    busy = true;
    const original = btn?.textContent ?? '';
    if (btn) {
      btn.disabled = true;
      btn.textContent = label;
    }
    try {
      await fn();
    } catch (e) {
      const ae = e as api.ApiError;
      const step0 = Number(ae.fieldErrors?._step);
      if (step0 && step0 !== step) {
        step = step0;
        render();
      }
      showError(ae.message, ae.fieldErrors);
    } finally {
      busy = false;
      if (btn?.isConnected) {
        btn.disabled = false;
        btn.textContent = original;
      }
    }
  }

  async function goTo(target: number, validate: boolean) {
    if (!account) return;
    if (step >= 2) {
      collect();
      if (validate) {
        const errors = validateStep(step, data, ctxFor());
        if (Object.keys(errors).length) return showError('Please fix the highlighted fields.', errors);
      }
      view = await api.application.saveDraft(data, target, validate ? step : null);
      data = view.data;
    } else if (validate) {
      const errors = validateStep(1, data, ctxFor());
      if (Object.keys(errors).length) return showError('Verify your email and mobile number to continue.', errors);
      view = await api.application.saveDraft(data, target, 1);
    }
    step = target;
    render();
    window.scrollTo(0, 0);
  }

  render();
  if (account && step === 1) void autoSendCodes();

  async function autoSendCodes() {
    if (!api.PREVIEW_DEMO || !account) return; // the server sends codes at sign-up
    for (const ch of ['email', 'phone'] as const) {
      if ((ch === 'email' && account.emailVerified) || (ch === 'phone' && account.phoneVerified)) continue;
      try {
        const r = await api.auth.sendCode(ch);
        if (r.previewCode) previewCodes[ch] = r.previewCode;
      } catch {
        /* the seller can request again */
      }
    }
    render();
  }

  // ---------- events ----------
  on(root, 'submit', 'form[data-role=step]', async (e) => {
    e.preventDefault();
    const btn = form().querySelector<HTMLButtonElement>('[type=submit]');
    if (!account) {
      const f = formValues(form());
      const errors: Record<string, string> = {};
      if ((f.fullName ?? '').trim().length < 2) errors.fullName = 'Enter your full name.';
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test((f.email ?? '').trim())) errors.email = 'Enter a valid email address.';
      if (!/^(?:\+?91)?[6-9]\d{9}$/.test((f.phone ?? '').replace(/[\s-]/g, ''))) errors.phone = 'Enter a 10-digit Indian mobile number.';
      const pw = f.password ?? '';
      if (pw.length < 10) errors.password = 'Use at least 10 characters.';
      else if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) errors.password = 'Use both letters and numbers.';
      else if (pw !== f.password2) errors.password2 = 'Passwords don’t match.';
      if (Object.keys(errors).length) return showError('Please fix the highlighted fields.', errors);
      return guarded(btn, 'Creating account…', async () => {
        account = await api.auth.signUp({ fullName: f.fullName!.trim(), email: f.email!.trim(), phone: f.phone!.trim(), password: pw });
        toast('Account created. Check your email and phone for verification codes.');
        // Re-render the whole portal so the header reflects the signed-in account.
        window.dispatchEvent(new HashChangeEvent('hashchange'));
      });
    }
    if (step === 8) {
      if (!form().querySelector<HTMLInputElement>('[name=consent]')?.checked) return showError('Please confirm the declaration to submit.', { consent: 'Please confirm to submit.' });
      return guarded(btn, 'Submitting…', async () => {
        view = await api.application.submit(submitKey());
        try {
          sessionStorage.removeItem(submitKeyStore());
        } catch {
          /* ignore */
        }
        toast(`Application submitted. Reference ${view.referenceId}`);
        navigate('/seller');
      });
    }
    return guarded(btn, 'Saving…', () => goTo(step + 1, true));
  });

  on(root, 'click', '[data-action=prev]', (_e, el) => void guarded(el as HTMLButtonElement, 'Saving…', () => goTo(step - 1, false)));
  on(root, 'click', '[data-action=save]', (_e, el) =>
    void guarded(el as HTMLButtonElement, 'Saving…', async () => {
      collect();
      view = await api.application.saveDraft(data, Math.max(step, view?.currentStep ?? step), null);
      toast('Draft saved');
    }),
  );
  on(root, 'click', '[data-goto]', (_e, el) => void guarded(null, '', () => goTo(Number(el.dataset.goto), false)));

  on(root, 'click', '[data-send]', (_e, el) =>
    void guarded(el as HTMLButtonElement, 'Sending…', async () => {
      const ch = el.dataset.send as 'email' | 'phone';
      const r = await api.auth.sendCode(ch);
      if (r.previewCode) previewCodes[ch] = r.previewCode;
      render();
      toast(`New code sent to your ${ch === 'email' ? 'email' : 'phone'}`);
    }),
  );
  on(root, 'click', '[data-verify]', (_e, el) =>
    void guarded(el as HTMLButtonElement, 'Checking…', async () => {
      const ch = el.dataset.verify as 'email' | 'phone';
      const code = ($(`#f_${ch}Code`, root) as HTMLInputElement).value.trim();
      if (!/^\d{6}$/.test(code)) return showError('Enter the 6-digit code.', { [`${ch}Code`]: 'Enter the 6-digit code.' });
      account = await api.auth.verifyCode(ch, code);
      delete previewCodes[ch];
      render();
      toast(ch === 'email' ? 'Email verified' : 'Mobile number verified');
    }),
  );

  on(root, 'change', '[data-upload]', (_e, el) => {
    const input = el as HTMLInputElement;
    const file = input.files?.[0];
    const kind = input.dataset.upload as ApplicationDocKind;
    if (!file) return;
    const isLogo = kind === 'logo';
    const types = isLogo ? UPLOAD_LIMITS.logoTypes : UPLOAD_LIMITS.documentTypes;
    const max = isLogo ? UPLOAD_LIMITS.logoMaxBytes : UPLOAD_LIMITS.maxBytes;
    if (!types.includes(file.type)) return showError('That file type isn’t accepted.', { [`doc_${kind}`]: isLogo ? 'Logos must be PNG or JPG images.' : 'Upload a PDF, JPG or PNG file.' });
    if (file.size > max) return showError('That file is too large.', { [`doc_${kind}`]: `Files must be ${max / 1048576} MB or smaller.` });
    void guarded(null, '', async () => {
      if (step >= 2) collect();
      view = await api.application.uploadDocument(kind, file);
      render();
      toast(`${DOC_KIND_LABEL[kind]} uploaded. It stays unverified until reviewed.`);
    });
  });

  on(root, 'change', '[name=pickupSameAsBusiness]', (_e, el) => {
    $('#pickup-wrap', root)!.hidden = (el as HTMLInputElement).checked;
  });
  on(root, 'change', '[name=businessType],[name=gstStatus]', () => {
    collect();
    render();
  });
  on(root, 'change', '[name=claimsOrganic]', (_e, el) => {
    $('#organic-wrap', root)!.hidden = (el as HTMLInputElement).value !== 'yes';
  });
  on(root, 'click', '[data-action=edit-bank]', () => {
    $('#bank-form', root)!.hidden = false;
    ($('#f_holderName', root) as HTMLInputElement | null)?.focus();
  });
  on(root, 'click', '[data-action=save-bank]', (_e, el) => {
    const f = formValues(form());
    const input = { holderName: f.holderName ?? '', accountNumber: f.accountNumber ?? '', accountNumberConfirm: f.accountNumberConfirm ?? '', ifsc: (f.ifsc ?? '').toUpperCase(), bankName: f.bankName ?? '' };
    const errors = validateBank(input);
    if (Object.keys(errors).length) return showError('Please fix the bank details.', errors);
    void guarded(el as HTMLButtonElement, 'Saving…', async () => {
      view = await api.application.saveBank(input);
      render();
      toast('Bank details saved securely');
    });
  });
};

export default page;
