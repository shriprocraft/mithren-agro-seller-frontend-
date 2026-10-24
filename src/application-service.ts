// Seller application workflow: drafts, bank details, documents, submission and
// the Super Admin review decisions. One implementation, two storage backends:
// SQLite on the Node server and browser storage for the static preview.
//
// Every method takes the *authenticated* account from the caller's session.
// Nothing here trusts a client-supplied seller ID, status, certification
// status or reviewer identity.

import { ApiError } from './errors.js';
import { _internal } from './api-core.js';
import {
  type AccountView,
  type AdminAction,
  type ApplicationDocKind,
  type ApplicationRecord,
  type ApplicationView,
  type BankInput,
  type BankView,
  type DocumentRecord,
  type OrganicRecord,
  DOC_KIND_LABEL,
  UPLOAD_LIMITS,
  adminTransition,
  assertCanEdit,
  buildView,
  canUpload,
  emptyApplicationData,
  normaliseApplicationData,
  RE,
  toWorkspaceDocuments,
  toWorkspaceSeller,
  validateApplication,
  validateBank,
  validateStep,
} from './application.js';

export interface AccountInfo {
  userId: string;
  sellerId: string;
  fullName: string;
  email: string;
  phone: string;
  emailVerified: boolean;
  phoneVerified: boolean;
}

export interface AuditEntry {
  actorType: 'seller' | 'admin' | 'system';
  actorId: string;
  action: string;
  applicationId: string;
  details?: Record<string, unknown>;
}

export interface ApplicationStore {
  transaction<T>(fn: () => T): T;
  getApplicationByUser(userId: string): ApplicationRecord | null;
  getApplicationById(id: string): ApplicationRecord | null;
  insertApplication(rec: ApplicationRecord): void;
  updateApplication(rec: ApplicationRecord): void;
  /** Atomically claims the submission idempotency key; returns the existing key if one is set. */
  getSubmitKey(appId: string): string | null;
  setSubmitKey(appId: string, key: string): void;
  listDocuments(appId: string): DocumentRecord[];
  getDocument(id: string): DocumentRecord | null;
  insertDocument(doc: DocumentRecord): void;
  updateDocument(doc: DocumentRecord): void;
  getBank(appId: string): BankView | null;
  /** The store is responsible for protecting the full account number (e.g. encryption at rest). */
  saveBank(appId: string, view: BankView, fullAccountNumber: string): void;
  getOrganic(appId: string): OrganicRecord | null;
  saveOrganic(appId: string, rec: OrganicRecord): void;
  nextReferenceId(): string;
  getAccount(userId: string): AccountInfo | null;
  audit(entry: AuditEntry): void;
  newId(prefix: string): string;
}

export interface UploadMeta {
  kind: ApplicationDocKind;
  fileName: string;
  sizeBytes: number;
  /** MIME type detected from the file's bytes, not the client's claim. */
  sniffedMime: string | null;
  cert?: { certBody?: string; certNumber?: string; certIssueDate?: string; certExpiryDate?: string };
}

const now = () => new Date().toISOString();
const SUPPORT_EMAIL = 'seller-support@mithrenagro.example';

export class ApplicationService {
  constructor(private store: ApplicationStore) {}

  /** Create the application record for a newly registered account. */
  createForAccount(acc: AccountInfo): ApplicationRecord {
    const t = now();
    const rec: ApplicationRecord = {
      id: this.store.newId('app'),
      userId: acc.userId,
      sellerId: acc.sellerId,
      referenceId: null,
      status: 'incomplete',
      currentStep: 2,
      data: { ...emptyApplicationData(), ownerName: acc.fullName, businessEmail: acc.email, primaryPhone: acc.phone },
      createdAt: t,
      submittedAt: null,
      lastSubmittedAt: null,
      updatedAt: t,
      reviewerMessage: null,
      requestedItems: [],
      reviewedAt: null,
      previousStatus: null,
    };
    this.store.insertApplication(rec);
    this.store.audit({ actorType: 'seller', actorId: acc.userId, action: 'application.created', applicationId: rec.id });
    this.syncWorkspace(rec);
    return rec;
  }

  private mine(acc: AccountInfo) {
    const app = this.store.getApplicationByUser(acc.userId);
    if (!app) throw new ApiError(404, 'No seller application found for this account.');
    return app;
  }

  private ctx(app: ApplicationRecord, acc: AccountInfo) {
    return {
      documentKinds: this.store.listDocuments(app.id).filter((d) => !d.supersededAt && d.status !== 'rejected').map((d) => d.kind),
      bankProvided: !!this.store.getBank(app.id),
      emailVerified: acc.emailVerified,
      phoneVerified: acc.phoneVerified,
    };
  }

  view(acc: AccountInfo): ApplicationView {
    const app = this.mine(acc);
    return buildView(app, this.store.listDocuments(app.id), this.store.getBank(app.id), this.store.getOrganic(app.id));
  }

  /**
   * Save the draft. `validateStepNo` is the step being left with "Next": its
   * rules must pass before progress is recorded. "Save draft" skips validation.
   */
  saveDraft(acc: AccountInfo, input: unknown, nextStep: number, validateStepNo: number | null): ApplicationView {
    return this.store.transaction(() => {
      const app = this.mine(acc);
      assertCanEdit(app);
      const data = normaliseApplicationData(input);
      if (validateStepNo !== null) {
        const errors = validateStep(validateStepNo, data, this.ctx(app, acc));
        if (Object.keys(errors).length) throw new ApiError(422, 'Please fix the highlighted fields.', errors);
      }
      app.data = data;
      // Progress is the furthest step reached; going back to edit doesn't lose it.
      app.currentStep = Math.max(app.currentStep, Math.min(8, Math.max(1, Math.trunc(nextStep) || app.currentStep)));
      app.updatedAt = now();
      this.store.updateApplication(app);
      if (data.claimsOrganic === false) {
        const org = this.store.getOrganic(app.id);
        if (org && org.status !== 'not_submitted') this.store.saveOrganic(app.id, { ...org, status: 'not_submitted' });
      }
      this.syncWorkspace(app);
      return this.view(acc);
    });
  }

  saveBank(acc: AccountInfo, input: BankInput): ApplicationView {
    return this.store.transaction(() => {
      const app = this.mine(acc);
      assertCanEdit(app);
      const errors = validateBank(input);
      if (Object.keys(errors).length) throw new ApiError(422, 'Please fix the highlighted fields.', errors);
      const account = String(input.accountNumber).replace(/\s/g, '');
      const view: BankView = {
        holderName: input.holderName.trim().slice(0, 100),
        last4: account.slice(-4),
        ifsc: input.ifsc.trim().toUpperCase(),
        bankName: String(input.bankName ?? '').trim().slice(0, 80),
        updatedAt: now(),
      };
      this.store.saveBank(app.id, view, account);
      this.store.audit({ actorType: 'seller', actorId: acc.userId, action: 'bank.updated', applicationId: app.id, details: { last4: view.last4, ifsc: view.ifsc } });
      app.updatedAt = now();
      this.store.updateApplication(app);
      this.syncWorkspace(app);
      return this.view(acc);
    });
  }

  /** Validate an upload before any bytes are stored. Returns the document ID to use as the storage key. */
  checkUpload(acc: AccountInfo, meta: UploadMeta) {
    const app = this.mine(acc);
    if (!(meta.kind in DOC_KIND_LABEL)) throw new ApiError(422, 'Unknown document type.');
    if (!canUpload(app.status, meta.kind)) throw new ApiError(409, `You can’t upload a ${DOC_KIND_LABEL[meta.kind].toLowerCase()} while your application is ${app.status.replace('_', ' ')}.`);
    const isLogo = meta.kind === 'logo';
    const types = isLogo ? UPLOAD_LIMITS.logoTypes : UPLOAD_LIMITS.documentTypes;
    const max = isLogo ? UPLOAD_LIMITS.logoMaxBytes : UPLOAD_LIMITS.maxBytes;
    if (meta.sizeBytes <= 0) throw new ApiError(422, 'The file is empty.', { file: 'The file is empty.' });
    if (meta.sizeBytes > max) throw new ApiError(413, `Files must be ${max / 1048576} MB or smaller.`, { file: `Files must be ${max / 1048576} MB or smaller.` });
    if (!meta.sniffedMime || !types.includes(meta.sniffedMime))
      throw new ApiError(415, isLogo ? 'Logos must be PNG or JPG images.' : 'Upload a PDF, JPG or PNG file.', { file: isLogo ? 'Logos must be PNG or JPG images.' : 'Upload a PDF, JPG or PNG file.' });
    return { app, documentId: this.store.newId('doc') };
  }

  /** Record a document after its bytes have been stored under `documentId`. */
  recordUpload(acc: AccountInfo, meta: UploadMeta, documentId: string): ApplicationView {
    return this.store.transaction(() => {
      const app = this.mine(acc);
      if (!canUpload(app.status, meta.kind)) throw new ApiError(409, 'Uploads aren’t allowed in the current application status.');
      const t = now();
      // One current document per kind; additional and evidence files accumulate.
      if (!['additional', 'organic_evidence'].includes(meta.kind)) {
        for (const d of this.store.listDocuments(app.id)) if (d.kind === meta.kind && !d.supersededAt) this.store.updateDocument({ ...d, supersededAt: t });
      }
      const doc: DocumentRecord = {
        id: documentId,
        applicationId: app.id,
        kind: meta.kind,
        fileName: meta.fileName.replace(/[\\/\0<>:"|?*]/g, '_').slice(0, 120) || 'document',
        mimeType: meta.sniffedMime!,
        sizeBytes: meta.sizeBytes,
        uploadedAt: t,
        status: 'unverified', // uploading never verifies anything
        supersededAt: null,
      };
      this.store.insertDocument(doc);
      if (meta.kind === 'organic_cert') {
        // Uploading a certificate is an organic claim, even if the yes/no answer wasn't saved yet.
        app.data = { ...app.data, claimsOrganic: true };
        if (meta.cert) {
          const c = normaliseApplicationData({ ...app.data, ...meta.cert, claimsOrganic: true });
          const errors = validateStep(7, c, { ...this.ctx(app, acc), documentKinds: ['organic_cert'] });
          delete errors.doc_organic_cert;
          if (Object.keys(errors).length) throw new ApiError(422, 'Please fix the certificate details.', errors);
          app.data = { ...app.data, claimsOrganic: true, certBody: c.certBody, certNumber: c.certNumber, certIssueDate: c.certIssueDate, certExpiryDate: c.certExpiryDate };
        }
        this.store.saveOrganic(app.id, { status: 'submitted', documentId: doc.id, reviewerNote: null, reviewedAt: null });
      }
      app.updatedAt = t;
      this.store.updateApplication(app);
      this.store.audit({ actorType: 'seller', actorId: acc.userId, action: 'document.uploaded', applicationId: app.id, details: { documentId: doc.id, kind: doc.kind, sizeBytes: doc.sizeBytes } });
      this.syncWorkspace(app);
      return this.view(acc);
    });
  }

  submit(acc: AccountInfo, idempotencyKey: string): ApplicationView {
    if (!/^[A-Za-z0-9-]{8,64}$/.test(idempotencyKey)) throw new ApiError(422, 'Invalid submission key.');
    return this.store.transaction(() => {
      const app = this.mine(acc);
      // A retried request with the same key returns the original result.
      if (app.status === 'pending' && this.store.getSubmitKey(app.id) === idempotencyKey) return this.view(acc);
      if (app.status === 'pending') throw new ApiError(409, 'Your application has already been submitted and is awaiting review.');
      if (app.status !== 'incomplete' && app.status !== 'changes_requested') throw new ApiError(409, 'This application can’t be submitted in its current status.');
      const failed = validateApplication(app.data, this.ctx(app, acc));
      if (failed) throw new ApiError(422, `Step ${failed.step} needs attention before you can submit.`, { ...failed.errors, _step: String(failed.step) });
      const t = now();
      app.referenceId ??= this.store.nextReferenceId();
      app.submittedAt ??= t;
      app.lastSubmittedAt = t;
      app.status = 'pending';
      app.currentStep = 8;
      app.requestedItems = [];
      app.updatedAt = t;
      this.store.updateApplication(app);
      this.store.setSubmitKey(app.id, idempotencyKey);
      this.store.audit({ actorType: 'seller', actorId: acc.userId, action: 'application.submitted', applicationId: app.id, details: { referenceId: app.referenceId } });
      _internal.notify(app.sellerId, { topic: 'moderation', title: 'Application submitted', body: `Reference ${app.referenceId}. You’ll be notified when the review is complete.`, link: '/seller' });
      this.syncWorkspace(app);
      return this.view(acc);
    });
  }

  // ---------- Super Admin side (called only by the authenticated admin API) ----------

  adminDecide(applicationId: string, action: AdminAction, reviewer: string, message: string, requestedItems: string[]): ApplicationRecord {
    return this.store.transaction(() => {
      const app = this.store.getApplicationById(applicationId);
      if (!app) throw new ApiError(404, 'Application not found.');
      if (!['approve', 'reject', 'request_changes', 'suspend', 'reinstate'].includes(action)) throw new ApiError(422, 'Unknown review action.');
      const msg = String(message ?? '').trim().slice(0, 2000);
      if (['reject', 'request_changes', 'suspend'].includes(action) && msg.length < 5) throw new ApiError(422, 'A message to the seller is required for this decision.', { message: 'Required.' });
      const next = adminTransition(app, action);
      const t = now();
      if (action === 'suspend') app.previousStatus = app.status;
      if (action === 'reinstate') app.previousStatus = null;
      app.status = next;
      app.reviewerMessage = msg || null;
      app.requestedItems = action === 'request_changes' ? (Array.isArray(requestedItems) ? requestedItems.map((x) => String(x).trim().slice(0, 200)).filter(Boolean).slice(0, 20) : []) : [];
      app.reviewedAt = t;
      app.updatedAt = t;
      this.store.updateApplication(app);
      this.store.audit({ actorType: 'admin', actorId: reviewer, action: `application.${action}`, applicationId: app.id, details: { from: action === 'suspend' ? app.previousStatus : undefined, to: next } });
      const titles: Record<AdminAction, string> = {
        approve: 'Your seller application was approved',
        reject: 'Your seller application was rejected',
        request_changes: 'Changes requested on your application',
        suspend: 'Your seller account was suspended',
        reinstate: 'Your seller account was reinstated',
      };
      _internal.notify(app.sellerId, { topic: 'moderation', title: titles[action], body: msg || 'See your application status for details.', link: '/seller' });
      this.syncWorkspace(app);
      return app;
    });
  }

  adminReviewDocument(documentId: string, decision: 'verified' | 'rejected', reviewer: string, note: string): DocumentRecord {
    return this.store.transaction(() => {
      const doc = this.store.getDocument(documentId);
      if (!doc) throw new ApiError(404, 'Document not found.');
      if (decision !== 'verified' && decision !== 'rejected') throw new ApiError(422, 'Decision must be verified or rejected.');
      if (decision === 'rejected' && String(note ?? '').trim().length < 5) throw new ApiError(422, 'Explain why the document was rejected.', { note: 'Required.' });
      const t = now();
      const updated: DocumentRecord = { ...doc, status: decision, ...(note ? { reviewerNote: String(note).slice(0, 1000) } : {}) };
      this.store.updateDocument(updated);
      const app = this.store.getApplicationById(doc.applicationId)!;
      if (doc.kind === 'organic_cert') {
        const org = this.store.getOrganic(app.id);
        if (org?.documentId === doc.id) this.store.saveOrganic(app.id, { ...org, status: decision, reviewerNote: note || null, reviewedAt: t });
      }
      this.store.audit({ actorType: 'admin', actorId: reviewer, action: `document.${decision}`, applicationId: app.id, details: { documentId, kind: doc.kind } });
      if (decision === 'rejected' || doc.kind === 'organic_cert') {
        _internal.notify(app.sellerId, { topic: 'moderation', title: `${DOC_KIND_LABEL[doc.kind]} ${decision}`, body: note || '', link: '/seller/documents' });
      }
      this.syncWorkspace(app);
      return updated;
    });
  }

  /** Keep the business workspace (status, profile, documents) in step with the application. */
  syncWorkspace(app: ApplicationRecord) {
    const acc = this.store.getAccount(app.userId);
    if (!acc) return;
    const bank = this.store.getBank(app.id);
    _internal.upsertSeller(toWorkspaceSeller(_internal.findSeller(app.sellerId), app, acc, bank, SUPPORT_EMAIL));
    _internal.replaceSellerDocuments(app.sellerId, toWorkspaceDocuments(app, this.store.listDocuments(app.id), this.store.getOrganic(app.id)));
  }
}

export function toAccountView(a: AccountInfo): AccountView {
  return {
    userId: a.userId,
    sellerId: a.sellerId,
    fullName: a.fullName,
    email: a.email,
    phoneMasked: a.phone.length >= 4 ? `${a.phone.slice(0, 3)} •••••• ${a.phone.slice(-4)}` : '••••',
    emailVerified: a.emailVerified,
    phoneVerified: a.phoneVerified,
  };
}

export function validateSignUp(input: { fullName?: unknown; email?: unknown; phone?: unknown; password?: unknown }) {
  const e: Record<string, string> = {};
  const fullName = String(input.fullName ?? '').trim().slice(0, 80);
  const email = String(input.email ?? '').trim().toLowerCase().slice(0, 120);
  const phoneRaw = String(input.phone ?? '').replace(/[^\d+]/g, '');
  const m = /^(?:\+?91)?([6-9]\d{9})$/.exec(phoneRaw);
  const phone = m ? `+91${m[1]}` : '';
  const password = String(input.password ?? '');
  if (fullName.length < 2) e.fullName = 'Enter your full name.';
  if (!RE.email.test(email)) e.email = 'Enter a valid email address.';
  if (!phone) e.phone = 'Enter a 10-digit Indian mobile number.';
  if (password.length < 10) e.password = 'Use at least 10 characters.';
  else if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) e.password = 'Use both letters and numbers.';
  else if (password.length > 200) e.password = 'Password is too long.';
  return { errors: e, fullName, email, phone, password };
}
