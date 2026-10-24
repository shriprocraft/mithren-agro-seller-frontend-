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

// ---------- accounts ----------

export const auth = {
  current: (): Promise<AccountView | null> => (local ? local.localAuth.current() : http<{ account: AccountView | null }>('GET', '/api/auth/me').then((r) => r.account)),
  signUp: (input: { fullName: string; email: string; phone: string; password: string }): Promise<AccountView> =>
    local ? local.localAuth.signUp(input) : http<{ account: AccountView }>('POST', '/api/auth/signup', input).then((r) => r.account),
  /** In the preview, returns the code to display because no email/SMS provider exists. */
  sendCode: (channel: 'email' | 'phone'): Promise<{ previewCode?: string }> => (local ? local.localAuth.sendCode(channel) : http('POST', '/api/auth/send-code', { channel })),
  verifyCode: (channel: 'email' | 'phone', code: string): Promise<AccountView> =>
    local ? local.localAuth.verifyCode(channel, code) : http<{ account: AccountView }>('POST', '/api/auth/verify', { channel, code }).then((r) => r.account),
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
