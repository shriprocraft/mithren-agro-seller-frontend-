// The API the pages use. When the portal is served by the Node backend
// (server/), every call goes over HTTPS to the server, which enforces sign-in,
// ownership and approval rules. On a static host with no server (the preview
// link), the same calls run against the in-browser stand-in instead.

import * as core from './api-core.js';
import { ApiError } from './errors.js';
import { RPC_METHODS, DEMO_RPC_METHODS, type RpcName } from './rpc.js';
import type { AccountView, AdminAction, ApplicationDocKind, ApplicationView, BankInput } from './application.js';

export { ApiError };
export type { DashboardMetrics, ProductFilter, ProductInput, OrderFilter, LedgerEntry, Settlement } from './api-core.js';

const meta = (name: string) => (typeof document !== 'undefined' ? document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`)?.content : undefined);

/** True when served by the Node backend. */
export const REMOTE = meta('seller-api') === 'server';
/** Checkout/delivery simulators: always in the preview, opt-in on the server. */
export const DEMO_TOOLS = !REMOTE || meta('seller-demo-tools') === 'on';

export const sim = core.sim;

const listeners = new Set<() => void>();
export function onDataChange(fn: () => void) {
  listeners.add(fn);
  const off = core.onDataChange(fn);
  return () => {
    listeners.delete(fn);
    off();
  };
}

async function http<T>(method: string, url: string, body?: unknown, raw?: { data: Blob; type: string }): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      credentials: 'same-origin',
      headers: {
        'X-Requested-With': 'seller-portal',
        ...(raw ? { 'Content-Type': raw.type || 'application/octet-stream' } : body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(raw ? { body: raw.data } : body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  } catch {
    throw new ApiError(503, 'Can’t reach the server. Check your connection and try again.');
  }
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON error page */
  }
  if (!res.ok) {
    const err = (json as { error?: { message?: string; fieldErrors?: Record<string, string> } } | null)?.error;
    throw new ApiError(res.status, err?.message ?? `Request failed (${res.status}).`, err?.fieldErrors ?? {});
  }
  return json as T;
}

function rpc<K extends RpcName>(name: K): (typeof core)[K] {
  const write = (RPC_METHODS as Record<string, boolean>)[name] ?? (DEMO_RPC_METHODS as Record<string, boolean>)[name] ?? false;
  return ((...args: unknown[]) => {
    if (!REMOTE) return (core[name] as (...a: unknown[]) => unknown)(...args);
    if (write && sim.failWrites) return Promise.reject(new ApiError(503, 'Network error — your change was not saved. Check your connection and try again.'));
    return http('POST', `/api/rpc/${name}`, { args }).then((r) => {
      if (write) listeners.forEach((l) => l());
      return r;
    });
  }) as (typeof core)[K];
}

// ---------- business API ----------
export const getSeller = rpc('getSeller');
export const updateSeller = rpc('updateSeller');
export const listProducts = rpc('listProducts');
export const getProduct = rpc('getProduct');
export const saveProduct = rpc('saveProduct');
export const setProductAvailability = rpc('setProductAvailability');
export const archiveProduct = rpc('archiveProduct');
export const adjustStock = rpc('adjustStock');
export const listAdjustments = rpc('listAdjustments');
export const applyInventoryCsv = rpc('applyInventoryCsv');
export const listOrders = rpc('listOrders');
export const getOrder = rpc('getOrder');
export const transitionOrder = rpc('transitionOrder');
export const markItemUnavailable = rpc('markItemUnavailable');
export const getLedger = rpc('getLedger');
export const listSettlements = rpc('listSettlements');
export const listPayoutRequests = rpc('listPayoutRequests');
export const getCommissionRules = rpc('getCommissionRules');
export const requestPayout = rpc('requestPayout');
export const listReviews = rpc('listReviews');
export const replyToReview = rpc('replyToReview');
export const reportReview = rpc('reportReview');
export const listDocuments = rpc('listDocuments');
export const listNotifications = rpc('listNotifications');
export const markNotificationsRead = rpc('markNotificationsRead');
export const getDashboard = rpc('getDashboard');
export const _demoSimulateNewOrder = rpc('_demoSimulateNewOrder');
export const _demoAdvanceDelivery = rpc('_demoAdvanceDelivery');

const local = REMOTE ? null : await import('./local-backend.js');

// Preview-only data tools (no server equivalent).
export function resetDemoData() {
  if (!local) throw new ApiError(404, 'Not available.');
  core.resetDemoData();
  local.resyncWorkspace();
}
export function clearAllData() {
  if (!local) throw new ApiError(404, 'Not available.');
  core.clearAllData();
  local.resyncWorkspace();
}

// ---------- email OTP (FastAPI backend) ----------

/** FastAPI backend that sends real email OTPs. Override with <meta name="otp-api" content="...">. */
export const OTP_API = (meta('otp-api') ?? 'http://127.0.0.1:8000').replace(/\/+$/, '');

async function otpPost<T>(path: string, body: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${OTP_API}/api/v1/auth/email-otp/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    throw new ApiError(503, 'Can’t reach the verification server. Check that it is running and try again.');
  }
  const json = (await res.json().catch(() => null)) as { detail?: unknown } | null;
  if (!res.ok) {
    const d = json?.detail;
    const message =
      typeof d === 'object' && d && !Array.isArray(d) && 'message' in d
        ? String((d as { message: unknown }).message)
        : Array.isArray(d) && d[0]?.msg
          ? String(d[0].msg).replace(/^Value error, /, '')
          : `Request failed (${res.status}).`;
    throw new ApiError(res.status, message, { emailCode: message });
  }
  return json as T;
}

// ---------- seller shop details (FastAPI backend) ----------

export interface ShopDetailsStep2 {
  shop_name: string;
  owner_name: string;
  email: string;
  phone: string;
}
export interface ShopDetailsPatch extends Partial<ShopDetailsStep2> {
  address_line1?: string;
  city?: string;
  state?: string;
  pincode?: string;
  pan_number?: string | null;
  gstin?: string | null;
}
export interface ShopDetailsView extends ShopDetailsStep2 {
  seller_id: string;
  approval_status: 'pending' | 'approved' | 'rejected';
  address_line1: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  pan_number: string | null;
  gstin: string | null;
  created_at: string;
  updated_at: string;
}
export interface BankDetailsInput {
  account_holder_name: string;
  ifsc_code: string;
  account_number: string;
}
export interface BankDetailsView {
  seller_id: string;
  account_holder_name: string;
  ifsc_code: string;
  last_4_digits: string;
  updated_at: string;
}

/** Backend field name → wizard form field, so errors highlight the right input. */
const SHOP_FIELD: Record<string, string> = {
  shop_name: 'shopName',
  owner_name: 'ownerName',
  email: 'businessEmail',
  phone: 'primaryPhone',
  address_line1: 'addressLine1',
  city: 'city',
  state: 'state',
  pincode: 'pincode',
  pan_number: 'pan',
  gstin: 'gstin',
  account_holder_name: 'holderName',
  ifsc_code: 'ifsc',
  account_number: 'accountNumber',
};

async function sellerRequest<T>(method: 'POST' | 'PATCH', path: string, body: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${OTP_API}/api/v1/seller/${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    throw new ApiError(503, 'Can’t reach the server. Check that it is running and try again.');
  }
  const json = (await res.json().catch(() => null)) as { detail?: unknown } | null;
  if (res.ok) return json as T;
  const d = json?.detail;
  const fieldErrors: Record<string, string> = {};
  let message = `Request failed (${res.status}).`;
  if (Array.isArray(d)) {
    // FastAPI validation errors: [{ loc: ['body', 'pincode'], msg: '...' }]
    for (const e of d as { loc?: unknown[]; msg?: string }[]) {
      const field = SHOP_FIELD[String(e.loc?.[e.loc.length - 1])];
      const msg = String(e.msg ?? 'Invalid value').replace(/^Value error, /, '');
      if (field && !fieldErrors[field]) fieldErrors[field] = msg.endsWith('.') ? msg : `${msg}.`;
    }
    message = 'Please fix the highlighted fields.';
  } else if (d && typeof d === 'object' && 'message' in d) {
    message = String((d as { message: unknown }).message);
    const field = SHOP_FIELD[String((d as { field?: unknown }).field)];
    if (field) fieldErrors[field] = message;
  }
  throw new ApiError(res.status, message, fieldErrors);
}

const sellerIdKey = (owner: string) => `mithren.sellerId:${owner.toLowerCase()}`;

export const shopDetails = {
  /** Step 2: POST /api/v1/seller/shop-details. Creates the seller and returns its seller_id. */
  create: (input: ShopDetailsStep2) => sellerRequest<ShopDetailsView>('POST', 'shop-details', input),
  /** Steps 3 and 5 (and a revisited Step 2): PATCH /api/v1/seller/shop-details/{seller_id}. */
  update: (sellerId: string, patch: ShopDetailsPatch) =>
    sellerRequest<ShopDetailsView>('PATCH', `shop-details/${encodeURIComponent(sellerId)}`, patch),
  /** Step 6: POST /api/v1/seller/bank-details/{seller_id}. Creates or replaces the payout account. */
  saveBank: (sellerId: string, input: BankDetailsInput) =>
    sellerRequest<BankDetailsView>('POST', `bank-details/${encodeURIComponent(sellerId)}`, input),
  /** The seller_id is kept in this browser, per signed-in account, until seller sign-in exists. */
  savedSellerId(owner: string): string | null {
    try {
      return localStorage.getItem(sellerIdKey(owner));
    } catch {
      return null;
    }
  },
  rememberSellerId(owner: string, sellerId: string) {
    try {
      localStorage.setItem(sellerIdKey(owner), sellerId);
    } catch {
      /* private mode: the seller is created again on the next step */
    }
  },
};

async function currentEmail(): Promise<string> {
  const a = await local!.localAuth.current();
  if (!a) throw new ApiError(401, 'Sign in again to continue.');
  return a.email;
}

// ---------- accounts ----------

export const auth = {
  current: (): Promise<AccountView | null> => (local ? local.localAuth.current() : http<{ account: AccountView | null }>('GET', '/api/auth/me').then((r) => r.account)),
  signUp: (input: { fullName: string; email: string; phone: string; password: string }): Promise<AccountView> =>
    local ? local.localAuth.signUp(input) : http<{ account: AccountView }>('POST', '/api/auth/signup', input).then((r) => r.account),
  /** Email codes are sent by the FastAPI backend. The preview has no SMS provider, so it returns the phone code to display. */
  sendCode: async (channel: 'email' | 'phone'): Promise<{ previewCode?: string }> => {
    if (!local) return http('POST', '/api/auth/send-code', { channel });
    if (channel === 'email') {
      await otpPost('send', { email: await currentEmail() });
      return {};
    }
    return local.localAuth.sendCode(channel);
  },
  verifyCode: async (channel: 'email' | 'phone', code: string): Promise<AccountView> => {
    if (!local) return http<{ account: AccountView }>('POST', '/api/auth/verify', { channel, code }).then((r) => r.account);
    if (channel === 'email') {
      await otpPost('verify', { email: await currentEmail(), code });
      return local.localAuth.markVerified('email');
    }
    return local.localAuth.verifyCode(channel, code);
  },
  signIn: (email: string, password: string): Promise<AccountView> =>
    local ? local.localAuth.signIn(email, password) : http<{ account: AccountView }>('POST', '/api/auth/signin', { email, password }).then((r) => r.account),
  signOut: (): Promise<void> => (local ? local.localAuth.signOut() : http<void>('POST', '/api/auth/signout')),
};

// ---------- seller application ----------
export const application = {
  get: (): Promise<ApplicationView> => (local ? local.localApplication.get() : http('GET', '/api/application')),
  saveDraft: (data: unknown, nextStep: number, validateStep: number | null): Promise<ApplicationView> =>
    local ? local.localApplication.saveDraft(data, nextStep, validateStep) : http('PUT', '/api/application', { data, nextStep, validateStep }),
  saveBank: (input: BankInput): Promise<ApplicationView> => (local ? local.localApplication.saveBank(input) : http('PUT', '/api/application/bank', input)),
  uploadDocument: (kind: ApplicationDocKind, file: File, cert?: Record<string, string>): Promise<ApplicationView> => {
    if (local) return local.localApplication.uploadDocument(kind, file, cert);
    const q = new URLSearchParams({ kind, name: file.name, ...(cert ?? {}) });
    return http('POST', `/api/application/documents?${q}`, undefined, { data: file, type: file.type });
  },
  submit: (idempotencyKey: string): Promise<ApplicationView> => (local ? local.localApplication.submit(idempotencyKey) : http('POST', '/api/application/submit', { idempotencyKey })),
  /** Private file link for the owner (server only; the preview keeps no files). */
  fileUrl: (documentId: string): string | null => (REMOTE ? `/api/documents/${encodeURIComponent(documentId)}/file` : null),
};

/** Preview-only stand-in for Super Admin review actions. Undefined on the server. */
export const previewAdmin: null | { decide(action: AdminAction, message: string, requestedItems?: string[]): Promise<void>; reviewOrganic(decision: 'verified' | 'rejected', note: string): Promise<void> } = local ? local.localAdmin : null;
export const PREVIEW_DEMO = local ? { email: local.DEMO_EMAIL, password: local.DEMO_PASSWORD } : null;
