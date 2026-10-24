// Browser stand-in for the Node backend, used only by the static preview
// (where no server can run). It reuses ApplicationService so the workflow and
// its rules match the server exactly; what it can't do is real security:
// data lives in this browser, uploaded files aren't kept (only their details),
// verification codes are shown on screen, and the full bank account number is
// discarded after validation.

import { ApiError } from './errors.js';
import { _internal } from './api-core.js';
import { SELLER_A } from './data/seed.js';
import { ApplicationService, toAccountView, validateSignUp, type AccountInfo, type ApplicationStore, type AuditEntry } from './application-service.js';
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
  emptyApplicationData,
  sniffMime,
} from './application.js';

const KEY = 'mithren-seller-accounts';

interface LocalUser {
  id: string;
  sellerId: string;
  fullName: string;
  email: string;
  phone: string;
  salt: string;
  passwordHash: string;
  emailVerifiedAt: string | null;
  phoneVerifiedAt: string | null;
  createdAt: string;
}

interface LocalState {
  v: 1;
  users: LocalUser[];
  sessionUserId: string | null;
  apps: ApplicationRecord[];
  docs: DocumentRecord[];
  banks: Record<string, BankView>;
  organic: Record<string, OrganicRecord>;
  submitKeys: Record<string, string>;
  seq: number;
  codes: Record<string, { code: string; expires: number; attempts: number }>;
  audit: (AuditEntry & { at: string })[];
}

export const DEMO_EMAIL = 'ananya@greenvalley.example';
export const DEMO_PASSWORD = 'preview-demo-2026';

const rid = (p: string) => `${p}_${Array.from(crypto.getRandomValues(new Uint8Array(9)), (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 14)}`;

async function hash(password: string, salt: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${salt}:${password}`));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}

let state: LocalState = load();

function load(): LocalState {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(KEY) : null;
    if (raw) {
      const s = JSON.parse(raw) as LocalState;
      if (s.v === 1) return s;
    }
  } catch {
    /* unavailable or corrupt: start again */
  }
  return { v: 1, users: [], sessionUserId: null, apps: [], docs: [], banks: {}, organic: {}, submitKeys: {}, seq: 0, codes: {}, audit: [] };
}

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* storage blocked: keep working in memory */
  }
  _internal.persist();
}

const accountOf = (u: LocalUser): AccountInfo => ({
  userId: u.id,
  sellerId: u.sellerId,
  fullName: u.fullName,
  email: u.email,
  phone: u.phone,
  emailVerified: !!u.emailVerifiedAt,
  phoneVerified: !!u.phoneVerifiedAt,
});

const store: ApplicationStore = {
  transaction<T>(fn: () => T): T {
    const snapshot = JSON.stringify(state);
    const ws = JSON.stringify(_internal.getDb());
    try {
      const out = fn();
      save();
      return out;
    } catch (e) {
      state = JSON.parse(snapshot);
      _internal.replaceDb(JSON.parse(ws));
      throw e;
    }
  },
  getApplicationByUser: (userId) => state.apps.find((a) => a.userId === userId) ?? null,
  getApplicationById: (id) => state.apps.find((a) => a.id === id) ?? null,
  insertApplication(rec) {
    if (state.apps.some((a) => a.userId === rec.userId)) throw new ApiError(409, 'An application already exists for this account.');
    state.apps.push(structuredClone(rec));
  },
  updateApplication(rec) {
    const i = state.apps.findIndex((a) => a.id === rec.id);
    state.apps[i] = structuredClone(rec);
  },
  getSubmitKey: (appId) => state.submitKeys[appId] ?? null,
  setSubmitKey(appId, key) {
    state.submitKeys[appId] = key;
  },
  listDocuments: (appId) => state.docs.filter((d) => d.applicationId === appId).map((d) => structuredClone(d)),
  getDocument: (id) => structuredClone(state.docs.find((d) => d.id === id) ?? null),
  insertDocument(doc) {
    state.docs.push(structuredClone(doc));
  },
  updateDocument(doc) {
    const i = state.docs.findIndex((d) => d.id === doc.id);
    state.docs[i] = structuredClone(doc);
  },
  getBank: (appId) => state.banks[appId] ?? null,
  saveBank(appId, view) {
    // The preview never keeps the full account number.
    state.banks[appId] = view;
  },
  getOrganic: (appId) => state.organic[appId] ?? null,
  saveOrganic(appId, rec) {
    state.organic[appId] = rec;
  },
  nextReferenceId() {
    state.seq += 1;
    return `MA-${new Date().getFullYear()}-${String(state.seq).padStart(6, '0')}`;
  },
  getAccount(userId) {
    const u = state.users.find((x) => x.id === userId);
    return u ? accountOf(u) : null;
  },
  audit(entry) {
    state.audit.unshift({ ...entry, at: new Date().toISOString() });
    state.audit = state.audit.slice(0, 200);
  },
  newId: rid,
};

const service = new ApplicationService(store);

/** The preview's pre-existing demo seller (already approved), created on first run. */
async function ensureDemoAccount() {
  if (state.users.some((u) => u.email === DEMO_EMAIL)) return;
  const ws = _internal.findSeller(SELLER_A);
  if (!ws) return;
  const salt = rid('s');
  const t = new Date(ws.joinedAt).toISOString();
  const user: LocalUser = { id: rid('usr'), sellerId: SELLER_A, fullName: ws.ownerName, email: DEMO_EMAIL, phone: '+919800000210', salt, passwordHash: await hash(DEMO_PASSWORD, salt), emailVerifiedAt: t, phoneVerifiedAt: t, createdAt: t };
  if (state.users.some((u) => u.email === DEMO_EMAIL)) return;
  state.users.push(user);
  state.seq += 1;
  const app: ApplicationRecord = {
    id: rid('app'),
    userId: user.id,
    sellerId: SELLER_A,
    referenceId: `MA-${new Date(t).getFullYear()}-${String(state.seq).padStart(6, '0')}`,
    status: ws.status,
    currentStep: 8,
    data: {
      ...emptyApplicationData(),
      shopName: ws.shopName,
      ownerName: ws.ownerName,
      businessEmail: ws.email,
      primaryPhone: user.phone,
      description: ws.description,
      addressLine1: 'Survey 42, Mulshi Road',
      state: 'Maharashtra',
      district: 'Pune',
      city: 'Pirangut',
      pincode: '412115',
      serviceAreas: ws.serviceAreas,
      productTypes: ws.productTypes,
      pickupSameAsBusiness: false,
      pickupAddress: 'Packhouse 2, Survey 42, Mulshi Road, Pirangut, Pune',
      pickupPincode: '412115',
      businessType: 'proprietorship',
      gstStatus: ws.gstin ? 'registered' : 'not_registered',
      gstin: ws.gstin ?? '',
      pan: ws.pan ?? '',
      claimsOrganic: true,
      certBody: 'Demo Certification Body (fictional)',
      certNumber: 'DEMO/NPOP/2025/0142',
    },
    createdAt: t,
    submittedAt: t,
    lastSubmittedAt: t,
    updatedAt: t,
    reviewerMessage: null,
    requestedItems: [],
    reviewedAt: t,
    previousStatus: null,
  };
  state.apps.push(app);
  state.banks[app.id] = { holderName: ws.bank.accountName, last4: ws.bank.last4, ifsc: ws.bank.ifsc, bankName: 'HDFC Bank', updatedAt: t };
  const kinds: ApplicationDocKind[] = ['pan', 'gst', 'bank_proof', 'address_proof', 'organic_cert', 'additional'];
  for (const d of _internal.getDb().documents.filter((x) => x.sellerId === SELLER_A)) {
    const kind = kinds.includes(d.type as ApplicationDocKind) ? (d.type as ApplicationDocKind) : 'additional';
    state.docs.push({ id: d.id, applicationId: app.id, kind, fileName: d.fileName, mimeType: d.mimeType, sizeBytes: d.sizeKb * 1024, uploadedAt: d.uploadedAt, status: d.status === 'approved' ? 'verified' : d.status === 'rejected' ? 'rejected' : 'unverified', supersededAt: null });
    if (d.type === 'organic_cert') {
      app.data.certExpiryDate = d.expiresAt ?? '';
      state.organic[app.id] = { status: d.status === 'approved' ? 'verified' : 'submitted', documentId: d.id, reviewerNote: null, reviewedAt: t };
    }
  }
  state.sessionUserId = user.id;
  save();
}

const ready = ensureDemoAccount();

function currentUser(): LocalUser {
  const u = state.users.find((x) => x.id === state.sessionUserId);
  if (!u) throw new ApiError(401, 'Please sign in to continue.');
  return u;
}

/** Point the business workspace at the signed-in seller. */
function bindSession(u: LocalUser | null) {
  if (u) _internal.setSession(u.sellerId, u.fullName.split(' ').map((p, i) => (i ? `${p[0]}.` : p)).join(' '));
  else _internal.setSession('__signed_out__', 'Signed out');
}

/** Re-apply every application to the workspace (after the workspace was reset). */
export function resyncWorkspace() {
  store.transaction(() => {
    for (const app of state.apps) service.syncWorkspace(app);
  });
}

export const localAuth = {
  async current(): Promise<AccountView | null> {
    await ready;
    const u = state.users.find((x) => x.id === state.sessionUserId) ?? null;
    bindSession(u);
    return u ? toAccountView(accountOf(u)) : null;
  },
  async signUp(input: { fullName: string; email: string; phone: string; password: string }): Promise<AccountView> {
    await ready;
    const v = validateSignUp(input);
    if (Object.keys(v.errors).length) throw new ApiError(422, 'Please fix the highlighted fields.', v.errors);
    if (state.users.some((u) => u.email === v.email)) throw new ApiError(409, 'An account with this email already exists. Sign in instead.', { email: 'An account with this email already exists.' });
    if (state.users.some((u) => u.phone === v.phone)) throw new ApiError(409, 'This mobile number is already registered.', { phone: 'This mobile number is already registered.' });
    const salt = rid('s');
    const user: LocalUser = { id: rid('usr'), sellerId: rid('s'), fullName: v.fullName, email: v.email, phone: v.phone, salt, passwordHash: await hash(v.password, salt), emailVerifiedAt: null, phoneVerifiedAt: null, createdAt: new Date().toISOString() };
    store.transaction(() => {
      state.users.push(user);
      state.sessionUserId = user.id;
      service.createForAccount(accountOf(user));
    });
    bindSession(user);
    return toAccountView(accountOf(user));
  },
  /** Preview only: returns the code so the page can show it, as no email/SMS provider exists. */
  async sendCode(channel: 'email' | 'phone'): Promise<{ previewCode: string }> {
    const u = currentUser();
    const code = String(crypto.getRandomValues(new Uint32Array(1))[0]! % 1_000_000).padStart(6, '0');
    state.codes[`${u.id}:${channel}`] = { code, expires: Date.now() + 10 * 60_000, attempts: 0 };
    save();
    return { previewCode: code };
  },
  async verifyCode(channel: 'email' | 'phone', code: string): Promise<AccountView> {
    const u = currentUser();
    const rec = state.codes[`${u.id}:${channel}`];
    if (!rec || rec.expires < Date.now()) throw new ApiError(410, 'This code has expired. Send a new one.', { [`${channel}Code`]: 'Code expired. Send a new one.' });
    if (rec.attempts >= 5) throw new ApiError(429, 'Too many attempts. Send a new code.', { [`${channel}Code`]: 'Too many attempts. Send a new code.' });
    if (String(code).trim() !== rec.code) {
      rec.attempts += 1;
      save();
      throw new ApiError(422, 'That code is incorrect.', { [`${channel}Code`]: 'That code is incorrect.' });
    }
    delete state.codes[`${u.id}:${channel}`];
    if (channel === 'email') u.emailVerifiedAt = new Date().toISOString();
    else u.phoneVerifiedAt = new Date().toISOString();
    store.transaction(() => {
      const app = store.getApplicationByUser(u.id);
      if (app) service.syncWorkspace(app);
    });
    return toAccountView(accountOf(u));
  },
  async signIn(email: string, password: string): Promise<AccountView> {
    await ready;
    const u = state.users.find((x) => x.email === String(email).trim().toLowerCase());
    if (!u || (await hash(password, u.salt)) !== u.passwordHash) throw new ApiError(401, 'Email or password is incorrect.');
    state.sessionUserId = u.id;
    save();
    bindSession(u);
    return toAccountView(accountOf(u));
  },
  async signOut() {
    state.sessionUserId = null;
    save();
    bindSession(null);
  },
};

export const localApplication = {
  async get(): Promise<ApplicationView> {
    return service.view(accountOf(currentUser()));
  },
  async saveDraft(data: unknown, nextStep: number, validateStep: number | null): Promise<ApplicationView> {
    return service.saveDraft(accountOf(currentUser()), data, nextStep, validateStep);
  },
  async saveBank(input: BankInput): Promise<ApplicationView> {
    return service.saveBank(accountOf(currentUser()), input);
  },
  async uploadDocument(kind: ApplicationDocKind, file: File, cert?: Record<string, string>): Promise<ApplicationView> {
    const acc = accountOf(currentUser());
    const head = new Uint8Array(await file.slice(0, 8).arrayBuffer());
    const meta = { kind, fileName: file.name, sizeBytes: file.size, sniffedMime: sniffMime(head), ...(cert ? { cert } : {}) };
    const { documentId } = service.checkUpload(acc, meta);
    return service.recordUpload(acc, meta, documentId);
  },
  async submit(idempotencyKey: string): Promise<ApplicationView> {
    return service.submit(accountOf(currentUser()), idempotencyKey);
  },
};

/** Preview-only stand-in for the Super Admin Portal's review actions. */
export const localAdmin = {
  async decide(action: AdminAction, message: string, requestedItems: string[] = []) {
    const app = store.getApplicationByUser(currentUser().id);
    if (!app) throw new ApiError(404, 'No application.');
    service.adminDecide(app.id, action, 'Preview reviewer', message, requestedItems);
  },
  async reviewOrganic(decision: 'verified' | 'rejected', note: string) {
    const app = store.getApplicationByUser(currentUser().id);
    const org = app ? store.getOrganic(app.id) : null;
    if (!org?.documentId) throw new ApiError(404, 'No organic certificate has been uploaded.');
    service.adminReviewDocument(org.documentId, decision, 'Preview reviewer', note);
  },
  async status() {
    const app = store.getApplicationByUser(currentUser().id);
    return app ? { status: app.status, organic: store.getOrganic(app.id)?.status ?? 'not_submitted' } : null;
  },
};

