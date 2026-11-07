// The API the pages use. When the portal is served by the Node backend
// (server/), every call goes over HTTPS to the server, which enforces sign-in,
// ownership and approval rules. On a static host with no server (the preview
// link), the same calls run against the in-browser stand-in instead.

import * as core from './api-core.js';
import { ApiError } from './errors.js';
import { RPC_METHODS, DEMO_RPC_METHODS, type RpcName } from './rpc.js';
import type { AccountView, AdminAction, ApplicationDocKind, ApplicationView, BankInput } from './application.js';
import type { OrderStatus, SubOrder } from './types.js';
import { BACKEND_STATUS, toSubOrder, type BackendOrder } from './backend-orders.js';
import { toDashboardMetrics, type BackendDashboard } from './backend-analytics.js';

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
const localListOrders = rpc('listOrders');
const localGetOrder = rpc('getOrder');
const localTransitionOrder = rpc('transitionOrder');

/** The seller's orders: from the FastAPI backend when signed in there, otherwise the portal's own. */
export const listOrders = (f: core.OrderFilter = {}): Promise<SubOrder[]> => (sellerSession.isSignedIn() ? backendOrders.list(f) : localListOrders(f));
export const getOrder = (id: string): Promise<SubOrder> => (sellerSession.isSignedIn() ? backendOrders.get(id) : localGetOrder(id));
export const transitionOrder = (id: string, to: OrderStatus, note = ''): Promise<SubOrder> =>
  sellerSession.isSignedIn() ? backendOrders.transition(id, to, note) : localTransitionOrder(id, to, note);
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
const localGetDashboard = rpc('getDashboard');
/** Dashboard figures: from the FastAPI analytics when signed in there, otherwise the portal's own. */
export const getDashboard = async (days: number): Promise<core.DashboardMetrics> =>
  sellerSession.isSignedIn()
    ? toDashboardMetrics(await backendRequest<BackendDashboard>('GET', `seller/analytics/dashboard?days=${days}`, undefined, () => undefined))
    : localGetDashboard(days);
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

type FieldFor = (loc: unknown[]) => string | undefined;
const shopField: FieldFor = (loc) => SHOP_FIELD[String(loc[loc.length - 1])];

/** Calls the FastAPI backend under /api/v1 and turns its errors into an ApiError with field errors. */
// ---------- seller session (FastAPI JWTs) ----------

const TOKENS_KEY = 'mithren.sellerTokens';
/** Fired on window when the server rejects the session and it can't be refreshed. */
export const SESSION_EXPIRED_EVENT = 'seller-session-expired';

interface StoredTokens {
  access: string;
  refresh: string;
}

/** The signed-in seller's access and refresh tokens, kept in localStorage. */
export const sellerSession = {
  tokens(): StoredTokens | null {
    try {
      const t = JSON.parse(localStorage.getItem(TOKENS_KEY) ?? 'null') as StoredTokens | null;
      return t && typeof t.access === 'string' && typeof t.refresh === 'string' ? t : null;
    } catch {
      return null;
    }
  },
  save(pair: { access_token: string; refresh_token: string }) {
    try {
      localStorage.setItem(TOKENS_KEY, JSON.stringify({ access: pair.access_token, refresh: pair.refresh_token }));
    } catch {
      /* private mode: the seller signs in again next visit */
    }
  },
  clear() {
    try {
      localStorage.removeItem(TOKENS_KEY);
      localStorage.removeItem(SHOP_NAME_KEY);
    } catch {
      /* ignore */
    }
  },
  isSignedIn(): boolean {
    return this.tokens() !== null;
  },
  /** The server's shop name for this session, for the header when this browser has none saved. */
  shopName(): string {
    try {
      return this.tokens() ? (localStorage.getItem(SHOP_NAME_KEY) ?? '') : '';
    } catch {
      return '';
    }
  },
  setShopName(name: string | null | undefined) {
    try {
      if (name) localStorage.setItem(SHOP_NAME_KEY, name);
      else localStorage.removeItem(SHOP_NAME_KEY);
    } catch {
      /* ignore */
    }
  },
};
const SHOP_NAME_KEY = 'mithren.shopName';

let refreshing: Promise<boolean> | null = null;
/** Swaps the refresh token for a new pair. Concurrent callers share one request. */
function refreshTokens(): Promise<boolean> {
  refreshing ??= (async () => {
    const t = sellerSession.tokens();
    if (!t) return false;
    try {
      const res = await fetch(`${OTP_API}/api/v1/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: t.refresh }),
      });
      if (!res.ok) return false;
      sellerSession.save((await res.json()) as { access_token: string; refresh_token: string });
      return true;
    } catch {
      return false;
    }
  })().finally(() => (refreshing = null));
  return refreshing;
}

async function backendFetch(method: string, path: string, body: unknown): Promise<Response> {
  const token = sellerSession.tokens()?.access;
  // FormData sets its own multipart Content-Type (with the boundary); JSON bodies are encoded here.
  const form = body instanceof FormData;
  return fetch(`${OTP_API}/api/v1/${path}`, {
    method,
    headers: {
      ...(body === undefined || form ? {} : { 'Content-Type': 'application/json' }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body === undefined ? {} : { body: form ? body : JSON.stringify(body) }),
  });
}

/**
 * Calls the FastAPI backend under /api/v1 with the seller's Bearer token, and turns its errors into
 * an ApiError with field errors. A 401 refreshes the tokens once and retries; if that fails the
 * session is cleared and SESSION_EXPIRED_EVENT sends the seller to sign in.
 */
async function sendWithRefresh(method: string, path: string, body: unknown): Promise<Response> {
  try {
    let res = await backendFetch(method, path, body);
    const sessionCall = !path.startsWith('auth/');
    if (res.status === 401 && sessionCall && sellerSession.isSignedIn()) {
      if (await refreshTokens()) res = await backendFetch(method, path, body);
      if (res.status === 401) {
        sellerSession.clear();
        window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT));
      }
    }
    return res;
  } catch {
    throw new ApiError(503, 'Can’t reach the server. Check that it is running and try again.');
  }
}

async function backendRequest<T>(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, body: unknown, fieldFor: FieldFor): Promise<T> {
  const res = await sendWithRefresh(method, path, body);
  if (res.status === 204) return undefined as T;
  const json = (await res.json().catch(() => null)) as { detail?: unknown } | null;
  if (res.ok) return json as T;
  const d = json?.detail;
  const fieldErrors: Record<string, string> = {};
  let message = `Request failed (${res.status}).`;
  if (Array.isArray(d)) {
    // FastAPI validation errors: [{ loc: ['body', 'pincode'], msg: '...' }]
    const general: string[] = [];
    for (const e of d as { loc?: unknown[]; msg?: string }[]) {
      const field = fieldFor(e.loc ?? []);
      let msg = String(e.msg ?? 'Invalid value').replace(/^Value error, /, '');
      if (!msg.endsWith('.')) msg += '.';
      if (field) fieldErrors[field] ??= msg;
      else general.push(msg);
    }
    message = general.length ? general.join(' ') : 'Please fix the highlighted fields.';
  } else if (d && typeof d === 'object' && 'message' in d) {
    message = String((d as { message: unknown }).message);
    const field = fieldFor([(d as { field?: unknown }).field]);
    if (field) fieldErrors[field] = message;
  }
  throw new ApiError(res.status, message, fieldErrors);
}

const sellerIdKey = (owner: string) => `mithren.sellerId:${owner.toLowerCase()}`;

export const shopDetails = {
  /** Step 2: POST /api/v1/seller/shop-details. Creates the seller and returns its seller_id. */
  create: (input: ShopDetailsStep2) => backendRequest<ShopDetailsView>('POST', 'seller/shop-details', input, shopField),
  /** Steps 3 and 5 (and a revisited Step 2): PATCH /api/v1/seller/shop-details/{seller_id}. */
  update: (sellerId: string, patch: ShopDetailsPatch) =>
    backendRequest<ShopDetailsView>('PATCH', `seller/shop-details/${encodeURIComponent(sellerId)}`, patch, shopField),
  /** Step 6: POST /api/v1/seller/bank-details/{seller_id}. Creates or replaces the payout account. */
  saveBank: (sellerId: string, input: BankDetailsInput) =>
    backendRequest<BankDetailsView>('POST', `seller/bank-details/${encodeURIComponent(sellerId)}`, input, shopField),
  /** The seller_id is kept in this browser, per signed-in account, until seller sign-in exists. */
  savedSellerId(owner: string): string | null {
    try {
      return localStorage.getItem(sellerIdKey(owner));
    } catch {
      return null;
    }
  },
  /** POST /api/v1/seller/claim/{seller_id}: moves a shop saved before sign-in existed onto this account. */
  claim: (sellerId: string) => backendRequest<ShopDetailsView>('POST', `seller/claim/${encodeURIComponent(sellerId)}`, undefined, () => undefined),
  rememberSellerId(owner: string, sellerId: string) {
    try {
      localStorage.setItem(sellerIdKey(owner), sellerId);
    } catch {
      /* private mode: the seller is created again on the next step */
    }
  },
};

// ---------- products (FastAPI backend) ----------

export type { BackendProduct, BackendVariant } from './catalog.js';
export interface BackendProductView {
  id: string;
  seller_id: string;
  title: string;
  category: string;
  price_paise: number;
  stock: number;
  is_active: boolean;
  variants: { id: string; label: string; sku: string; size: string | null; price_paise: number; stock: number }[];
}

/** Backend field path -> product form field, so errors highlight the right input. */
const productField: FieldFor = (loc) => {
  const [, first, index, key] = loc.map(String);
  if (first === 'variants' && index !== undefined && key !== undefined) {
    const k = { price_paise: 'price', mrp_paise: 'mrp', pack_size: 'packSize' }[key] ?? key;
    return `variant_${index}_${k}`;
  }
  return first === undefined ? undefined : ({ title: 'name', description: 'description', category: 'category' } as Record<string, string>)[first];
};

export const products = {
  /** POST /api/v1/products. Prices must already be integer paise (see toBackendProduct). */
  create: (payload: import('./catalog.js').BackendProduct) => backendRequest<BackendProductView>('POST', 'products', payload, productField),
  /** PATCH /api/v1/products/{id}. Sent variants replace the stored list. */
  update: (backendId: string, payload: import('./catalog.js').BackendProductUpdate) =>
    backendRequest<BackendProductView>('PATCH', `products/${encodeURIComponent(backendId)}`, payload, productField),
  /** DELETE /api/v1/products/{id}: soft delete, the product becomes inactive. */
  remove: (backendId: string) => backendRequest<BackendProductView>('DELETE', `products/${encodeURIComponent(backendId)}`, undefined, productField),
};

// ---------- image uploads (FastAPI backend) ----------

export interface UploadedImage {
  image_url: string;
  /** What products store in `images`, e.g. /static/uploads/products/prod_<id>.png */
  path: string;
  content_type: string;
  size_bytes: number;
}

export const uploads = {
  /** POST /api/v1/uploads/product-image (multipart, Bearer token). */
  productImage: (file: File): Promise<UploadedImage> => {
    const form = new FormData();
    form.append('file', file, file.name);
    return backendRequest<UploadedImage>('POST', 'uploads/product-image', form, () => undefined);
  },
};

// ---------- orders (FastAPI backend) ----------

const ACTIVE: OrderStatus[] = ['awaiting_confirmation', 'accepted', 'packed', 'ready_for_pickup', 'in_transit'];
const ISSUES: OrderStatus[] = ['cancelled', 'rejected', 'return_requested', 'returned'];

const backendOrders = {
  /** Every order (a page at a time), then the portal's own tab and search filters. */
  async list(f: core.OrderFilter = {}): Promise<SubOrder[]> {
    const all: BackendOrder[] = [];
    for (let offset = 0; ; offset += 100) {
      const page = await backendRequest<{ items: BackendOrder[]; total: number }>('GET', `seller/orders?limit=100&offset=${offset}`, undefined, () => undefined);
      all.push(...page.items);
      if (all.length >= page.total || !page.items.length) break;
    }
    const q = f.q?.trim().toLowerCase();
    return all
      .map((o) => toSubOrder(o))
      .filter((o) => (!f.status ? true : f.status === 'active' ? ACTIVE.includes(o.status) : f.status === 'issues' ? ISSUES.includes(o.status) : o.status === f.status))
      .filter((o) => (q ? o.id.toLowerCase().includes(q) || o.customer.firstName.toLowerCase().includes(q) : true));
  },
  async get(id: string): Promise<SubOrder> {
    return toSubOrder(await backendRequest<BackendOrder>('GET', `seller/orders/${encodeURIComponent(id)}`, undefined, () => undefined));
  },
  async transition(id: string, to: OrderStatus, note: string): Promise<SubOrder> {
    const status = BACKEND_STATUS[to];
    if (!status) throw new ApiError(409, 'The delivery partner updates this status.');
    const body = { status, ...(note.trim() ? { reason: note.trim() } : {}) };
    return toSubOrder(await backendRequest<BackendOrder>('PATCH', `seller/orders/${encodeURIComponent(id)}/status`, body, () => undefined));
  },
};

/** The printable GST invoice (HTML) for a backend order. */
export async function orderInvoiceHtml(id: string): Promise<string> {
  const res = await sendWithRefresh('GET', `seller/orders/${encodeURIComponent(id)}/invoice`, undefined);
  if (res.ok) return res.text();
  const json = (await res.json().catch(() => null)) as { detail?: { message?: string } } | null;
  throw new ApiError(res.status, json?.detail?.message ?? `The invoice couldn’t be loaded (${res.status}).`);
}

/** A product image as a URL the browser can load: server paths are served by the FastAPI backend. */
export const imageUrl = (pathOrUrl: string): string => (pathOrUrl.startsWith('/') ? `${OTP_API}${pathOrUrl}` : pathOrUrl);

/**
 * Runs the same checks as saving, without saving, so nothing is sent to the backend that the
 * portal would then refuse. The Node server checks again when it saves.
 */
export const checkProduct = (input: core.ProductInput, submit: boolean): void => {
  if (!REMOTE) core.checkProduct(input, submit);
};

async function currentEmail(): Promise<string> {
  const a = await local!.localAuth.current();
  if (!a) throw new ApiError(401, 'Sign in again to continue.');
  return a.email;
}

// ---------- accounts ----------

export interface SellerProfileView {
  user_id: string;
  full_name: string;
  email: string;
  phone: string;
  seller_id: string | null;
  shop_name: string | null;
  approval_status: string | null;
}
interface AuthResponseView {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  seller: SellerProfileView;
}

const registerField: FieldFor = (loc) =>
  ({ full_name: 'fullName', email: 'email', phone: 'phone', password: 'password' } as Record<string, string>)[String(loc[loc.length - 1])];
const loginField: FieldFor = (loc) => ({ identifier: 'email', password: 'password' } as Record<string, string>)[String(loc[loc.length - 1])];

/** Signs in to the FastAPI backend and keeps the tokens. Remembers the seller_id once Step 2 exists. */
async function backendSignIn(email: string, password: string): Promise<SellerProfileView> {
  const r = await backendRequest<AuthResponseView>('POST', 'auth/login', { identifier: email, password }, loginField);
  sellerSession.save(r);
  sellerSession.setShopName(r.seller.shop_name);
  if (r.seller.seller_id) shopDetails.rememberSellerId(email, r.seller.seller_id);
  return r.seller;
}

/**
 * For a portal account made before server sign-in existed: creates its server login with the
 * password just checked, and moves the shop this browser saved onto it. Best effort: on failure
 * the seller stays signed in to the portal only and the product form says photos can't be saved.
 */
async function connectToServer(password: string): Promise<void> {
  const who = local ? await local.localAuth.contact() : null;
  if (!who) return;
  try {
    const r = await backendRequest<AuthResponseView>(
      'POST',
      'auth/register',
      { full_name: who.fullName, email: who.email, phone: who.phone.replace(/^\+91/, ''), password },
      registerField,
    );
    sellerSession.save(r);
  } catch {
    return; // e.g. 409: a server login with another password exists for this email or phone
  }
  const legacy = shopDetails.savedSellerId(who.email);
  if (!legacy) return;
  try {
    sellerSession.setShopName((await shopDetails.claim(legacy)).shop_name);
  } catch {
    /* not this account's shop: Step 2 can be saved again from Store Settings */
  }
}

export const auth = {
  current: (): Promise<AccountView | null> => (local ? local.localAuth.current() : http<{ account: AccountView | null }>('GET', '/api/auth/me').then((r) => r.account)),
  /** Creates the seller account on the FastAPI backend (and signs in there), then in the portal. */
  signUp: async (input: { fullName: string; email: string; phone: string; password: string }): Promise<AccountView> => {
    const r = await backendRequest<AuthResponseView>(
      'POST',
      'auth/register',
      { full_name: input.fullName, email: input.email, phone: input.phone, password: input.password },
      registerField,
    );
    sellerSession.save(r);
    return local ? local.localAuth.signUp(input) : http<{ account: AccountView }>('POST', '/api/auth/signup', input).then((x) => x.account);
  },
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
  /**
   * Signs in to the FastAPI backend, then the portal. The preview demo account, and accounts made
   * before server sign-in existed, sign in to the portal only (no server session).
   */
  signIn: async (email: string, password: string): Promise<AccountView> => {
    const portalSignIn = () =>
      local ? local.localAuth.signIn(email, password) : http<{ account: AccountView }>('POST', '/api/auth/signin', { email, password }).then((r) => r.account);
    sellerSession.clear();
    const isDemo = !!PREVIEW_DEMO && email.trim().toLowerCase() === PREVIEW_DEMO.email;
    if (isDemo) return portalSignIn();
    let profile: SellerProfileView;
    try {
      profile = await backendSignIn(email, password);
    } catch (e) {
      // Not on the server (or the server is down): fall back to a portal-only account if there is one.
      if (e instanceof ApiError && (e.status === 401 || e.status === 503)) {
        let account: AccountView;
        try {
          account = await portalSignIn();
        } catch {
          throw e;
        }
        if (e.status === 401 && !isDemo) await connectToServer(password);
        return account;
      }
      throw e;
    }
    try {
      return await portalSignIn();
    } catch (e) {
      // Signed in on the server but this browser has no portal account yet: create it from the profile.
      if (!local || !(e instanceof ApiError) || e.status !== 401) throw e;
      try {
        await local.localAuth.signUp({ fullName: profile.full_name, email: profile.email, phone: profile.phone.replace(/^\+91/, ''), password });
      } catch {
        sellerSession.clear();
        throw new ApiError(409, 'This browser has a different password saved for this account. Sign in with that password.');
      }
      await local.localAuth.markVerified('email');
      return local.localAuth.markVerified('phone');
    }
  },
  /** Revokes the server session (best effort), forgets the tokens and signs out of the portal. */
  signOut: async (): Promise<void> => {
    const t = sellerSession.tokens();
    sellerSession.clear();
    if (t) await backendRequest<void>('POST', 'auth/logout', { refresh_token: t.refresh }, () => undefined).catch(() => undefined);
    return local ? local.localAuth.signOut() : http<void>('POST', '/api/auth/signout');
  },
  /** The signed-in seller's server profile (GET /api/v1/auth/me), or null without a server session. */
  me: (): Promise<SellerProfileView | null> =>
    sellerSession.isSignedIn() ? backendRequest<SellerProfileView>('GET', 'auth/me', undefined, () => undefined) : Promise.resolve(null),
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
