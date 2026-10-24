// /seller — portal entry. Approved sellers go to the dashboard; everyone else
// sees their application status and any reviewer message.

import type { Page } from '../router.js';
import { navigate } from '../router.js';
import { html, raw } from '../ui/dom.js';
import { icon, sellerBadge, callout, pageHeader } from '../ui/components.js';
import * as api from '../api.js';
import { fmtDate } from '../lib.js';
import type { SellerStatus } from '../types.js';

const STEPS: { key: SellerStatus[]; label: string; body: string }[] = [
  { key: ['submitted'], label: 'Application submitted', body: 'We’ve received your shop details and documents.' },
  { key: ['under_review', 'changes_requested'], label: 'Under review', body: 'Our team verifies your KYC, bank and any organic certificates.' },
  { key: ['approved', 'rejected'], label: 'Decision', body: 'Once approved, your listings can go live after moderation.' },
];

const page: Page = async ({ root, seller }) => {
  if (seller.status === 'approved') return navigate('/seller/dashboard', true);
  const docs = await api.listDocuments();
  const idx = (s: SellerStatus) => (s === 'submitted' ? 0 : s === 'under_review' || s === 'changes_requested' ? 1 : 2);
  const current = idx(seller.status);

  const tone = seller.status === 'rejected' || seller.status === 'suspended' ? 'error' : seller.status === 'changes_requested' ? 'warn' : 'info';
  const headline: Record<string, string> = {
    submitted: 'Thanks — your application is in the queue',
    under_review: 'Your application is being reviewed',
    changes_requested: 'A reviewer has asked for changes',
    rejected: 'Your application was not approved',
    suspended: 'Your seller account is suspended',
  };

  root.innerHTML = html`
    ${pageHeader('Seller application', `${seller.shopName} · applied ${fmtDate(seller.joinedAt)}`, sellerBadge(seller.status))}
    ${callout(tone, headline[seller.status] ?? 'Application status', seller.reviewMessage ?? 'We’ll notify you by email and in the portal when the status changes. Reviews usually take up to 2 business days.')}
    ${seller.status !== 'suspended'
      ? html`<section class="card">
          <h2 class="card-title">Progress</h2>
          <ol class="steps">
            ${STEPS.map((st, i) => {
              const state = i < current ? 'done' : i === current ? (seller.status === 'rejected' ? 'failed' : 'current') : 'todo';
              return html`<li class="step step-${state}" ${state === 'current' ? raw('aria-current="step"') : ''}>
                <span class="step-dot" aria-hidden="true">${state === 'done' ? icon('check', 14) : i + 1}</span>
                <div><strong>${st.label}</strong><p class="muted">${st.body}</p></div>
              </li>`;
            })}
          </ol>
        </section>`
      : ''}
    <div class="grid-2">
      <section class="card">
        <h2 class="card-title">Documents</h2>
        <ul class="doc-mini">
          ${docs.map((d) => html`<li><span>${d.fileName}</span>${d.status === 'approved' ? html`<span class="badge badge-green">Verified</span>` : d.status === 'rejected' ? html`<span class="badge badge-red">Rejected</span>` : html`<span class="badge badge-amber">Awaiting review</span>`}</li>`)}
        </ul>
        <a class="btn btn-sm" href="#/seller/documents">${seller.status === 'changes_requested' ? 'Upload requested documents' : 'Manage documents'}</a>
      </section>
      <section class="card">
        <h2 class="card-title">While you wait</h2>
        <ul class="checklist">
          <li><a href="#/seller/products/new">Prepare draft product listings</a><span class="muted"> — they’ll be ready to submit once you’re approved.</span></li>
          <li><a href="#/seller/store-settings">Set working hours and service areas</a></li>
          <li><a href="mailto:${seller.supportEmail}">Contact seller support</a></li>
        </ul>
      </section>
    </div>`.value;
};

export default page;
