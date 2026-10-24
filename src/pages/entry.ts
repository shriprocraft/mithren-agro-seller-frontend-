// /seller — the signed-in seller's application status, exactly as the backend
// reports it. Approved sellers continue to the dashboard.

import type { Page } from '../router.js';
import { navigate } from '../router.js';
import { html, type Raw } from '../ui/dom.js';
import { icon, callout, pageHeader, badge } from '../ui/components.js';
import * as api from '../api.js';
import { fmtDate } from '../lib.js';
import {
  APPLICATION_STATUS_LABEL,
  CERTIFICATION_STATUS_LABEL,
  DOC_KIND_LABEL,
  STEPS,
  requiredDocuments,
  type ApplicationStatus,
  type ApplicationView,
} from '../application.js';

const MESSAGES: Record<ApplicationStatus, { tone: 'info' | 'warn' | 'error' | 'success'; title: string; body: string }> = {
  incomplete: { tone: 'info', title: 'Finish your application', body: 'Your seller application isn’t complete yet. Continue where you left off and submit it for review.' },
  pending: { tone: 'info', title: 'Awaiting review', body: 'Your seller application has been submitted and is awaiting review. You will be able to list products for public sale after your account has been approved.' },
  changes_requested: { tone: 'warn', title: 'Changes requested', body: 'Additional information is required to continue reviewing your application. Please review the requested changes and update your application.' },
  approved: { tone: 'success', title: 'Approved', body: 'Your seller application has been approved. You can now access the seller features available to your account.' },
  rejected: { tone: 'error', title: 'Application rejected', body: 'Your seller application has been rejected. Please review the available feedback and any permitted next steps.' },
  suspended: { tone: 'error', title: 'Account suspended', body: 'Your seller account is currently suspended. Please review the available account message or contact the appropriate support channel.' },
};

const TONE: Record<ApplicationStatus, 'neutral' | 'amber' | 'green' | 'red'> = {
  incomplete: 'neutral',
  pending: 'amber',
  changes_requested: 'amber',
  approved: 'green',
  rejected: 'red',
  suspended: 'red',
};

const page: Page = async ({ root, seller, query }) => {
  const view = await api.application.get();
  // Approved sellers land on the dashboard; the account menu links here with ?view=status.
  if (view.status === 'approved' && query.get('view') !== 'status') return navigate('/seller/dashboard', true);
  const m = MESSAGES[view.status];
  const missing = missingDocuments(view);

  root.innerHTML = html`
    ${pageHeader('Seller application', view.data.shopName || 'Your seller account', badge(APPLICATION_STATUS_LABEL[view.status], TONE[view.status]))}
    ${callout(m.tone, m.title, m.body, nextAction(view, seller.supportEmail))}

    <div class="grid-main">
      <section class="card" aria-labelledby="app-details">
        <h2 id="app-details" class="card-title">Application details</h2>
        <dl class="kv kv-inline">
          <div><dt>Reference ID</dt><dd class="mono">${view.referenceId ?? 'Assigned when you submit'}</dd></div>
          <div><dt>Shop name</dt><dd>${view.data.shopName || '—'}</dd></div>
          <div><dt>Status</dt><dd>${badge(APPLICATION_STATUS_LABEL[view.status], TONE[view.status])}</dd></div>
          <div><dt>Submitted</dt><dd>${view.submittedAt ? fmtDate(view.submittedAt, true) : 'Not yet submitted'}</dd></div>
          ${view.lastSubmittedAt && view.lastSubmittedAt !== view.submittedAt ? html`<div><dt>Resubmitted</dt><dd>${fmtDate(view.lastSubmittedAt, true)}</dd></div>` : ''}
          ${view.reviewedAt ? html`<div><dt>Last reviewed</dt><dd>${fmtDate(view.reviewedAt, true)}</dd></div>` : ''}
          <div><dt>Last updated</dt><dd>${fmtDate(view.updatedAt, true)}</dd></div>
          ${view.status === 'incomplete' ? html`<div><dt>Progress</dt><dd>Step ${view.currentStep} of ${STEPS.length}: ${STEPS[view.currentStep - 1]?.label ?? ''}</dd></div>` : ''}
        </dl>
      </section>

      <section class="card" aria-labelledby="org-h">
        <h2 id="org-h" class="card-title">Organic certification</h2>
        ${organicSummary(view)}
      </section>
    </div>

    ${view.reviewerMessage
      ? html`<section class="card" aria-labelledby="rev-h">
          <h2 id="rev-h" class="card-title">Message from the review team</h2>
          <p class="reviewer-message">${view.reviewerMessage}</p>
          ${view.requestedItems.length
            ? html`<h3 class="sub-title">Required corrections</h3><ul class="checklist requested">${view.requestedItems.map((i) => html`<li>${icon('alert', 14)} ${i}</li>`)}</ul>`
            : ''}
          ${view.reviewedAt ? html`<p class="muted small">Sent ${fmtDate(view.reviewedAt, true)}</p>` : ''}
        </section>`
      : ''}

    <section class="card" aria-labelledby="docs-h">
      <div class="card-head"><h2 id="docs-h" class="card-title">Documents</h2><a class="link" href="#/seller/documents">Manage documents</a></div>
      ${missing.length && (view.status === 'incomplete' || view.status === 'changes_requested')
        ? callout('warn', 'Missing documents', html`<ul class="checklist">${missing.map((k) => html`<li>${DOC_KIND_LABEL[k]}</li>`)}</ul>`)
        : ''}
      ${view.documents.length
        ? html`<ul class="doc-mini">${view.documents.filter((d) => d.kind !== 'logo').map(
            (d) => html`<li><span>${DOC_KIND_LABEL[d.kind]} <span class="muted small">· ${d.fileName}</span></span>${d.status === 'verified' ? badge('Verified', 'green') : d.status === 'rejected' ? badge('Rejected', 'red') : badge('Unverified', 'neutral')}</li>`,
          )}</ul>`
        : html`<p class="muted">No documents uploaded yet.</p>`}
    </section>`.value;
};

function missingDocuments(v: ApplicationView) {
  const have = new Set(v.documents.filter((d) => d.status !== 'rejected').map((d) => d.kind));
  return requiredDocuments(v.data).filter((k) => !have.has(k));
}

function nextAction(v: ApplicationView, supportEmail: string): Raw {
  switch (v.status) {
    case 'incomplete':
      return html`<a class="btn btn-primary btn-sm" href="#/seller/register">Continue application</a>`;
    case 'changes_requested':
      return html`<a class="btn btn-primary btn-sm" href="#/seller/register">Update application</a>`;
    case 'pending':
      return html`<a class="btn btn-sm" href="#/seller/documents">Upload additional documents</a>`;
    case 'approved':
      return html`<a class="btn btn-primary btn-sm" href="#/seller/dashboard">Go to dashboard</a>`;
    default:
      return html`<span class="support-contact small">Seller support: <span class="mono">${supportEmail}</span></span>`;
  }
}

function organicSummary(v: ApplicationView): Raw {
  if (!v.data.claimsOrganic) return html`<p class="muted">No organic claim made. Products are sold without an organic label.</p>`;
  const s = v.organic.status;
  return html`
    <p>${badge(CERTIFICATION_STATUS_LABEL[s], s === 'verified' ? 'green' : s === 'submitted' ? 'amber' : s === 'not_submitted' ? 'neutral' : 'red')}</p>
    <dl class="kv kv-compact">
      <div><dt>Issued by</dt><dd>${v.data.certBody || '—'}</dd></div>
      ${v.data.certNumber ? html`<div><dt>Certificate no.</dt><dd class="mono">${v.data.certNumber}</dd></div>` : ''}
      ${v.data.certExpiryDate ? html`<div><dt>Expires</dt><dd>${fmtDate(v.data.certExpiryDate)}</dd></div>` : ''}
    </dl>
    <p class="muted small">${s === 'verified' ? 'Verified by an authorised reviewer. Organic labels can appear on your approved listings.' : 'Organic labels stay hidden on your listings until a reviewer verifies your certificate.'}</p>
    ${v.organic.reviewerNote ? html`<p class="small ${s === 'rejected' ? 'error-text' : ''}">Reviewer: ${v.organic.reviewerNote}</p>` : ''}`;
}

export default page;
