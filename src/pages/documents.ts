// /seller/documents — KYC, business and organic certification documents.
// Lists the seller's own application documents as stored by the backend.

import type { Page } from '../router.js';
import { html, on, formValues } from '../ui/dom.js';
import { pageHeader, field, select, icon, badge, callout, showFieldErrors, fileInput } from '../ui/components.js';
import { toast, modal } from '../ui/overlay.js';
import * as api from '../api.js';
import { fmtDate, fileSize } from '../lib.js';
import {
  CERTIFICATION_STATUS_LABEL,
  DOC_KIND_LABEL,
  UPLOAD_LIMITS,
  canUpload,
  requiredDocuments,
  type ApplicationDocKind,
  type ApplicationDocument,
  type ApplicationView,
} from '../application.js';

const KIND_HELP: Record<ApplicationDocKind, string> = {
  pan: 'Business or proprietor PAN card.',
  gst: 'GST registration certificate. Only if you are GST-registered.',
  business_registration: 'Registration certificate for your firm, LLP, company, FPO or cooperative.',
  address_proof: 'Utility bill, rental agreement or property document for your business address.',
  bank_proof: 'Cancelled cheque or bank statement showing the account name and IFSC.',
  organic_cert: 'Only if you sell certified organic products. Must cover the farms and products you list.',
  organic_evidence: 'Optional supporting evidence: inspection reports, farm photos or supplier certificates.',
  logo: 'Optional store logo, PNG or JPG up to 2 MB.',
  additional: 'Anything else a reviewer has asked for.',
};

const ORDER: ApplicationDocKind[] = ['pan', 'gst', 'business_registration', 'address_proof', 'bank_proof', 'organic_cert', 'organic_evidence', 'logo', 'additional'];

function docBadge(d: ApplicationDocument) {
  return d.status === 'verified' ? badge('Verified', 'green') : d.status === 'rejected' ? badge('Rejected', 'red') : badge('Unverified', 'neutral');
}

const page: Page = async ({ root, refresh }) => {
  const view = await api.application.get();
  const required = requiredDocuments(view.data);
  const shown = ORDER.filter((k) => required.includes(k) || view.documents.some((d) => d.kind === k) || canUpload(view.status, k));
  const uploadable = ORDER.filter((k) => canUpload(view.status, k));
  const certStatus = view.organic.status;

  root.innerHTML = html`
    ${pageHeader('Documents', 'Verification documents for your seller account and organic claims.', uploadable.length ? html`<button type="button" class="btn btn-primary" data-action="upload">${icon('upload', 16)} Upload document</button>` : undefined)}
    ${view.status === 'changes_requested' && (view.reviewerMessage || view.requestedItems.length)
      ? callout('warn', 'A reviewer has asked for changes', html`${view.reviewerMessage ?? ''}${view.requestedItems.length ? html`<ul class="requested">${view.requestedItems.map((i) => html`<li>${i}</li>`)}</ul>` : ''}`, html`<a class="btn btn-sm" href="#/seller/register">Update application</a>`)
      : ''}
    ${view.status === 'pending' ? callout('info', 'Your application is under review', 'Documents are locked while it’s reviewed. You can still add additional documents if a reviewer asks for them.') : ''}
    ${view.data.claimsOrganic
      ? html`<section class="card cert-card">
          <div class="card-head"><h2 class="card-title">Organic certification</h2>${badge(CERTIFICATION_STATUS_LABEL[certStatus], certStatus === 'verified' ? 'green' : certStatus === 'submitted' ? 'amber' : certStatus === 'not_submitted' ? 'neutral' : 'red')}</div>
          <dl class="kv kv-compact">
            <div><dt>Issued by</dt><dd>${view.data.certBody || '—'}</dd></div>
            <div><dt>Certificate no.</dt><dd class="mono">${view.data.certNumber || '—'}</dd></div>
            <div><dt>Issued</dt><dd>${view.data.certIssueDate ? fmtDate(view.data.certIssueDate) : '—'}</dd></div>
            <div><dt>Expires</dt><dd>${view.data.certExpiryDate ? fmtDate(view.data.certExpiryDate) : '—'}</dd></div>
          </dl>
          <p class="muted small">${certStatus === 'verified' ? 'Verified by an authorised reviewer.' : 'Organic labels stay hidden on your listings until an authorised reviewer verifies this certificate. Uploading a certificate doesn’t verify it.'}</p>
          ${view.organic.reviewerNote ? html`<p class="small ${certStatus === 'rejected' ? 'error-text' : ''}">Reviewer: ${view.organic.reviewerNote}</p>` : ''}
        </section>`
      : ''}
    <p class="muted small">${icon('shield', 13)} Files are stored privately. Only you and authorised reviewers can open them. A document shows as verified only after a reviewer approves it.</p>
    <div class="doc-grid">
      ${shown.map((k) => {
        const list = view.documents.filter((d) => d.kind === k);
        const isRequired = required.includes(k);
        return html`<section class="card doc-card">
          <div class="card-head">
            <h2 class="card-title">${DOC_KIND_LABEL[k]} ${isRequired ? html`<span class="muted small">· required</span>` : ''}</h2>
            ${canUpload(view.status, k) ? html`<button type="button" class="btn btn-sm" data-action="upload" data-kind="${k}">${list.length && !['additional', 'organic_evidence'].includes(k) ? 'Replace' : 'Upload'}</button>` : ''}
          </div>
          <p class="muted small">${KIND_HELP[k]}</p>
          ${list.length
            ? html`<ul class="doc-list">${list.map((d) => {
                const url = api.application.fileUrl(d.id);
                return html`<li>
                  <div class="doc-file">${icon('documents', 18)}<div><strong>${url ? html`<a href="${url}" target="_blank" rel="noopener">${d.fileName}</a>` : d.fileName}</strong><span class="muted small block">${fileSize(d.sizeBytes)} · uploaded ${fmtDate(d.uploadedAt)}</span></div></div>
                  ${docBadge(d)}
                  ${d.reviewerNote ? html`<p class="small error-text">Reviewer: ${d.reviewerNote}</p>` : ''}
                </li>`;
              })}</ul>`
            : html`<p class="muted">${isRequired ? 'Not uploaded yet.' : 'Not uploaded.'}</p>`}
        </section>`;
      })}
    </div>`.value;

  on(root, 'click', '[data-action=upload]', (_e, el) => openUpload(view, uploadable, (el.dataset.kind as ApplicationDocKind | undefined) ?? uploadable[0]!, refresh));
};

function openUpload(view: ApplicationView, kinds: ApplicationDocKind[], initial: ApplicationDocKind, refresh: () => void) {
  const today = new Date().toISOString().slice(0, 10);
  modal({
    title: 'Upload document',
    body: html`<form class="stack" novalidate>
      ${select({ name: 'kind', label: 'Document type', value: initial, placeholder: 'Select document type', options: kinds.map((k) => [k, DOC_KIND_LABEL[k]] as [string, string]) })}
      ${fileInput({ name: 'file', label: 'File', required: true, accept: '.pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png', prompt: 'Choose a file to upload', hint: 'PDF, JPG or PNG up to 5 MB (logos: PNG or JPG up to 2 MB).' })}
      <div id="cert-fields" ${initial === 'organic_cert' ? '' : 'hidden'}>
        ${field({ name: 'certBody', label: 'Certification body', value: view.data.certBody, required: true, placeholder: 'Enter the certification body' })}
        ${field({ name: 'certNumber', label: 'Certificate number', value: view.data.certNumber, placeholder: 'Enter your certificate number', hint: 'If applicable.' })}
        <div class="row-2">
          ${field({ name: 'certIssueDate', label: 'Issue date', type: 'date', value: view.data.certIssueDate, attrs: `max="${today}"` })}
          ${field({ name: 'certExpiryDate', label: 'Expiry date', type: 'date', value: view.data.certExpiryDate, attrs: `min="${today}"` })}
        </div>
      </div>
      <p class="muted small">Uploaded documents start as unverified. They don’t verify your account or unlock organic labels until an authorised reviewer approves them.</p>
      <p class="form-error" role="alert" hidden></p>
      <div class="modal-actions"><button type="button" class="btn" data-close>Cancel</button><button type="submit" class="btn btn-primary">Upload</button></div>
    </form>`,
    onMount(el, close) {
      const form = el.querySelector('form')!;
      const certFields = el.querySelector('#cert-fields') as HTMLElement;
      el.querySelector('#f_kind')!.addEventListener('change', (e) => (certFields.hidden = (e.target as HTMLSelectElement).value !== 'organic_cert'));
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const f = formValues(form);
        const kind = f.kind as ApplicationDocKind;
        const file = (form.querySelector('#f_file') as HTMLInputElement).files?.[0];
        const errBox = form.querySelector('.form-error') as HTMLElement;
        errBox.hidden = true;
        if (!file) return showFieldErrors(form, { file: 'Choose a file to upload.' });
        const isLogo = kind === 'logo';
        if (!(isLogo ? UPLOAD_LIMITS.logoTypes : UPLOAD_LIMITS.documentTypes).includes(file.type)) return showFieldErrors(form, { file: isLogo ? 'Logos must be PNG or JPG images.' : 'Upload a PDF, JPG or PNG file.' });
        const max = isLogo ? UPLOAD_LIMITS.logoMaxBytes : UPLOAD_LIMITS.maxBytes;
        if (file.size > max) return showFieldErrors(form, { file: `Files must be ${max / 1048576} MB or smaller.` });
        if (kind === 'organic_cert' && (f.certBody ?? '').trim().length < 3) return showFieldErrors(form, { certBody: 'Enter the certification body.' });
        const btn = form.querySelector('[type=submit]') as HTMLButtonElement;
        btn.disabled = true;
        try {
          const cert = kind === 'organic_cert' ? { certBody: f.certBody ?? '', certNumber: f.certNumber ?? '', certIssueDate: f.certIssueDate ?? '', certExpiryDate: f.certExpiryDate ?? '' } : undefined;
          await api.application.uploadDocument(kind, file, cert);
          toast('Uploaded. It stays unverified until a reviewer checks it.');
          close();
          refresh();
        } catch (ex) {
          const ae = ex as api.ApiError;
          errBox.textContent = ae.message;
          errBox.hidden = false;
          if (ae.fieldErrors) showFieldErrors(form, ae.fieldErrors);
          btn.disabled = false;
        }
      });
    },
  });
}

export default page;
