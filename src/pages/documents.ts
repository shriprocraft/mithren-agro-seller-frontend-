// /seller/documents — KYC, business and organic certification documents.

import type { Page } from '../router.js';
import { html, on, formValues } from '../ui/dom.js';
import { pageHeader, field, select, icon, badge, callout, showFieldErrors, mockNote } from '../ui/components.js';
import { toast, modal } from '../ui/overlay.js';
import * as api from '../api.js';
import { fmtDate, validateUpload, UPLOAD_RULES } from '../lib.js';
import type { DocumentType, SellerDocument } from '../types.js';

export const DOC_TYPES: { type: DocumentType; label: string; required: boolean; help: string }[] = [
  { type: 'pan', label: 'PAN card', required: true, help: 'Business or proprietor PAN.' },
  { type: 'gst', label: 'GST registration', required: false, help: 'Only if you are GST-registered.' },
  { type: 'bank_proof', label: 'Bank proof', required: true, help: 'Cancelled cheque or bank statement showing account name and IFSC.' },
  { type: 'address_proof', label: 'Address proof', required: true, help: 'Utility bill or rental agreement for the pickup address.' },
  { type: 'fssai', label: 'FSSAI registration', required: false, help: 'Food business registration, where applicable.' },
  { type: 'organic_cert', label: 'Organic certificate', required: false, help: 'Required only if you label products as organic. Must cover the products and farms you list.' },
];

const today = () => new Date().toISOString().slice(0, 10);

function statusBadge(d: SellerDocument) {
  if (d.status === 'rejected') return badge('Rejected', 'red');
  if (d.status === 'pending') return badge('Awaiting review', 'amber');
  if (d.expiresAt && d.expiresAt < today()) return badge('Expired', 'red');
  return badge('Verified', 'green');
}

const page: Page = async ({ root, seller, refresh }) => {
  const docs = await api.listDocuments();
  const readOnly = seller.status === 'suspended';
  const expiring = docs.filter((d) => d.status === 'approved' && d.expiresAt && (new Date(d.expiresAt).getTime() - Date.now()) / 86_400_000 <= 30);

  root.innerHTML = html`
    ${pageHeader('Documents', 'Verification documents for your seller account and organic claims.', html`${mockNote()}${readOnly ? '' : html`<button type="button" class="btn btn-primary" data-action="upload">${icon('upload', 16)} Upload document</button>`}`)}
    ${seller.status === 'changes_requested' && seller.reviewMessage ? callout('warn', 'Reviewer requested changes', seller.reviewMessage) : ''}
    ${expiring.map((d) => callout(d.expiresAt! < today() ? 'error' : 'warn', d.expiresAt! < today() ? `${d.certNumber ?? d.fileName} has expired` : `${d.certNumber ?? d.fileName} expires on ${fmtDate(d.expiresAt!)}`, 'Upload the renewed certificate. Organic labels are removed from linked listings when it expires.'))}
    <p class="muted small">${icon('shield', 13)} Files are stored privately. Only you and authorised marketplace reviewers can open them. A document shows as verified only after a reviewer approves it.</p>
    <div class="doc-grid">
      ${DOC_TYPES.map((t) => {
        const list = docs.filter((d) => d.type === t.type);
        return html`<section class="card doc-card">
          <div class="card-head">
            <h2 class="card-title">${t.label} ${t.required ? html`<span class="muted small">· required</span>` : ''}</h2>
            ${readOnly ? '' : html`<button type="button" class="btn btn-sm" data-action="upload" data-type="${t.type}">${list.length ? 'Replace / add' : 'Upload'}</button>`}
          </div>
          <p class="muted small">${t.help}</p>
          ${list.length
            ? html`<ul class="doc-list">${list.map(
                (d) => html`<li>
                  <div class="doc-file">${icon('documents', 18)}<div><strong>${d.fileName}</strong><span class="muted small block">${(d.sizeKb / 1024).toFixed(d.sizeKb > 1024 ? 1 : 2)} MB · uploaded ${fmtDate(d.uploadedAt)}</span></div></div>
                  ${statusBadge(d)}
                  ${d.type === 'organic_cert'
                    ? html`<dl class="kv kv-compact">
                        <div><dt>Certifying body</dt><dd>${d.certBody ?? '—'}</dd></div>
                        <div><dt>Certificate no.</dt><dd class="mono">${d.certNumber ?? '—'}</dd></div>
                        <div><dt>Scope</dt><dd>${d.certScope ?? '—'}</dd></div>
                        <div><dt>Expires</dt><dd>${d.expiresAt ? fmtDate(d.expiresAt) : '—'}</dd></div>
                      </dl>`
                    : ''}
                  ${d.reviewerNote ? html`<p class="small error-text">Reviewer: ${d.reviewerNote}</p>` : ''}
                </li>`,
              )}</ul>`
            : html`<p class="muted">${t.required ? 'Not uploaded yet.' : 'Not uploaded.'}</p>`}
        </section>`;
      })}
    </div>`.value;

  on(root, 'click', '[data-action=upload]', (_e, el) => openUpload((el.dataset.type as DocumentType | undefined) ?? 'organic_cert', refresh));
};

function openUpload(initial: DocumentType, refresh: () => void) {
  modal({
    title: 'Upload document',
    body: html`<form class="stack" novalidate>
      ${select({ name: 'type', label: 'Document type', value: initial, options: DOC_TYPES.map((t) => [t.type, t.label] as [string, string]) })}
      <div class="field">
        <label for="f_file">File<span class="req" aria-hidden="true"> *</span></label>
        <input type="file" id="f_file" name="file" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" required aria-describedby="f_file_hint f_file_err" />
        <p class="hint" id="f_file_hint">${UPLOAD_RULES.label}.</p>
        <p class="field-error" id="f_file_err" hidden></p>
      </div>
      <div id="cert-fields" ${initial === 'organic_cert' ? '' : 'hidden'}>
        ${field({ name: 'certBody', label: 'Certifying body', required: true, placeholder: 'Name of the accredited certification body' })}
        ${field({ name: 'certNumber', label: 'Certificate number', required: true })}
        ${field({ name: 'certScope', label: 'Scope', placeholder: 'Farms and product categories covered' })}
        ${field({ name: 'expiresAt', label: 'Expiry date', type: 'date', required: true, attrs: `min="${today()}"` })}
      </div>
      <p class="muted small">After upload the document is reviewed by the marketplace team. It won’t be shown as verified, or unlock organic labels, until approved.</p>
      <p class="form-error" role="alert" hidden></p>
      <div class="modal-actions"><button type="button" class="btn" data-close>Cancel</button><button type="submit" class="btn btn-primary">Upload</button></div>
    </form>`,
    onMount(el, close) {
      const form = el.querySelector('form')!;
      const certFields = el.querySelector('#cert-fields') as HTMLElement;
      el.querySelector('#f_type')!.addEventListener('change', (e) => (certFields.hidden = (e.target as HTMLSelectElement).value !== 'organic_cert'));
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const f = formValues(form);
        const file = (form.querySelector('#f_file') as HTMLInputElement).files?.[0];
        const errBox = form.querySelector('.form-error') as HTMLElement;
        errBox.hidden = true;
        if (!file) return showFieldErrors(form, { file: 'Choose a file to upload.' });
        const fileErr = validateUpload(file);
        if (fileErr) return showFieldErrors(form, { file: fileErr });
        const type = f.type as DocumentType;
        const btn = form.querySelector('[type=submit]') as HTMLButtonElement;
        btn.disabled = true;
        try {
          await api.uploadDocument({
            type,
            fileName: file.name,
            mimeType: file.type,
            sizeKb: Math.max(1, Math.round(file.size / 1024)),
            ...(type === 'organic_cert' ? { certBody: f.certBody ?? '', certNumber: f.certNumber ?? '', certScope: f.certScope ?? '', expiresAt: f.expiresAt ?? '' } : {}),
          });
          toast('Uploaded. It will be reviewed shortly.');
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
