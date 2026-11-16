// The API the pages use. When the portal is served by the Node backend
// (server/), every call goes over HTTPS to the server, which enforces sign-in,
// ownership and approval rules. On a static host with no server (the preview
// link), the same calls run against the in-browser stand-in instead.

import * as core from './api-core.js';
import { ApiError } from './errors.js';
import { RPC_METHODS, DEMO_RPC_METHODS, type RpcName } from './rpc.js';
import type { AccountView, AdminAction, ApplicationDocKind, ApplicationView, BankInput } from './application.js';
import type { AdjustmentReason, AppNotification, InventoryAdjustment, OrderStatus, Review, SubOrder } from './types.js';
import { toReview, type BackendReview, type BackendReviewPage } from './backend-reviews.js';
import { hasPortalMeta, portalMetaOf, type PortalMeta } from './portal-meta.js';
import { changedSettings, fromBackendSettings, hasSettings, settingsOf, toBackendSettings, type BackendSettings, type SettingsPatch } from './seller-settings.js';
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
/** Callers asking at the same moment (two overlapping page renders) share one request. */
function sharedWhileLoading<T>(load: () => Promise<T>): () => Promise<T> {
  let inFlight: Promise<T> | null = null;
  return () => {
    if (inFlight) return inFlight;
    const p = load();
    inFlight = p;
    const done = () => {
      if (inFlight === p) inFlight = null;
    };
    p.then(done, done);
    return p;
  };
}
const localGetSeller = rpc('getSeller');
const localUpdateSeller = rpc('updateSeller');
const saveBackendSettings = (settings: BackendSettings) =>
  backendRequest<{ settings: BackendSettings }>('PUT', 'seller/portal-settings', settings, () => undefined);
let sellerSyncedAt = 0;
/**
 * Brings this device's copy of the store settings (and shop name, description and pickup address) in
 * line with the backend, which every device shares. At most every 15 s. The first device to sync
 * uploads its settings when the backend has none yet.
 */
async function syncSellerFromBackend(): Promise<void> {
  if (!sellerSession.isSignedIn() || Date.now() - sellerSyncedAt < 15_000) return;
  sellerSyncedAt = Date.now();
  try {
    const shop = await backendRequest<{ shop_name: string; description?: string | null; pickup_address?: string | null; portal_settings?: BackendSettings }>(
      'GET',
      'seller/shop-details',
      undefined,
      () => undefined,
    );
    const mine = await localGetSeller();
    if (!hasSettings(shop.portal_settings)) {
      await saveBackendSettings(toBackendSettings(settingsOf(mine))).catch(() => undefined);
      return;
    }
    const patch: SettingsPatch & { shopName?: string; description?: string; pickupAddress?: string } = changedSettings(mine, fromBackendSettings(shop.portal_settings));
    if (shop.shop_name && shop.shop_name.trim().length >= 3 && shop.shop_name !== mine.shopName) patch.shopName = shop.shop_name;
    if (shop.description && shop.description !== mine.description) patch.description = shop.description;
    if (shop.pickup_address && shop.pickup_address.trim().length >= 10 && shop.pickup_address !== mine.pickupAddress) patch.pickupAddress = shop.pickup_address;
    if (Object.keys(patch).length) await localUpdateSeller(patch).catch(() => undefined);
  } catch {
    sellerSyncedAt = 0; // offline or no shop yet: try again next time
  }
}
export const getSeller = sharedWhileLoading(async () => {
  await syncSellerFromBackend();
  return localGetSeller();
});
/**
 * Saves store settings in the portal, then on the backend so every device shows them. If the backend
 * refuses, the portal change is undone.
 */
export const updateSeller = async (patch: Parameters<typeof localUpdateSeller>[0]) => {
  const settings = toBackendSettings(patch as SettingsPatch);
  if (!Object.keys(settings).length || !sellerSession.isSignedIn()) return localUpdateSeller(patch);
  const before = await localGetSeller();
  const after = await localUpdateSeller(patch);
  try {
    await saveBackendSettings(settings);
  } catch (err) {
    const undo = Object.fromEntries(Object.keys(patch).map((k) => [k, (before as unknown as Record<string, unknown>)[k]]));
    await localUpdateSeller(undo as typeof patch).catch(() => undefined);
    throw err;
  }
  return after;
};
const listLocalProducts = rpc('listProducts');
const mergeBackendProducts = rpc('syncBackendProducts');
let productsSyncedAt = 0;
/**
 * The seller's products saved on the backend (Neon), merged into this browser's list before listing,
 * so they appear on any device or address (Vercel and the portal server alike) and after the browser's data is cleared. At most every 15 s;
 * without a server session (or before Step 2, when there is no shop) the local list is used as is.
 */
async function syncProductsFromBackend(): Promise<void> {
  if (!sellerSession.isSignedIn() || Date.now() - productsSyncedAt < 15_000) return;
  productsSyncedAt = Date.now();
  try {
    const items: core.BackendCatalogProduct[] = [];
    for (let offset = 0; ; offset += 100) {
      const page = await backendRequest<{ items: core.BackendCatalogProduct[]; total: number }>(
        'GET',
        `seller/me/products?limit=100&offset=${offset}`,
        undefined,
        () => undefined,
      );
      items.push(...page.items);
      if (items.length >= page.total || page.items.length === 0) break;
    }
    // Products saved before the backend kept the portal's details: a browser that already had them
    // fills them in once, so other devices get them too. Only copies this browser had *before* this
    // sync count: one it has just received knows nothing the backend doesn't (and pushing it would
    // race the device that is saving the product). After that the backend's copy always wins.
    const missing = items.filter((b) => !hasPortalMeta(b.portal));
    const hadBefore = missing.length ? await listLocalProducts({ includeArchived: true }) : [];
    await mergeBackendProducts(items);
    for (const b of missing) {
      const local = hadBefore.find((p) => p.backendId === b.id);
      if (local) await products.setPortal(b.id, portalMetaOf(local)).catch(() => undefined);
    }
  } catch {
    productsSyncedAt = 0; // offline or no shop yet: try again next time
  }
}
/** Makes the next product list pull from the backend at once (after a change on this device). */
export const forgetProductSync = () => {
  productsSyncedAt = 0;
};
export const listProducts: typeof listLocalProducts = (async (...args: Parameters<typeof listLocalProducts>) => {
  await syncProductsFromBackend();
  return listLocalProducts(...args);
}) as typeof listLocalProducts;
export const getProduct = rpc('getProduct');
export const saveProduct = rpc('saveProduct');
export const setProductAvailability = rpc('setProductAvailability');
export const archiveProduct = rpc('archiveProduct');
const localDeleteProduct = rpc('deleteProduct');
const localAdjustStock = rpc('adjustStock');
const NOT_CONNECTED = 'Connect your account to the Mithren server first: enter your password in the banner at the top of the page.';
/** The backend's stock row for a portal variant: by SKU, or none for a single-price product. */
const BACKEND_REASONS: AdjustmentReason[] = ['restock', 'damage', 'correction', 'return', 'csv_import'];
const stockRow = (backendId: string, v: { sku: string; stock: number }, price?: number, reason: AdjustmentReason = 'correction', note = '') => ({
  product_id: backendId,
  ...(v.sku ? { sku: v.sku } : {}),
  stock: v.stock,
  ...(price !== undefined ? { price_paise: Math.round(price * 100) } : {}),
  reason: BACKEND_REASONS.includes(reason) ? reason : 'correction',
  ...(note.trim() ? { note: note.trim().slice(0, 300) } : {}),
});
/**
 * Changes a variant's stock in the portal, then on the backend, so the customer storefront sees the
 * new count (and stops selling at 0). If the backend refuses, the portal change is undone.
 */
export const adjustStock = async (...args: Parameters<typeof localAdjustStock>) => {
  const [productId, variantId, delta, reason, note] = args;
  const before = await getProduct(productId);
  if (before.backendId && !sellerSession.isSignedIn()) throw new ApiError(401, NOT_CONNECTED);
  const after = await localAdjustStock(...args);
  const v = after.variants.find((x) => x.id === variantId);
  if (before.backendId && v) {
    try {
      await products.setStockLevels([stockRow(before.backendId, v, undefined, reason, note)]);
    } catch (err) {
      await localAdjustStock(productId, variantId, -delta, 'correction', 'Undone: the server did not save this change').catch(() => undefined);
      throw err;
    }
  }
  return after;
};
/**
 * Deletes an archived product for good: on the backend first (refused while orders or reviews refer
 * to it; it then stays archived), then from the portal.
 */
export const deleteProduct = async (id: string) => {
  const p = await getProduct(id);
  if (!p.archived) throw new ApiError(409, 'Archive the product before deleting it.');
  if (p.backendId) {
    if (!sellerSession.isSignedIn()) throw new ApiError(401, NOT_CONNECTED);
    try {
      await products.destroy(p.backendId);
    } catch (err) {
      // 404: already gone on the server (deleted elsewhere), so only this browser's copy is left.
      if (!(err instanceof ApiError) || err.status !== 404) throw err;
    }
  }
  return localDeleteProduct(id);
};
const localListAdjustments = rpc('listAdjustments');
interface BackendAdjustment {
  id: string;
  product_id: string;
  sku: string | null;
  delta: number;
  resulting_stock: number;
  reason: AdjustmentReason;
  note: string | null;
  actor: string;
  created_at: string;
}
/** The stock log: from the backend when signed in there (the same on every device), otherwise this browser's. */
export const listAdjustments = async (productId?: string): Promise<InventoryAdjustment[]> => {
  if (!sellerSession.isSignedIn()) return localListAdjustments(productId);
  const mine = await listLocalProducts({ includeArchived: true });
  const byBackend = new Map(mine.filter((p) => p.backendId).map((p) => [p.backendId!, p]));
  const only = productId ? mine.find((p) => p.id === productId)?.backendId : undefined;
  if (productId && !only) return localListAdjustments(productId);
  const rows: BackendAdjustment[] = [];
  for (let offset = 0; offset < 1000; offset += 200) {
    const page = await backendRequest<{ items: BackendAdjustment[]; total: number }>(
      'GET',
      `seller/stock-adjustments?limit=200&offset=${offset}${only ? `&product_id=${encodeURIComponent(only)}` : ''}`,
      undefined,
      () => undefined,
    );
    rows.push(...page.items);
    if (rows.length >= page.total || !page.items.length) break;
  }
  const out: InventoryAdjustment[] = [];
  for (const r of rows) {
    const p = byBackend.get(r.product_id);
    if (!p) continue;
    const v = p.variants.find((x) => x.sku === (r.sku ?? '')) ?? (r.sku ? undefined : p.variants[0]);
    out.push({
      id: r.id,
      sellerId: p.sellerId,
      productId: p.id,
      variantId: v?.id ?? '',
      delta: r.delta,
      resultingStock: r.resulting_stock,
      reason: r.reason,
      note: r.note ?? '',
      actor: r.actor,
      at: r.created_at,
    });
  }
  return out;
};
const localApplyInventoryCsv = rpc('applyInventoryCsv');
/** CSV stock and price import: saved on the backend first (all or nothing), then in the portal. */
export const applyInventoryCsv = async (rows: Parameters<typeof localApplyInventoryCsv>[0]) => {
  const wanted = new Map(rows.map((r) => [r.sku, r]));
  const backendRows = [];
  for (const p of await listLocalProducts({ includeArchived: true })) {
    if (!p.backendId) continue;
    for (const v of p.variants) {
      const r = wanted.get(v.sku);
      if (r) backendRows.push(stockRow(p.backendId, { sku: v.sku, stock: r.stock }, r.price, 'csv_import', 'Bulk CSV update'));
    }
  }
  if (backendRows.length) {
    if (!sellerSession.isSignedIn()) throw new ApiError(401, NOT_CONNECTED);
    for (let i = 0; i < backendRows.length; i += 500) await products.setStockLevels(backendRows.slice(i, i + 500));
  }
  return localApplyInventoryCsv(rows);
};
const localListOrders = rpc('listOrders');
const localGetOrder = rpc('getOrder');
const localTransitionOrder = rpc('transitionOrder');

/** The seller's orders: from the FastAPI backend when signed in there, otherwise the portal's own. */
export const listOrders = (f: core.OrderFilter = {}): Promise<SubOrder[]> => (sellerSession.isSignedIn() ? backendOrders.list(f) : localListOrders(f));
export const getOrder = (id: string): Promise<SubOrder> => (sellerSession.isSignedIn() ? backendOrders.get(id) : localGetOrder(id));
export const transitionOrder = (id: string, to: OrderStatus, note = ''): Promise<SubOrder> =>
  sellerSession.isSignedIn() ? backendOrders.transition(id, to, note) : localTransitionOrder(id, to, note);
// ---------- unsaved product forms ----------
export interface ProductFormDraft {
  data: Record<string, unknown>;
  updatedAt: string;
}
const draftStorageKey = (key: string) => `mithren.productForm:${sellerSession.shopName() ?? 'me'}:${key}`;
/**
 * The product form's unsaved fields, kept on the server (so they survive reloads, cleared site data
 * and other devices) and in this browser (for when the server can't be reached).
 */
export const productDrafts = {
  async load(key: string): Promise<ProductFormDraft | null> {
    let local: ProductFormDraft | null = null;
    try {
      local = JSON.parse(localStorage.getItem(draftStorageKey(key)) ?? 'null');
    } catch {
      /* storage unavailable or unreadable */
    }
    if (!sellerSession.isSignedIn()) return local;
    try {
      const r = await backendRequest<{ data: Record<string, unknown>; updated_at: string }>('GET', `seller/product-drafts/${encodeURIComponent(key)}`, undefined, () => undefined);
      const server = { data: r.data, updatedAt: r.updated_at };
      return local && local.updatedAt > server.updatedAt ? local : server;
    } catch (err) {
      return err instanceof ApiError && err.status === 404 ? null : local;
    }
  },
  async save(key: string, data: Record<string, unknown>): Promise<void> {
    try {
      localStorage.setItem(draftStorageKey(key), JSON.stringify({ data, updatedAt: new Date().toISOString() }));
    } catch {
      /* storage full or unavailable: the server copy still saves */
    }
    if (sellerSession.isSignedIn()) await backendRequest('PUT', `seller/product-drafts/${encodeURIComponent(key)}`, { data }, () => undefined);
  },
  async forget(key: string): Promise<void> {
    try {
      localStorage.removeItem(draftStorageKey(key));
    } catch {
      /* nothing to remove */
    }
    if (sellerSession.isSignedIn()) await backendRequest('DELETE', `seller/product-drafts/${encodeURIComponent(key)}`, undefined, () => undefined).catch(() => undefined);
  },
};
/** TEMPORARY: mark an order picked up or delivered, standing in for the delivery partner. */
export const testDelivery = (id: string, step: 'pickup' | 'deliver'): Promise<SubOrder> => backendOrders.testDelivery(id, step);
export const markItemUnavailable = rpc('markItemUnavailable');
export const getLedger = rpc('getLedger');
export const listSettlements = rpc('listSettlements');
export const listPayoutRequests = rpc('listPayoutRequests');
export const getCommissionRules = rpc('getCommissionRules');
export const requestPayout = rpc('requestPayout');
const localListReviews = rpc('listReviews');
const localReplyToReview = rpc('replyToReview');
const localReportReview = rpc('reportReview');
const reviewField: FieldFor = (loc) => (loc.includes('body') ? 'body' : undefined);
/** Every review of the seller's products: from the FastAPI backend when signed in there, otherwise the portal's own. */
export const listReviews = async (): Promise<Review[]> => {
  if (!sellerSession.isSignedIn()) return localListReviews();
  const sellerId = (await getSeller()).id;
  const all: Review[] = [];
  for (let offset = 0; ; offset += 100) {
    const page = await backendRequest<BackendReviewPage>('GET', `seller/reviews?limit=100&offset=${offset}`, undefined, () => undefined);
    all.push(...page.items.map((r) => toReview(r, sellerId)));
    if (all.length >= page.total || !page.items.length) break;
  }
  return all;
};
/** The seller's public reply (5–600 characters); posting again replaces it. */
export const replyToReview = async (id: string, body: string): Promise<Review> => {
  if (!sellerSession.isSignedIn()) return localReplyToReview(id, body);
  const r = await backendRequest<BackendReview>('POST', `seller/reviews/${encodeURIComponent(id)}/reply`, { body }, reviewField);
  return toReview(r, (await getSeller()).id);
};
/** Flags the review for moderation. */
export const reportReview = async (id: string): Promise<Review> => {
  if (!sellerSession.isSignedIn()) return localReportReview(id);
  const r = await backendRequest<BackendReview>('POST', `seller/reviews/${encodeURIComponent(id)}/report`, { reason: 'other' }, () => undefined);
  return toReview(r, (await getSeller()).id);
};
export const listDocuments = rpc('listDocuments');
const localListNotifications = rpc('listNotifications');
const localMarkNotificationsRead = rpc('markNotificationsRead');
interface BackendNotification {
  id: string;
  topic: 'new_order' | 'order_update';
  title: string;
  body: string;
  order_id: string;
  order_number: string;
  at: string;
  read: boolean;
}
/** Server notifications (new orders, customer cancellations) have ids starting with this. */
const SERVER_NOTIFICATION = 'srv_';
/**
 * The bell's notifications: new orders and customer cancellations from the backend (the same on
 * every device), together with this portal's own (account and listing messages), newest first.
 */
export const listNotifications = async (): Promise<AppNotification[]> => {
  const mine = await localListNotifications();
  if (!sellerSession.isSignedIn()) return mine;
  try {
    const page = await backendRequest<{ items: BackendNotification[]; unread: number }>('GET', 'seller/notifications?limit=30', undefined, () => undefined);
    const sellerId = mine[0]?.sellerId ?? '';
    const fromServer: AppNotification[] = page.items.map((n) => ({
      id: `${SERVER_NOTIFICATION}${n.id}|${n.at}`,
      sellerId,
      topic: n.topic,
      title: n.title,
      body: n.body,
      at: n.at,
      read: n.read,
      link: `/seller/orders/${n.order_id}`,
    }));
    return [...fromServer, ...mine].sort((a, b) => b.at.localeCompare(a.at));
  } catch {
    return mine; // offline: the portal's own notifications still show
  }
};
/** Marks notifications read: all of them, or the ones given (server ones up to the newest given). */
export const markNotificationsRead = async (ids?: string[]): Promise<boolean> => {
  const local = ids?.filter((id) => !id.startsWith(SERVER_NOTIFICATION));
  const server = ids?.filter((id) => id.startsWith(SERVER_NOTIFICATION));
  if (!ids || local!.length) await localMarkNotificationsRead(ids ? local : undefined);
  if (sellerSession.isSignedIn() && (!ids || server!.length)) {
    const upTo = server?.length ? server.map((id) => id.split('|')[1]).sort().pop() : undefined;
    await backendRequest('POST', 'seller/notifications/read', upTo ? { up_to: upTo } : {}, () => undefined).catch(() => undefined);
  }
  return true;
};
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

/**
 * FastAPI backend. Set by <meta name="otp-api" content="...">, which the build fills in from the
 * BACKEND_API_URL environment variable (see scripts/set-backend-url.mjs).
 */
export const OTP_API = (meta('otp-api') ?? 'http://127.0.0.1:8000').replace(/\/+$/, '');
/** Sent on every backend request so an ngrok free-tier tunnel answers with the API, not its warning page. */
const BACKEND_HEADERS: Record<string, string> = { 'ngrok-skip-browser-warning': 'true' };

/** POST /api/v1/auth/{email|phone}-otp/{send|verify}: the backend emails or texts (Fast2SMS) the code. */
async function otpPost<T>(channel: 'email' | 'phone', path: 'send' | 'verify', body: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${OTP_API}/api/v1/auth/${channel}-otp/${path}`, {
      method: 'POST',
      headers: { ...BACKEND_HEADERS, 'Content-Type': 'application/json' },
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
    throw new ApiError(res.status, message, { [`${channel}Code`]: message });
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
  pickup_address?: string | null;
  description?: string | null;
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
/** Fired when a signed-in seller connects to the server, so open pages can enable saving. */
export const SESSION_CONNECTED_EVENT = 'seller-session-connected';

interface StoredTokens {
  access: string;
  refresh: string;
}

// One page load asks for orders several times (sidebar badge, page, tab counts); they share one request.
const ORDERS_REUSE_MS = 3000;
let ordersCache: { at: number; promise: Promise<BackendOrder[]> } | null = null;
const forgetOrders = () => (ordersCache = null);

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
    forgetOrders();
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
        headers: { ...BACKEND_HEADERS, 'Content-Type': 'application/json' },
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
      ...BACKEND_HEADERS,
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

async function backendRequest<T>(method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, body: unknown, fieldFor: FieldFor): Promise<T> {
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
  /** POST /api/v1/products/{id}/archive: hidden from customers and the main list (409 while in an open order). */
  archive: (backendId: string) => backendRequest<BackendProductView>('POST', `products/${encodeURIComponent(backendId)}/archive`, undefined, productField),
  /** POST /api/v1/products/{id}/restore: back in the main list, still switched off. */
  restore: (backendId: string) => backendRequest<BackendProductView>('POST', `products/${encodeURIComponent(backendId)}/restore`, undefined, productField),
  /** PUT /api/v1/products/{id}/availability: live for customers (true) or paused as inactive (false). */
  setAvailability: (backendId: string, available: boolean) =>
    backendRequest<BackendProductView>('PUT', `products/${encodeURIComponent(backendId)}/availability`, { available }, productField),
  /** PATCH /api/v1/products/{id} with the portal's listing details only (merged into the stored ones). */
  setPortal: (backendId: string, portal: PortalMeta) =>
    backendRequest<BackendProductView>('PATCH', `products/${encodeURIComponent(backendId)}`, { portal }, productField),
  /** DELETE /api/v1/products/{id}?permanent=true: gone for good; 409 while orders or reviews refer to it. */
  destroy: (backendId: string) =>
    backendRequest<{ id: string; deleted: boolean }>('DELETE', `products/${encodeURIComponent(backendId)}?permanent=true`, undefined, () => undefined),
  /** POST /api/v1/products/stock-levels: stock (and price) by SKU, all or nothing. */
  setStockLevels: (items: { product_id: string; sku?: string; stock: number; price_paise?: number }[]) =>
    backendRequest<{ updated: number }>('POST', 'products/stock-levels', { items }, () => undefined),
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

function allBackendOrders(): Promise<BackendOrder[]> {
  if (ordersCache && Date.now() - ordersCache.at < ORDERS_REUSE_MS) return ordersCache.promise;
  const promise = (async () => {
    const all: BackendOrder[] = [];
    for (let offset = 0; ; offset += 100) {
      const page = await backendRequest<{ items: BackendOrder[]; total: number }>('GET', `seller/orders?limit=100&offset=${offset}`, undefined, () => undefined);
      all.push(...page.items);
      if (all.length >= page.total || !page.items.length) break;
    }
    return all;
  })();
  ordersCache = { at: Date.now(), promise };
  promise.catch(() => {
    if (ordersCache?.promise === promise) forgetOrders();
  });
  return promise;
}

const backendOrders = {
  /** Every order (a page at a time), then the portal's own tab and search filters. */
  async list(f: core.OrderFilter = {}): Promise<SubOrder[]> {
    const all = await allBackendOrders();
    const q = f.q?.trim().toLowerCase();
    return all
      .map((o) => toSubOrder(o))
      .filter((o) => (!f.status ? true : f.status === 'active' ? ACTIVE.includes(o.status) : f.status === 'issues' ? ISSUES.includes(o.status) : o.status === f.status))
      .filter((o) => (q ? o.id.toLowerCase().includes(q) || o.customer.firstName.toLowerCase().includes(q) : true));
  },
  async get(id: string): Promise<SubOrder> {
    return toSubOrder(await backendRequest<BackendOrder>('GET', `seller/orders/${encodeURIComponent(id)}`, undefined, () => undefined));
  },
  /** TEMPORARY: stands in for the delivery partner (POST /seller/orders/{id}/test-delivery). */
  async testDelivery(id: string, step: 'pickup' | 'deliver'): Promise<SubOrder> {
    forgetOrders();
    try {
      return toSubOrder(await backendRequest<BackendOrder>('POST', `seller/orders/${encodeURIComponent(id)}/test-delivery`, { step }, () => undefined));
    } finally {
      forgetOrders();
    }
  },
  async transition(id: string, to: OrderStatus, note: string): Promise<SubOrder> {
    const status = BACKEND_STATUS[to];
    if (!status) throw new ApiError(409, 'The delivery partner updates this status.');
    const body = { status, ...(note.trim() ? { reason: note.trim() } : {}) };
    forgetOrders();
    try {
      return toSubOrder(await backendRequest<BackendOrder>('PATCH', `seller/orders/${encodeURIComponent(id)}/status`, body, () => undefined));
    } finally {
      forgetOrders();
    }
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

const remoteCheckProduct = rpc('checkProduct');
/**
 * Runs the same checks as saving, without saving, so nothing is sent to the FastAPI catalogue that
 * the portal would then refuse. On the server they run there (they need the seller's other products,
 * e.g. for duplicate SKUs), and the Node server checks again when it saves.
 */
export const checkProduct = async (input: core.ProductInput, submit: boolean): Promise<void> => {
  await remoteCheckProduct(input, submit);
};

/**
 * The signed-in seller's email and full mobile number (account views only have it masked): this
 * browser's account in the preview, otherwise the FastAPI profile.
 */
async function currentContact(): Promise<{ email: string; phone: string }> {
  const who = local ? await local.localAuth.contact() : await backendProfile();
  if (!who) throw new ApiError(401, 'Sign in again to continue.');
  return { email: who.email, phone: who.phone };
}
const otpTarget = async (channel: 'email' | 'phone') => {
  const c = await currentContact();
  return channel === 'email' ? { email: c.email } : { phone: c.phone };
};

async function backendProfile(): Promise<SellerProfileView | null> {
  return sellerSession.isSignedIn() ? backendRequest<SellerProfileView>('GET', 'auth/me', undefined, () => undefined).catch(() => null) : null;
}

/**
 * Server mode: the Node server copies the email/mobile verification recorded by the FastAPI backend
 * onto the portal account (it checks the backend itself). Null without a backend session.
 */
async function syncServerVerification(): Promise<AccountView | null> {
  if (local || !(await backendProfile())) return null; // also refreshes an expired access token
  const t = sellerSession.tokens();
  if (!t) return null;
  return http<{ account: AccountView }>('POST', '/api/auth/sync-verification', { accessToken: t.access }).then(
    (r) => r.account,
    () => null,
  );
}

// ---------- accounts ----------

export interface SellerProfileView {
  user_id: string;
  full_name: string;
  email: string;
  phone: string;
  email_verified: boolean;
  phone_verified: boolean;
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
const resetField: FieldFor = (loc) => ({ email: 'email', otp: 'otp', new_password: 'password' } as Record<string, string>)[String(loc[loc.length - 1])];
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
  current: sharedWhileLoading((): Promise<AccountView | null> => (local ? local.localAuth.current() : http<{ account: AccountView | null }>('GET', '/api/auth/me').then((r) => r.account))),
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
  /**
   * Sends a 6-digit code by email or SMS (both through the FastAPI backend). The code is never returned:
   * the seller reads it from their inbox or phone. Resolves to how long the code lasts.
   */
  sendCode: async (channel: 'email' | 'phone'): Promise<{ expiresInSeconds: number }> => {
    const r = await otpPost<{ expiresInSeconds?: number }>(channel, 'send', await otpTarget(channel));
    return { expiresInSeconds: r.expiresInSeconds ?? 600 };
  },
  /** Step 1, before the account exists: send an OTP to the email or mobile number typed in the form. */
  sendCodeTo: async (channel: 'email' | 'phone', destination: string): Promise<{ expiresInSeconds: number }> => {
    const r = await otpPost<{ expiresInSeconds?: number }>(channel, 'send', { [channel]: destination });
    return { expiresInSeconds: r.expiresInSeconds ?? 600 };
  },
  /** Step 1, before the account exists: check the OTP for that email or mobile number. */
  verifyCodeFor: async (channel: 'email' | 'phone', destination: string, code: string): Promise<void> => {
    await otpPost(channel, 'verify', { [channel]: destination, code });
  },
  /** Records that the signed-in account's email or mobile number was verified (inline, before sign-up). */
  markVerified: async (channel: 'email' | 'phone'): Promise<AccountView> => {
    if (local) return local.localAuth.markVerified(channel);
    const account = (await syncServerVerification()) ?? (await auth.current());
    if (!account) throw new ApiError(401, 'Sign in again to continue.');
    return account;
  },
  verifyCode: async (channel: 'email' | 'phone', code: string): Promise<AccountView> => {
    await otpPost(channel, 'verify', { ...(await otpTarget(channel)), code });
    return auth.markVerified(channel);
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
      const account = await portalSignIn();
      const verified = (await applyServerVerification(profile)) ?? (await syncServerVerification()) ?? account;
      await adoptOnSignIn();
      return verified;
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
      const account = await local.localAuth.markVerified('phone');
      await adoptOnSignIn();
      return account;
    }
  },
  /**
   * Forgot password, step 1: asks the backend to email a 6-digit code. The answer is the same
   * whether or not an account exists, so this never reveals who has an account.
   */
  forgotPassword: async (email: string): Promise<{ expiresInSeconds: number }> => {
    const r = local
      ? await backendRequest<{ expiresInSeconds?: number }>('POST', 'auth/forgot-password', { email }, resetField)
      : await http<{ expiresInSeconds?: number }>('POST', '/api/auth/forgot-password', { email });
    return { expiresInSeconds: Number(r.expiresInSeconds) > 0 ? Number(r.expiresInSeconds) : 600 };
  },
  /** Forgot password, step 2: sets the new password with the emailed code. Old sessions stop working. */
  resetPassword: async (email: string, otp: string, newPassword: string): Promise<void> => {
    sellerSession.clear();
    if (!local) return void (await http('POST', '/api/auth/reset-password', { email, otp, newPassword }));
    await backendRequest('POST', 'auth/reset-password', { email, otp, new_password: newPassword }, resetField);
    await local.localAuth.setPassword(email, newPassword);
  },
  /** Revokes the server session (best effort), forgets the tokens and signs out of the portal. */
  signOut: async (): Promise<void> => {
    const t = sellerSession.tokens();
    sellerSession.clear();
    if (t) await backendRequest<void>('POST', 'auth/logout', { refresh_token: t.refresh }, () => undefined).catch(() => undefined);
    return local ? local.localAuth.signOut() : http<void>('POST', '/api/auth/signout');
  },
  /**
   * True when someone is signed in to the portal but has no server session, so nothing can be saved
   * to the catalogue: accounts made before server sign-in existed, or a session from before the
   * fix. The preview demo account never has one.
   */
  needsConnection: (account: AccountView | null): boolean =>
    !!local && !!account && !sellerSession.isSignedIn() && !(PREVIEW_DEMO && account.email.toLowerCase() === PREVIEW_DEMO.email),
  /**
   * Connects the signed-in portal account to the server with its password: signs in there, or for
   * an account the server doesn't know, creates its login and claims the shop this browser saved.
   */
  connect: async (password: string): Promise<void> => {
    const who = local ? await local.localAuth.contact() : null;
    if (!who) throw new ApiError(401, 'Sign in again to continue.');
    try {
      await backendSignIn(who.email, password);
    } catch (e) {
      if (!(e instanceof ApiError) || e.status !== 401) throw e;
      if (!local) throw e;
      // Check the password against this browser's account before creating a server login with it.
      try {
        await local.localAuth.signIn(who.email, password);
      } catch {
        throw new ApiError(401, 'That password is incorrect.', { password: 'That password is incorrect.' });
      }
      await connectToServer(password);
      if (!sellerSession.isSignedIn())
        throw new ApiError(409, 'A server login with a different password already exists for this email or mobile number. Enter that password.');
    }
    // Signed in to the portal while the server was unreachable: take over the server's approval and
    // details now, as a normal sign-in would have.
    await adoptOnSignIn();
    window.dispatchEvent(new CustomEvent(SESSION_CONNECTED_EVENT));
  },
  /**
   * Checks the stored tokens with the server once per page load (refreshing them if needed) and
   * updates the shop name. Tokens the server no longer accepts end the session (SESSION_EXPIRED_EVENT).
   */
  verifySession: async (): Promise<boolean> => {
    if (!sellerSession.isSignedIn()) return false;
    try {
      const me = await backendRequest<SellerProfileView>('GET', 'auth/me', undefined, () => undefined);
      sellerSession.setShopName(me.shop_name);
      return true;
    } catch {
      return sellerSession.isSignedIn(); // a network error keeps the tokens; a rejected session cleared them
    }
  },
  /**
   * Copies the server's email/mobile verification onto this browser's account, so a seller who
   * verified once is not asked for OTPs again. Returns the account (updated or not).
   */
  refreshVerification: async (account: AccountView): Promise<AccountView> => {
    if (account.emailVerified && account.phoneVerified) return account;
    if (!local) return (await syncServerVerification()) ?? account;
    return (await applyServerVerification(await backendProfile())) ?? account;
  },
  /** The signed-in seller's server profile (GET /api/v1/auth/me), or null without a server session. */
  me: (): Promise<SellerProfileView | null> =>
    sellerSession.isSignedIn() ? backendRequest<SellerProfileView>('GET', 'auth/me', undefined, () => undefined) : Promise.resolve(null),
};

async function applyServerVerification(profile: SellerProfileView | null): Promise<AccountView | null> {
  if (!local || !profile) return null;
  let account = await local.localAuth.current();
  if (!account || account.email.toLowerCase() !== profile.email.toLowerCase()) return null;
  if (profile.email_verified && !account.emailVerified) account = await local.localAuth.markVerified('email');
  if (profile.phone_verified && !account.phoneVerified) account = await local.localAuth.markVerified('phone');
  return account;
}

// ---------- seller application ----------
interface ServerDraft {
  current_step: number;
  data: Record<string, unknown>;
  updated_at: string;
}

/**
 * Browser mode: when the backend already has this seller approved (the application was completed
 * on another device or through the portal server), take over its approval and details instead of
 * showing an empty application. Null when there's nothing to take over.
 */
async function adoptServerApproval(view: ApplicationView): Promise<ApplicationView | null> {
  if (!local || view.status === 'approved' || view.status === 'suspended') return null;
  const profile = await backendProfile();
  if (profile?.approval_status !== 'approved' || !profile.seller_id) return null;
  const quiet = <T,>(path: string) => backendRequest<T>('GET', path, undefined, () => undefined).catch(() => null);
  const [shop, bank, draft] = await Promise.all([
    quiet<ShopDetailsView & { pickup_address?: string | null; description?: string | null }>('seller/shop-details'),
    quiet<{ account_holder_name: string; ifsc_code: string; last_4_digits: string; updated_at: string }>('seller/bank-details'),
    quiet<ServerDraft>('seller/registration-draft'),
  ]);
  const data: Record<string, unknown> = { ...(draft?.data ?? {}) };
  if (shop) {
    const set = (key: string, value: string | null | undefined) => {
      if (value) data[key] = value;
    };
    set('shopName', shop.shop_name);
    set('ownerName', shop.owner_name);
    set('businessEmail', shop.email);
    set('primaryPhone', shop.phone);
    set('addressLine1', shop.address_line1);
    set('city', shop.city);
    set('state', shop.state);
    set('pincode', shop.pincode);
    set('pan', shop.pan_number);
    set('gstin', shop.gstin);
    set('pickupAddress', shop.pickup_address);
    set('description', shop.description);
  }
  const bankView = bank ? { holderName: bank.account_holder_name, last4: bank.last_4_digits, ifsc: bank.ifsc_code, bankName: '', updatedAt: bank.updated_at } : null;
  return local.localApplication.adoptServerApproval(data, bankView);
}

/** At sign-in, so the first page already shows the backend's approval (browser mode only). */
async function adoptOnSignIn(): Promise<void> {
  if (!local) return;
  await adoptServerApproval(await local.localApplication.get()).catch(() => null);
}

/** Saves the wizard's progress on the backend too (best effort), so it survives cleared browser data. */
async function saveServerDraft(view: ApplicationView, evenWhenLocked = false): Promise<void> {
  if (!sellerSession.isSignedIn() || (!view.editable && !evenWhenLocked)) return;
  const step = Math.min(8, Math.max(1, view.currentStep));
  await backendRequest('PUT', 'seller/registration-draft', { current_step: step, data: view.data }, () => undefined).catch(() => undefined);
}

export const application = {
  /**
   * The application in this browser. When the backend has newer progress (another device, or this
   * browser's data was cleared), it is restored into this browser first.
   */
  get: async (): Promise<ApplicationView> => {
    if (!local) return http('GET', '/api/application');
    const view = await local.localApplication.get();
    if (!sellerSession.isSignedIn()) return view;
    const adopted = await adoptServerApproval(view);
    if (adopted) return adopted;
    if (!view.editable) return view;
    try {
      const remote = await backendRequest<ServerDraft>('GET', 'seller/registration-draft', undefined, () => undefined);
      // A copy this browser has never saved (just recreated after its data was cleared) always yields to the server's.
      const pristine = Date.parse(view.updatedAt) <= Date.parse(view.createdAt);
      const newer = pristine || Date.parse(remote.updated_at) > Date.parse(view.updatedAt) || remote.current_step > view.currentStep;
      if (newer) {
        return await local.localApplication.saveDraft(
          { ...(view.data as unknown as Record<string, unknown>), ...remote.data },
          Math.max(remote.current_step, view.currentStep),
          null,
        );
      }
    } catch {
      /* nothing saved on the server yet, or offline: keep this browser's copy */
    }
    return view;
  },
  saveDraft: async (data: unknown, nextStep: number, validateStep: number | null): Promise<ApplicationView> => {
    if (!local) {
      // The portal server keeps the application; a copy on the backend lets other devices restore it.
      const saved = await http<ApplicationView>('PUT', '/api/application', { data, nextStep, validateStep });
      await saveServerDraft(saved);
      return saved;
    }
    const view = await local.localApplication.saveDraft(data, nextStep, validateStep);
    await saveServerDraft(view);
    return view;
  },
  saveBank: (input: BankInput): Promise<ApplicationView> => (local ? local.localApplication.saveBank(input) : http('PUT', '/api/application/bank', input)),
  uploadDocument: (kind: ApplicationDocKind, file: File, cert?: Record<string, string>): Promise<ApplicationView> => {
    if (local) return local.localApplication.uploadDocument(kind, file, cert);
    const q = new URLSearchParams({ kind, name: file.name, ...(cert ?? {}) });
    return http('POST', `/api/application/documents?${q}`, undefined, { data: file, type: file.type });
  },
  submit: async (idempotencyKey: string): Promise<ApplicationView> => {
    const view = local ? await local.localApplication.submit(idempotencyKey) : await http<ApplicationView>('POST', '/api/application/submit', { idempotencyKey });
    await saveServerDraft(view, true);
    return view;
  },
  /** Private file link for the owner (server only; the preview keeps no files). */
  fileUrl: (documentId: string): string | null => (REMOTE ? `/api/documents/${encodeURIComponent(documentId)}/file` : null),
};

/** Preview-only stand-in for Super Admin review actions. Undefined on the server. */
export const previewAdmin: null | { decide(action: AdminAction, message: string, requestedItems?: string[]): Promise<void>; reviewOrganic(decision: 'verified' | 'rejected', note: string): Promise<void> } = local ? local.localAdmin : null;
export const PREVIEW_DEMO = local ? { email: local.DEMO_EMAIL, password: local.DEMO_PASSWORD } : null;
