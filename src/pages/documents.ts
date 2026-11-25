// /seller/documents — KYC, business, category (FSSAI, dealer licence) and organic documents.
// Files go to Mithren Agro's private storage, where the Super Admin reviews them; the status shown
// is the Super Admin's decision.

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
  gst: 'GST registration document. Only if you are GST-registered.',
  business_registration: 'Registration document for your firm, LLP, company, FPO or cooperative.',
  address_proof: 'Utility bill, rental agreement or property document for your business address.',
  bank_proof: 'Cancelled cheque or bank statement showing the account name and IFSC.',
  organic_cert: 'Only if you sell organic products. Must cover the farms and products you list.',
  organic_evidence: 'Optional supporting documents: inspection reports, farm photos or supplier documents.',
  fssai: 'Optional. Your own FSSAI licence or registration, if you have one. Products made under Mithren Agro’s FSSAI licence don’t need it.',
  fertilizer_licence: 'Optional. Your fertilizer dealer licence from the state agriculture department, if you have one.',
  logo: 'Optional store logo, PNG or JPG up to 2 MB.',
  additional: 'Anything else a reviewer has asked for.',
};

const ORDER: ApplicationDocKind[] = ['pan', 'gst', 'business_registration', 'address_proof', 'bank_proof', 'fssai', 'fertilizer_licence', 'organic_cert', 'organic_evidence', 'logo', 'additional'];
const CATEGORY_DOCS: ApplicationDocKind[] = ['fssai', 'fertilizer_licence'];
const DAY = 86_400_000;

function serverBadge(d: api.ServerDocumentView) {
  return d.status === 'verified' ? badge('Verified', 'green') : d.status === 'rejected' ? badge('Rejected', 'red') : badge('Waiting for review', 'amber');
}
function localBadge(d: ApplicationDocument) {
  return d.status === 'verified' ? badge('Verified', 'green') : d.status === 'rejected' ? badge('Rejected', 'red') : badge('Unverified', 'neutral');
}
const daysLeft = (iso: string) => Math.ceil((Date.parse(`${iso}T23:59:59`) - Date.now()) / DAY);

const page: Page = async ({ root, refresh }) => {
  const [view, categories] = await Promise.all([api.application.get(), api.sellerCategories.list().catch(() => [] as api.SellerCategoryView[])]);
  const onServer = api.serverDocuments.available();
  const serverDocs = onServer ? await api.serverDocuments.list().catch(() => [] as api.ServerDocumentView[]) : [];
  const serverOf = (k: ApplicationDocKind) => serverDocs.find((d) => d.doc_type === api.SERVER_DOC_TYPE[k]);
  // Category documents the seller's categories need (chosen ones, or any they're locked out of).
  const neededForCategories = new Set(
    categories.filter((c) => c.required_document && (c.chosen || view.data.productTypes.includes(c.name))).map((c) => c.required_document as ApplicationDocKind),
  );
  const required = requiredDocuments(view.data);
  const shown = ORDER.filter((k) => required.includes(k) || neededForCategories.has(k) || view.documents.some((d) => d.kind === k) || !!serverOf(k) || canUpload(view.status, k));
  const uploadable = ORDER.filter((k) => canUpload(view.status, k));
  const certStatus = view.organic.status;
  const expiring = serverDocs.filter((d) => d.expires_on && daysLeft(d.expires_on) <= 30);
  const notSent = onServer ? ORDER.filter((k) => api.SERVER_DOC_TYPE[k] && view.documents.some((d) => d.kind === k) && !serverOf(k)) : [];

  root.innerHTML = html`
    ${pageHeader('Documents', 'Verification documents for your seller account, your categories and organic claims.', uploadable.length ? html`<button type="button" class="btn btn-primary" data-action="upload">${icon('upload', 16)} Upload document</button>` : undefined)}
    ${view.status === 'changes_requested' && (view.reviewerMessage || view.requestedItems.length)
      ? callout('warn', 'A reviewer has asked for changes', html`${view.reviewerMessage ?? ''}${view.requestedItems.length ? html`<ul class="requested">${view.requestedItems.map((i) => html`<li>${i}</li>`)}</ul>` : ''}`, html`<a class="btn btn-sm" href="#/seller/register">Update application</a>`)
      : ''}
    ${view.status === 'pending' ? callout('info', 'Your application is under review', 'Documents are locked while it’s reviewed. You can still add optional documents (such as an FSSAI or fertilizer dealer licence) and additional documents a reviewer asks for.') : ''}
    ${expiring.map((d) => {
      const left = daysLeft(d.expires_on!);
      const name = DOC_KIND_LABEL[(ORDER.find((k) => api.SERVER_DOC_TYPE[k] === d.doc_type) ?? 'additional') as ApplicationDocKind];
      return callout(left < 0 ? 'error' : 'warn', left < 0 ? `${name} has expired` : `${name} expires in ${left} day${left === 1 ? '' : 's'}`, left < 0 ? 'The categories that need it are locked until you upload the renewed document.' : 'Upload the renewed document before then, or the categories that need it will be locked.');
    })}
    ${notSent.length
      ? callout('warn', 'Some documents haven’t reached Mithren Agro', `${notSent.map((k) => DOC_KIND_LABEL[k]).join(', ')} ${notSent.length === 1 ? 'was' : 'were'} saved only in this browser before documents were sent to Mithren Agro. Upload ${notSent.length === 1 ? 'it' : 'them'} again so they can be verified.`)
      : ''}
    ${view.data.claimsOrganic
      ? html`<section class="card cert-card">
          <div class="card-head"><h2 class="card-title">Organic document</h2>${badge(CERTIFICATION_STATUS_LABEL[certStatus], certStatus === 'verified' ? 'green' : certStatus === 'submitted' ? 'amber' : certStatus === 'not_submitted' ? 'neutral' : 'red')}</div>
          <dl class="kv kv-compact">
            <div><dt>Issued by</dt><dd>${view.data.certBody || '—'}</dd></div>
            <div><dt>Document no.</dt><dd class="mono">${view.data.certNumber || '—'}</dd></div>
            <div><dt>Issued</dt><dd>${view.data.certIssueDate ? fmtDate(view.data.certIssueDate) : '—'}</dd></div>
            <div><dt>Expires</dt><dd>${view.data.certExpiryDate ? fmtDate(view.data.certExpiryDate) : '—'}</dd></div>
          </dl>
          <p class="muted small">${certStatus === 'verified' ? 'Verified by an authorised reviewer.' : 'Organic labels stay hidden on your listings until an authorised reviewer verifies this document. Uploading a document doesn’t verify it.'}</p>
          ${view.organic.reviewerNote ? html`<p class="small ${certStatus === 'rejected' ? 'error-text' : ''}">Reviewer: ${view.organic.reviewerNote}</p>` : ''}
        </section>`
      : ''}
    <p class="muted small">${icon('shield', 13)} Files are stored privately. Only you and authorised reviewers can open them. A document shows as verified only after a reviewer approves it.</p>
    <div class="doc-grid">
      ${shown.map((k) => {
        const list = view.documents.filter((d) => d.kind === k);
        const server = serverOf(k);
        const isRequired = required.includes(k);
        const needing = categories.filter((c) => c.required_document === k);
        const mineNeeding = needing.filter((c) => c.chosen || view.data.productTypes.includes(c.name));
        const forCategories = (mineNeeding.length ? mineNeeding : needing).map((c) => c.name);
        return html`<section class="card doc-card">
          <div class="card-head">
            <h2 class="card-title">${DOC_KIND_LABEL[k]} ${isRequired ? html`<span class="muted small">· required</span>` : neededForCategories.has(k) ? html`<span class="muted small">· for ${forCategories.join(', ')}</span>` : ''}</h2>
            ${canUpload(view.status, k) ? html`<button type="button" class="btn btn-sm" data-action="upload" data-kind="${k}">${(list.length || server) && !['additional', 'organic_evidence'].includes(k) ? 'Replace' : 'Upload'}</button>` : ''}
          </div>
          <p class="muted small">${KIND_HELP[k]}</p>
          ${server
            ? html`<ul class="doc-list"><li>
                <div class="doc-file">${icon('documents', 18)}<div><strong><button type="button" class="link-btn" data-open="${server.id}">${server.file_name}</button></strong><span class="muted small block">${fileSize(server.size_bytes)} · uploaded ${fmtDate(server.created_at)}${server.doc_number ? ` · No. ${server.doc_number}` : ''}${server.expires_on ? ` · valid until ${fmtDate(server.expires_on)}` : ''}</span></div></div>
                ${serverBadge(server)}
                ${server.review_note ? html`<p class="small ${server.status === 'rejected' ? 'error-text' : ''}">Mithren Agro: ${server.review_note}</p>` : ''}
              </li></ul>`
            : list.length
              ? html`<ul class="doc-list">${list.map((d) => {
                  const url = api.application.fileUrl(d.id);
                  return html`<li>
                    <div class="doc-file">${icon('documents', 18)}<div><strong>${url ? html`<a href="${url}" target="_blank" rel="noopener">${d.fileName}</a>` : d.fileName}</strong><span class="muted small block">${fileSize(d.sizeBytes)} · uploaded ${fmtDate(d.uploadedAt)}${onServer ? ' · only in this browser' : ''}</span></div></div>
                    ${localBadge(d)}
                    ${d.reviewerNote ? html`<p class="small error-text">Reviewer: ${d.reviewerNote}</p>` : ''}
                  </li>`;
                })}</ul>`
              : html`<p class="muted">${isRequired ? 'Not uploaded yet.' : 'Not uploaded.'}</p>`}
        </section>`;
      })}
    </div>`.value;

  on(root, 'click', '[data-action=upload]', (_e, el) => openUpload(view, uploadable, (el.dataset.kind as ApplicationDocKind | undefined) ?? uploadable[0]!, refresh));
  on(root, 'click', '[data-open]', (_e, el) => {
    api.serverDocuments.open(el.dataset.open!).catch((e: Error) => toast(e.message, 'error'));
  });
};

function openUpload(view: ApplicationView, kinds: ApplicationDocKind[], initial: ApplicationDocKind, refresh: () => void) {
  const today = new Date().toISOString().slice(0, 10);
  modal({
    title: 'Upload document',
    body: html`<form class="stack" novalidate>
      ${select({ name: 'kind', label: 'Document type', value: initial, placeholder: 'Select document type', options: kinds.map((k) => [k, DOC_KIND_LABEL[k]] as [string, string]) })}
      ${fileInput({ name: 'file', label: 'File', required: true, accept: '.pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png', prompt: 'Choose a file to upload', hint: 'PDF, JPG or PNG up to 5 MB (logos: PNG or JPG up to 2 MB).' })}
      <div id="licence-fields" ${CATEGORY_DOCS.includes(initial) ? '' : 'hidden'}>
        <div class="row-2">
          ${field({ name: 'docNumber', label: 'Document number', placeholder: 'Enter the number on the document', hint: 'FSSAI numbers have 14 digits.', attrs: 'maxlength="60"' })}
          ${field({ name: 'expiresOn', label: 'Valid until', type: 'date', required: true, attrs: `min="${today}"` })}
        </div>
      </div>
      <div id="cert-fields" ${initial === 'organic_cert' ? '' : 'hidden'}>
        ${field({ name: 'certBody', label: 'Issuing organisation', value: view.data.certBody, required: true, placeholder: 'Enter who issued it' })}
        ${field({ name: 'certNumber', label: 'Document number', value: view.data.certNumber, placeholder: 'Enter the document number', hint: 'If applicable.' })}
        <div class="row-2">
          ${field({ name: 'certIssueDate', label: 'Issue date', type: 'date', value: view.data.certIssueDate, attrs: `max="${today}"` })}
          ${field({ name: 'certExpiryDate', label: 'Expiry date', type: 'date', value: view.data.certExpiryDate, attrs: `min="${today}"` })}
        </div>
      </div>
      <p class="muted small">Uploaded documents start as unverified. They don’t verify your account, open a category or unlock organic labels until Mithren Agro approves them.</p>
      <p class="form-error" role="alert" hidden></p>
      <div class="modal-actions"><button type="button" class="btn" data-close>Cancel</button><button type="submit" class="btn btn-primary">Upload</button></div>
    </form>`,
    onMount(el, close) {
      const form = el.querySelector('form')!;
      const certFields = el.querySelector('#cert-fields') as HTMLElement;
      const licenceFields = el.querySelector('#licence-fields') as HTMLElement;
      el.querySelector('#f_kind')!.addEventListener('change', (e) => {
        const k = (e.target as HTMLSelectElement).value as ApplicationDocKind;
        certFields.hidden = k !== 'organic_cert';
        licenceFields.hidden = !CATEGORY_DOCS.includes(k);
      });
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
        if (kind === 'organic_cert' && (f.certBody ?? '').trim().length < 3) return showFieldErrors(form, { certBody: 'Enter who issued the document.' });
        const docNumber = (f.docNumber ?? '').replace(/\s/g, '');
        if (CATEGORY_DOCS.includes(kind)) {
          if (kind === 'fssai' && !/^\d{14}$/.test(docNumber)) return showFieldErrors(form, { docNumber: 'The FSSAI number has 14 digits.' });
          if (!f.expiresOn) return showFieldErrors(form, { expiresOn: 'Enter the date it is valid until.' });
        }
        const btn = form.querySelector('[type=submit]') as HTMLButtonElement;
        btn.disabled = true;
        try {
          const cert: Record<string, string> | undefined =
            kind === 'organic_cert'
              ? { certBody: f.certBody ?? '', certNumber: f.certNumber ?? '', certIssueDate: f.certIssueDate ?? '', certExpiryDate: f.certExpiryDate ?? '' }
              : CATEGORY_DOCS.includes(kind)
                ? { docNumber, expiresOn: f.expiresOn ?? '' }
                : undefined;
          await api.application.uploadDocument(kind, file, cert);
          toast('Uploaded. It stays unverified until Mithren Agro checks it.');
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
