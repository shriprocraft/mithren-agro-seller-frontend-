// Mock API for the frontend-only phase.
//
// Every function behaves like a call to the production backend would:
// it is async, it scopes every read and write to the signed-in seller
// (mirroring server-side ownership checks), it returns 404 rather than 403
// for other sellers' records so existence isn't leaked, and it never accepts
// client-supplied prices for orders, commissions, payout states or owner IDs.
//
// Data is held in memory and mirrored to localStorage only so the demo keeps
// its state across reloads. In production this module is replaced by HTTP
// calls; the UI does not need to change.

import { createSeed, createEmptySeed, buildLedgerEntry, DB_VERSION, SELLER_A, round2, type DB } from './data/seed.js';
import { canSellerTransition, slugify, GSTIN_RE, PAN_RE, SKU_RE, ACTIVE_STATUSES } from './lib.js';
import type {
  AdjustmentReason,
  AppNotification,
  DocumentType,
  InventoryAdjustment,
  LedgerEntry,
  OrderStatus,
  PayoutRequest,
  Product,
  Review,
  Seller,
  SellerDocument,
  SellerStatus,
  Settlement,
  SubOrder,
  Variant,
} from './types.js';

const STORAGE_KEY = 'organic-seller-portal-db';
const DAY = 86_400_000;

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public fieldErrors: Record<string, string> = {},
  ) {
    super(message);
  }
}

// ---------- persistence ----------
function load(): DB {
  try {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as DB;
        if (parsed.version === DB_VERSION) return parsed;
      }
    }
  } catch {
    /* storage unavailable or corrupt: fall back to an empty dataset */
  }
  return createEmptySeed();
}

let db: DB = load();

function persist() {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
  } catch {
    /* ignore quota / privacy-mode errors; the in-memory copy stays authoritative */
  }
  listeners.forEach((l) => l());
}

const listeners = new Set<() => void>();
export function onDataChange(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// ---------- session & simulation controls ----------
interface Session {
  sellerId: string;
  actorName: string;
}
let session: Session = { sellerId: SELLER_A, actorName: 'Ananya K.' };

export const sim = {
  latencyMs: typeof window === 'undefined' ? 0 : 280,
  failWrites: false,
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function call<T>(fn: () => T, write = false): Promise<T> {
  if (sim.latencyMs) await sleep(sim.latencyMs * (0.6 + Math.random() * 0.8));
  if (write && sim.failWrites) throw new ApiError(503, 'Network error — your change was not saved. Check your connection and try again.');
  const result = fn();
  if (write) persist();
  // Return copies so UI code can never mutate the "server" state directly.
  return structuredClone(result);
}

const me = () => {
  const s = db.sellers.find((x) => x.id === session.sellerId);
  if (!s) throw new ApiError(401, 'Your session has expired. Please sign in again.');
  return s;
};

function requireApproved(action: string) {
  const s = me();
  if (s.status === 'suspended') throw new ApiError(403, `Your account is suspended, so you can’t ${action}. Contact seller support.`);
  if (s.status !== 'approved') throw new ApiError(403, `You can ${action} once your seller account is approved.`);
}

const uid = (p: string) => `${p}_${Math.random().toString(36).slice(2, 9)}`;
const nowIso = () => new Date().toISOString();

function notify(n: Omit<AppNotification, 'id' | 'sellerId' | 'at' | 'read'>, sellerId = session.sellerId) {
  db.notifications.unshift({ id: uid('n'), sellerId, at: nowIso(), read: false, ...n });
}

/** Prototype-only: switch which seller is "signed in" (used by isolation tests). */
export function _setSessionForTesting(sellerId: string, actorName = 'Test') {
  session = { sellerId, actorName };
}

/** Clear all business data (products, orders, earnings, reviews, …) for every seller. */
export function clearAllData() {
  db = createEmptySeed();
  session = { sellerId: SELLER_A, actorName: 'Ananya K.' };
  persist();
}

/** Load the sample dataset (used by tests and demos). */
export function resetDemoData() {
  db = createSeed();
  session = { sellerId: SELLER_A, actorName: 'Ananya K.' };
  persist();
}

// ---------- seller profile ----------
export const getSeller = () => call(() => me());

type EditableSeller = Pick<
  Seller,
  | 'shopName'
  | 'description'
  | 'pickupAddress'
  | 'serviceAreas'
  | 'workingHours'
  | 'holidays'
  | 'fulfilment'
  | 'notifications'
  | 'brandColor'
  | 'bannerTagline'
  | 'staff'
>;

export function updateSeller(patch: Partial<EditableSeller>) {
  return call(() => {
    const s = me();
    if (s.status === 'suspended') throw new ApiError(403, 'Your account is suspended. Settings are read-only.');
    const errors: Record<string, string> = {};
    if (patch.shopName !== undefined && patch.shopName.trim().length < 3) errors.shopName = 'Shop name must be at least 3 characters.';
    if (patch.pickupAddress !== undefined && patch.pickupAddress.trim().length < 10) errors.pickupAddress = 'Enter a complete pickup address.';
    if (patch.serviceAreas !== undefined && patch.serviceAreas.length === 0) errors.serviceAreas = 'Add at least one service area.';
    if (patch.fulfilment && (patch.fulfilment.acceptWindowMins < 5 || patch.fulfilment.acceptWindowMins > 120))
      errors.acceptWindowMins = 'Acceptance window must be between 5 and 120 minutes.';
    if (Object.keys(errors).length) throw new ApiError(422, 'Please fix the highlighted fields.', errors);
    // Whitelist: only editable keys are applied, whatever the client sends.
    const allowed: (keyof EditableSeller)[] = ['shopName', 'description', 'pickupAddress', 'serviceAreas', 'workingHours', 'holidays', 'fulfilment', 'notifications', 'brandColor', 'bannerTagline', 'staff'];
    for (const k of allowed) if (patch[k] !== undefined) (s as unknown as Record<string, unknown>)[k] = patch[k];
    if (patch.shopName) s.slug = slugify(patch.shopName);
    return s;
  }, true);
}

/** Prototype control standing in for the Admin review workflow. */
export function _demoSetSellerStatus(status: SellerStatus) {
  return call(() => {
    const s = me();
    s.status = status;
    const messages: Partial<Record<SellerStatus, string>> = {
      changes_requested: 'Please upload a clearer copy of your address proof (the current scan is cropped) and confirm your FSSAI registration number.',
      rejected: 'We could not verify the business address provided. You may re-apply after 30 days with updated documents.',
      suspended: 'Your account has been temporarily suspended after repeated late deliveries. Contact seller support to resolve.',
    };
    if (messages[status]) s.reviewMessage = messages[status];
    else delete s.reviewMessage;
    if (status !== 'approved' && status !== 'not_registered') notify({ topic: 'moderation', title: `Account status: ${status.replace('_', ' ')}`, body: s.reviewMessage ?? 'Your application status changed.', link: '/seller' });
    return s;
  }, true);
}

export interface Application {
  shopName: string;
  ownerName: string;
  email: string;
  phone: string;
  address: string;
  pickupAddress: string;
  serviceAreas: string[];
  productTypes: string[];
  description: string;
  gstin?: string;
  pan: string;
  bankAccountName: string;
  bankAccountNumber: string;
  ifsc: string;
  documents: { type: DocumentType; fileName: string; mimeType: string; sizeKb: number }[];
  claimsOrganic: boolean;
}

export function submitApplication(app: Application) {
  return call(() => {
    const s = me();
    const errors: Record<string, string> = {};
    if (app.gstin && !GSTIN_RE.test(app.gstin)) errors.gstin = 'GSTIN format is invalid.';
    if (!PAN_RE.test(app.pan)) errors.pan = 'PAN format is invalid.';
    if (!app.documents.some((d) => d.type === 'pan')) errors.doc_pan = 'PAN card copy is required.';
    if (!app.documents.some((d) => d.type === 'bank_proof')) errors.doc_bank_proof = 'Bank proof is required.';
    if (app.claimsOrganic && !app.documents.some((d) => d.type === 'organic_cert')) errors.doc_organic_cert = 'Upload a certificate, or untick the organic claim.';
    if (Object.keys(errors).length) throw new ApiError(422, 'Please fix the highlighted fields.', errors);
    Object.assign(s, {
      shopName: app.shopName,
      slug: slugify(app.shopName),
      ownerName: app.ownerName,
      email: app.email,
      address: app.address,
      pickupAddress: app.pickupAddress,
      serviceAreas: app.serviceAreas,
      productTypes: app.productTypes,
      description: app.description,
      gstin: app.gstin || undefined,
      pan: app.pan,
      // Only a masked form of the account number is kept client-side.
      bank: { accountName: app.bankAccountName, last4: app.bankAccountNumber.slice(-4), ifsc: app.ifsc, verified: false },
      status: 'submitted' as SellerStatus,
      emailVerified: true,
      phoneVerified: true,
    });
    delete s.reviewMessage;
    db.documents = db.documents.filter((d) => d.sellerId !== s.id);
    for (const d of app.documents) db.documents.push({ id: uid('d'), sellerId: s.id, uploadedAt: nowIso(), status: 'pending', ...d });
    notify({ topic: 'moderation', title: 'Application received', body: 'Our team usually reviews applications within 2 business days.', link: '/seller' });
    return s;
  }, true);
}

// ---------- products ----------
export interface ProductFilter {
  q?: string;
  status?: string;
  category?: string;
  includeArchived?: boolean;
}

export function listProducts(f: ProductFilter = {}) {
  return call(() =>
    db.products
      .filter((p) => p.sellerId === session.sellerId)
      .filter((p) => (f.includeArchived ? true : !p.archived))
      .filter((p) => (f.status ? (f.status === 'archived' ? p.archived : p.status === f.status) : true))
      .filter((p) => (f.category ? p.category === f.category : true))
      .filter((p) => {
        if (!f.q) return true;
        const q = f.q.toLowerCase();
        return p.name.toLowerCase().includes(q) || p.variants.some((v) => v.sku.toLowerCase().includes(q));
      })
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
  );
}

function ownedProduct(id: string) {
  const p = db.products.find((x) => x.id === id && x.sellerId === session.sellerId);
  if (!p) throw new ApiError(404, 'Product not found.');
  return p;
}

export const getProduct = (id: string) => call(() => ownedProduct(id));

export type ProductInput = Omit<Product, 'id' | 'sellerId' | 'status' | 'moderationNote' | 'archived' | 'updatedAt'> & { id?: string };

function validateProduct(input: ProductInput, submitting: boolean): Record<string, string> {
  const e: Record<string, string> = {};
  if (input.name.trim().length < 3) e.name = 'Name must be at least 3 characters.';
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(input.slug)) e.slug = 'Use lowercase letters, numbers and hyphens only.';
  else if (db.products.some((p) => p.slug === input.slug && p.sellerId === session.sellerId && p.id !== input.id)) e.slug = 'You already have a product with this slug.';
  if (!input.category) e.category = 'Choose a category.';
  if (input.variants.length === 0) e.variants = 'Add at least one variant.';
  const skus = new Set<string>();
  input.variants.forEach((v, i) => {
    if (!v.label.trim()) e[`variant_${i}_label`] = 'Label is required.';
    if (!SKU_RE.test(v.sku)) e[`variant_${i}_sku`] = '3–32 chars: A–Z, 0–9, hyphen.';
    else if (skus.has(v.sku)) e[`variant_${i}_sku`] = 'Duplicate SKU.';
    else if (db.products.some((p) => p.sellerId === session.sellerId && p.id !== input.id && p.variants.some((x) => x.sku === v.sku))) e[`variant_${i}_sku`] = 'SKU used by another product.';
    skus.add(v.sku);
    if (!(v.packSize > 0)) e[`variant_${i}_packSize`] = 'Must be > 0.';
    if (!(v.price > 0)) e[`variant_${i}_price`] = 'Must be > 0.';
    if (v.mrp !== undefined && v.mrp < v.price) e[`variant_${i}_mrp`] = 'MRP can’t be below price.';
    if (!Number.isInteger(v.stock) || v.stock < 0) e[`variant_${i}_stock`] = 'Whole number ≥ 0.';
  });
  if (!(input.minQty >= 1)) e.minQty = 'Minimum is 1.';
  if (input.maxQty < input.minQty) e.maxQty = 'Must be ≥ minimum quantity.';
  if (input.seasonality === 'seasonal' && input.seasonMonths.length === 0) e.seasonMonths = 'Pick the months this product is in season.';
  if (input.harvestDate && input.packedDate && input.packedDate < input.harvestDate) e.packedDate = 'Packed date can’t be before harvest date.';
  if (input.harvestDate && input.harvestDate > new Date().toISOString().slice(0, 10)) e.harvestDate = 'Harvest date can’t be in the future.';
  if (submitting) {
    if (input.description.trim().length < 20) e.description = 'Write at least 20 characters so customers know what they’re buying.';
    if (!input.origin.trim()) e.origin = 'Origin is required for listings.';
    if (!input.storage.trim()) e.storage = 'Storage guidance is required for listings.';
    if (input.organicClaim !== 'none') {
      const cert = db.documents.find((d) => d.id === input.certificateId && d.sellerId === session.sellerId && d.type === 'organic_cert');
      if (!cert) e.certificateId = 'Link an organic certificate to make an organic claim.';
      else if (cert.expiresAt && cert.expiresAt < new Date().toISOString().slice(0, 10)) e.certificateId = 'This certificate has expired.';
    }
  }
  return e;
}

/**
 * Save a product. `submit` sends it for moderation; otherwise it is saved as a draft
 * (or, for an already-approved product, only non-moderated fields change).
 */
export function saveProduct(input: ProductInput, submit: boolean) {
  return call(() => {
    const s = me();
    if (s.status === 'suspended') throw new ApiError(403, 'Your account is suspended. Listings are read-only.');
    if (submit && s.status !== 'approved') throw new ApiError(403, 'You can save drafts now, but listings can only be submitted for approval once your seller account is approved.');
    const errors = validateProduct(input, submit);
    if (Object.keys(errors).length) throw new ApiError(422, 'Please fix the highlighted fields.', errors);

    let p = input.id ? ownedProduct(input.id) : undefined;
    const { id: _ignored, ...fields } = input;
    void _ignored;
    // Live listings keep their status unless a moderated field changed.
    const moderated: (keyof ProductInput)[] = ['name', 'description', 'category', 'organicClaim', 'certificateId', 'origin'];
    const wasLive = !!p && (p.status === 'approved' || p.status === 'inactive');
    const needsReview = !p || !wasLive || moderated.some((k) => (p as Product)[k as keyof Product] !== fields[k as keyof typeof fields]);
    if (!p) {
      p = { ...fields, id: uid('p'), sellerId: s.id, status: 'draft', archived: false, updatedAt: nowIso() };
      db.products.unshift(p);
      for (const v of p.variants) if (v.stock > 0) logAdjustment(p, v, v.stock, 'restock', 'Opening stock');
    } else {
      // Stock is managed through the audited inventory endpoint, not the edit form.
      const stockById = new Map(p.variants.map((v) => [v.id, v.stock]));
      const variants = fields.variants.map((v) => ({ ...v, stock: stockById.get(v.id) ?? v.stock }));
      for (const v of variants) if (!stockById.has(v.id) && v.stock > 0) logAdjustment(p, v, v.stock, 'restock', 'Opening stock (new variant)');
      Object.assign(p, fields, { variants, updatedAt: nowIso() });
    }
    if (submit && needsReview) {
      p.status = 'pending';
      p.available = true;
      delete p.moderationNote;
    } else if (submit && wasLive) {
      /* price, limits and storage changes apply immediately */
    } else if (p.status === 'rejected' || p.status === 'draft') {
      p.status = 'draft';
    }
    return p;
  }, true);
}

export function setProductAvailability(id: string, available: boolean) {
  return call(() => {
    requireApproved('change availability');
    const p = ownedProduct(id);
    if (available && p.status === 'inactive') p.status = 'approved';
    if (!available && p.status === 'approved') p.status = 'inactive';
    p.available = available;
    p.updatedAt = nowIso();
    return p;
  }, true);
}

export function archiveProduct(id: string, archived = true) {
  return call(() => {
    const p = ownedProduct(id);
    if (archived && db.orders.some((o) => o.sellerId === session.sellerId && ACTIVE_STATUSES.includes(o.status) && o.items.some((i) => i.productId === id)))
      throw new ApiError(409, 'This product is part of an active order. Archive it after those orders are fulfilled.');
    p.archived = archived;
    p.available = !archived && p.available;
    p.updatedAt = nowIso();
    return p;
  }, true);
}

// ---------- inventory ----------
function logAdjustment(p: Product, v: Variant, delta: number, reason: AdjustmentReason, note: string) {
  const entry: InventoryAdjustment = {
    id: uid('adj'),
    sellerId: p.sellerId,
    productId: p.id,
    variantId: v.id,
    delta,
    resultingStock: v.stock,
    reason,
    note,
    actor: reason === 'order' || reason === 'order_cancelled' ? 'System' : session.actorName,
    at: nowIso(),
  };
  db.adjustments.unshift(entry);
  if (delta < 0 && v.stock <= p.lowStockThreshold && v.stock + -delta > p.lowStockThreshold)
    notify({ topic: 'low_stock', title: `Low stock: ${p.name} (${v.label})`, body: `${v.stock} left.`, link: '/seller/inventory?filter=low' }, p.sellerId);
}

export function adjustStock(productId: string, variantId: string, delta: number, reason: AdjustmentReason, note: string) {
  return call(() => {
    if (me().status === 'suspended') throw new ApiError(403, 'Your account is suspended. Inventory is read-only.');
    const p = ownedProduct(productId);
    const v = p.variants.find((x) => x.id === variantId);
    if (!v) throw new ApiError(404, 'Variant not found.');
    if (!Number.isInteger(delta) || delta === 0) throw new ApiError(422, 'Enter a whole-number change other than 0.', { delta: 'Enter a whole number other than 0.' });
    if (v.stock + delta < 0) throw new ApiError(422, `Stock can’t go below 0 (currently ${v.stock}).`, { delta: `Max decrease is ${v.stock}.` });
    if (['damage', 'correction'].includes(reason) && !note.trim()) throw new ApiError(422, 'Add a note explaining this adjustment.', { note: 'A note is required for damage and corrections.' });
    v.stock += delta;
    p.updatedAt = nowIso();
    logAdjustment(p, v, delta, reason, note.trim());
    return p;
  }, true);
}

export const listAdjustments = (productId?: string) =>
  call(() =>
    db.adjustments
      .filter((a) => a.sellerId === session.sellerId && (!productId || a.productId === productId))
      .sort((a, b) => b.at.localeCompare(a.at)),
  );

export function applyInventoryCsv(rows: { sku: string; stock: number; price?: number }[]) {
  return call(() => {
    if (me().status === 'suspended') throw new ApiError(403, 'Your account is suspended. Inventory is read-only.');
    let updated = 0;
    for (const r of rows) {
      for (const p of db.products) {
        if (p.sellerId !== session.sellerId) continue; // ownership re-checked server-side
        const v = p.variants.find((x) => x.sku === r.sku);
        if (!v) continue;
        const delta = r.stock - v.stock;
        if (delta !== 0) {
          v.stock = r.stock;
          logAdjustment(p, v, delta, 'csv_import', 'Bulk CSV update');
        }
        if (r.price !== undefined && r.price !== v.price) v.price = r.price;
        p.updatedAt = nowIso();
        updated++;
      }
    }
    return { updated };
  }, true);
}

// ---------- orders ----------
export interface OrderFilter {
  status?: string;
  q?: string;
}

export function listOrders(f: OrderFilter = {}) {
  return call(() =>
    db.orders
      .filter((o) => o.sellerId === session.sellerId)
      .filter((o) => {
        if (!f.status) return true;
        if (f.status === 'active') return ACTIVE_STATUSES.includes(o.status);
        if (f.status === 'issues') return ['cancelled', 'rejected', 'return_requested', 'returned'].includes(o.status);
        return o.status === f.status;
      })
      .filter((o) => (f.q ? o.id.toLowerCase().includes(f.q.toLowerCase()) || o.customer.firstName.toLowerCase().includes(f.q.toLowerCase()) : true))
      .map(redactOrder),
  );
}

/** Full delivery address is only needed (and shown) once the seller has accepted the order. */
function redactOrder(o: SubOrder): SubOrder {
  const revealed = !['awaiting_confirmation', 'rejected'].includes(o.status) && !['delivered', 'returned', 'cancelled'].includes(o.status);
  return revealed ? o : { ...o, customer: { ...o.customer, address: '— shown while the order is being fulfilled —', phoneMasked: '+91 •••••• ••••' } };
}

function ownedOrder(id: string) {
  const o = db.orders.find((x) => x.id === id && x.sellerId === session.sellerId);
  if (!o) throw new ApiError(404, 'Order not found.');
  return o;
}

export const getOrder = (id: string) => call(() => redactOrder(ownedOrder(id)));

function restock(o: SubOrder, reasonNote: string) {
  for (const it of o.items) {
    if (it.unavailable) continue;
    const p = db.products.find((x) => x.id === it.productId && x.sellerId === o.sellerId);
    const v = p?.variants.find((x) => x.id === it.variantId);
    if (p && v) {
      v.stock += it.qty;
      logAdjustment(p, v, it.qty, 'order_cancelled', `${o.id}: ${reasonNote}`);
    }
  }
}

export function transitionOrder(id: string, to: OrderStatus, note = '') {
  return call(() => {
    requireApproved('update orders');
    const o = ownedOrder(id);
    if (!canSellerTransition(o.status, to)) throw new ApiError(409, `This order is “${o.status.replace(/_/g, ' ')}” and can’t be moved to “${to.replace(/_/g, ' ')}”. It may have been updated elsewhere — refresh to see the latest state.`);
    if ((to === 'rejected' || to === 'cancelled') && !note.trim()) throw new ApiError(422, 'A reason is required.', { note: 'Tell the customer why.' });
    o.status = to;
    o.history.push({ status: to, at: nowIso(), actor: `${session.actorName} (seller)`, ...(note.trim() ? { note: note.trim() } : {}) });
    if (to === 'rejected' || to === 'cancelled') {
      o.reason = note.trim();
      restock(o, note.trim());
      // Refund is initiated by the payment workflow, not by the seller.
      if (o.paymentMethod === 'online') o.paymentStatus = 'refund_pending';
    }
    return redactOrder(o);
  }, true);
}

export function markItemUnavailable(id: string, sku: string) {
  return call(() => {
    requireApproved('update orders');
    const o = ownedOrder(id);
    if (!['awaiting_confirmation', 'accepted'].includes(o.status)) throw new ApiError(409, 'Items can only be marked unavailable before packing.');
    const it = o.items.find((i) => i.sku === sku);
    if (!it || it.unavailable) throw new ApiError(404, 'Item not found.');
    if (o.items.filter((i) => !i.unavailable).length === 1) throw new ApiError(409, 'This is the only remaining item — reject the order instead.');
    it.unavailable = true;
    const p = db.products.find((x) => x.id === it.productId && x.sellerId === o.sellerId);
    const v = p?.variants.find((x) => x.id === it.variantId);
    if (p && v) {
      v.stock += it.qty;
      logAdjustment(p, v, it.qty, 'order_cancelled', `${o.id}: item marked unavailable`);
    }
    o.history.push({ status: o.status, at: nowIso(), actor: `${session.actorName} (seller)`, note: `${it.name} (${it.variantLabel}) marked unavailable. Partial refund requested from the payment workflow.` });
    if (o.paymentMethod === 'online') o.paymentStatus = 'refund_pending';
    return redactOrder(o);
  }, true);
}

/** Prototype control standing in for checkout. Prices come from the catalogue, never from the client. */
export function _demoSimulateNewOrder() {
  return call(() => {
    const s = me();
    const live = db.products.filter((p) => p.sellerId === s.id && p.status === 'approved' && p.available && !p.archived && p.variants.some((v) => v.stock > 0));
    if (!live.length) throw new ApiError(409, 'You have no live, in-stock products, so customers can’t order.');
    const p = live[Math.floor(Math.random() * live.length)]!;
    const v = p.variants.find((x) => x.stock > 0)!;
    const qty = Math.min(v.stock, 1 + Math.floor(Math.random() * 2));
    v.stock -= qty;
    const n = 49000 + Math.floor(Math.random() * 900);
    const o: SubOrder = {
      id: `SO-${n}-GV`,
      parentOrderId: `ORD-${n}`,
      sellerId: s.id,
      placedAt: nowIso(),
      deliverySlot: '5–7 PM',
      customer: { firstName: 'Riya', area: s.serviceAreas[0] ?? 'Local', phoneMasked: '+91 •••••• 7781', address: 'Flat 304, Orchid Heights', instructions: 'Call on arrival' },
      items: [{ productId: p.id, variantId: v.id, name: p.name, variantLabel: v.label, sku: v.sku, qty, unitPrice: v.price }],
      discountAllocation: 0,
      deliveryAdjustment: 0,
      status: 'awaiting_confirmation',
      paymentStatus: 'paid',
      paymentMethod: 'online',
      history: [{ status: 'awaiting_confirmation', at: nowIso(), actor: 'Customer checkout' }],
      otherSellerCount: 1,
    };
    db.orders.unshift(o);
    logAdjustment(p, v, -qty, 'order', o.id);
    notify({ topic: 'new_order', title: `New order ${o.id}`, body: `${qty} × ${p.name} (${v.label}). Accept within ${s.fulfilment.acceptWindowMins} min.`, link: `/seller/orders/${o.id}` });
    return redactOrder(o);
  }, true);
}

/** Prototype control standing in for the delivery partner workflow. */
export function _demoAdvanceDelivery(id: string) {
  return call(() => {
    const o = ownedOrder(id);
    const next: Partial<Record<OrderStatus, OrderStatus>> = { ready_for_pickup: 'in_transit', in_transit: 'delivered' };
    const to = next[o.status];
    if (!to) throw new ApiError(409, 'The delivery partner can only pick up orders that are ready for pickup.');
    o.status = to;
    o.history.push({ status: to, at: nowIso(), actor: 'Delivery partner (simulated)' });
    if (to === 'delivered') {
      if (o.paymentMethod === 'cod') o.paymentStatus = 'paid';
      const rate = (cat: string) => db.commissionRules.find((c) => c.category === cat)?.ratePct ?? 8;
      db.ledger.unshift(buildLedgerEntry(o, db.products, rate, nowIso(), Date.now()));
    }
    return redactOrder(o);
  }, true);
}

// ---------- earnings & settlements ----------
export const getLedger = () => call(() => db.ledger.filter((l) => l.sellerId === session.sellerId).sort((a, b) => b.date.localeCompare(a.date)));
export const listSettlements = () => call(() => db.settlements.filter((s) => s.sellerId === session.sellerId));
export const listPayoutRequests = () => call(() => db.payoutRequests.filter((p) => p.sellerId === session.sellerId));
export const getCommissionRules = () => call(() => db.commissionRules);

export function requestPayout(amount: number) {
  return call(() => {
    const s = me();
    if (!s.payoutRequestsEnabled) throw new ApiError(403, 'Payout requests are not enabled for your account. Settlements run on the platform schedule.');
    requireApproved('request payouts');
    // Eligibility is computed server-side; the client only proposes an amount.
    const eligible = round2(db.ledger.filter((l) => l.sellerId === s.id && l.state === 'eligible' && !l.settlementId).reduce((sum, l) => sum + l.net, 0));
    const open = db.payoutRequests.filter((p) => p.sellerId === s.id && p.state === 'requested').reduce((sum, p) => sum + p.amount, 0);
    const available = round2(eligible - open);
    if (!(amount >= 500)) throw new ApiError(422, 'Minimum payout request is ₹500.', { amount: 'Minimum is ₹500.' });
    if (amount > available) throw new ApiError(422, `You can request up to ₹${available.toFixed(2)}.`, { amount: `Max ₹${available.toFixed(2)}.` });
    const pr: PayoutRequest = { id: `PR-${String(db.payoutRequests.length + 8).padStart(4, '0')}`, sellerId: s.id, amount: round2(amount), requestedAt: nowIso(), state: 'requested' };
    db.payoutRequests.unshift(pr);
    notify({ topic: 'settlement', title: 'Payout request submitted', body: `₹${pr.amount} is awaiting platform review.`, link: '/seller/settlements' });
    return pr;
  }, true);
}

// ---------- reviews ----------
export const listReviews = () => call(() => db.reviews.filter((r) => r.sellerId === session.sellerId).sort((a, b) => b.date.localeCompare(a.date)));

function ownedReview(id: string): Review {
  const r = db.reviews.find((x) => x.id === id && x.sellerId === session.sellerId);
  if (!r) throw new ApiError(404, 'Review not found.');
  return r;
}

export function replyToReview(id: string, body: string) {
  return call(() => {
    requireApproved('reply to reviews');
    const r = ownedReview(id);
    if (body.trim().length < 5) throw new ApiError(422, 'Reply is too short.', { body: 'Write at least 5 characters.' });
    if (body.length > 600) throw new ApiError(422, 'Reply is too long.', { body: 'Keep it under 600 characters.' });
    r.reply = { body: body.trim(), at: nowIso() };
    return r;
  }, true);
}

export function reportReview(id: string) {
  return call(() => {
    const r = ownedReview(id);
    r.reported = true;
    return r;
  }, true);
}

// ---------- documents ----------
export const listDocuments = () => call(() => db.documents.filter((d) => d.sellerId === session.sellerId));

export function uploadDocument(doc: Pick<SellerDocument, 'type' | 'fileName' | 'mimeType' | 'sizeKb' | 'expiresAt' | 'certBody' | 'certNumber' | 'certScope'>) {
  return call(() => {
    if (me().status === 'suspended') throw new ApiError(403, 'Your account is suspended.');
    if (doc.type === 'organic_cert') {
      const e: Record<string, string> = {};
      if (!doc.certBody?.trim()) e.certBody = 'Certifying body is required.';
      if (!doc.certNumber?.trim()) e.certNumber = 'Certificate number is required.';
      if (!doc.expiresAt) e.expiresAt = 'Expiry date is required.';
      else if (doc.expiresAt <= new Date().toISOString().slice(0, 10)) e.expiresAt = 'This certificate has already expired.';
      if (Object.keys(e).length) throw new ApiError(422, 'Please fix the highlighted fields.', e);
    }
    // Server would re-validate MIME type by content sniffing and store privately.
    const d: SellerDocument = { id: uid('d'), sellerId: session.sellerId, uploadedAt: nowIso(), status: 'pending', ...doc };
    db.documents.unshift(d);
    return d;
  }, true);
}

// ---------- notifications ----------
export const listNotifications = () => call(() => db.notifications.filter((n) => n.sellerId === session.sellerId).sort((a, b) => b.at.localeCompare(a.at)));

export function markNotificationsRead(ids?: string[]) {
  return call(() => {
    for (const n of db.notifications) if (n.sellerId === session.sellerId && (!ids || ids.includes(n.id))) n.read = true;
    return true;
  }, true);
}

// ---------- dashboard ----------
export interface DashboardMetrics {
  range: { from: string; to: string; days: number };
  sales: number;
  salesPrev: number;
  orders: number;
  ordersPrev: number;
  liveProducts: number;
  totalProducts: number;
  lowStock: { productId: string; name: string; variant: string; stock: number; threshold: number }[];
  cancellations: number;
  cancellationRate: number;
  returns: number;
  rating: number | null;
  ratingCount: number;
  netEarnings: number;
  netEarningsPrev: number;
  series: { date: string; sales: number; orders: number }[];
  awaiting: number;
  certExpiringDays: number | null;
  pendingProducts: number;
  rejectedProducts: number;
}

const orderValue = (o: SubOrder) => o.items.filter((i) => !i.unavailable).reduce((s, i) => s + i.qty * i.unitPrice, 0) - o.discountAllocation;

export function getDashboard(days: number) {
  return call((): DashboardMetrics => computeDashboard(db, session.sellerId, days, Date.now()));
}

export function computeDashboard(data: DB, sellerId: string, days: number, nowMs: number): DashboardMetrics {
  const end = nowMs;
  const start = end - days * DAY;
  const prevStart = start - days * DAY;
  const mine = data.orders.filter((o) => o.sellerId === sellerId);
  const inRange = (iso: string, a: number, b: number) => {
    const t = new Date(iso).getTime();
    return t >= a && t < b;
  };
  const cur = mine.filter((o) => inRange(o.placedAt, start, end));
  const prev = mine.filter((o) => inRange(o.placedAt, prevStart, start));
  const counted = (o: SubOrder) => !['cancelled', 'rejected'].includes(o.status);
  const sales = cur.filter(counted).reduce((s, o) => s + orderValue(o), 0);
  const salesPrev = prev.filter(counted).reduce((s, o) => s + orderValue(o), 0);
  const cancellations = cur.filter((o) => o.status === 'cancelled' || o.status === 'rejected').length;
  const returns = cur.filter((o) => o.status === 'return_requested' || o.status === 'returned').length;

  const products = data.products.filter((p) => p.sellerId === sellerId && !p.archived);
  const lowStock: DashboardMetrics['lowStock'] = [];
  for (const p of products) {
    if (p.status !== 'approved' && p.status !== 'inactive') continue;
    for (const v of p.variants) if (v.stock <= p.lowStockThreshold) lowStock.push({ productId: p.id, name: p.name, variant: v.label, stock: v.stock, threshold: p.lowStockThreshold });
  }
  lowStock.sort((a, b) => a.stock - b.stock);

  const reviews = data.reviews.filter((r) => r.sellerId === sellerId && inRange(r.date, start, end));
  const ledger = data.ledger.filter((l) => l.sellerId === sellerId);
  const netEarnings = round2(ledger.filter((l) => inRange(l.date, start, end)).reduce((s, l) => s + l.net, 0));
  const netEarningsPrev = round2(ledger.filter((l) => inRange(l.date, prevStart, start)).reduce((s, l) => s + l.net, 0));

  const series: DashboardMetrics['series'] = [];
  for (let d = days - 1; d >= 0; d--) {
    const a = new Date(end - d * DAY);
    a.setHours(0, 0, 0, 0);
    const b = a.getTime() + DAY;
    const dayOrders = mine.filter((o) => inRange(o.placedAt, a.getTime(), b));
    series.push({ date: a.toISOString(), sales: dayOrders.filter(counted).reduce((s, o) => s + orderValue(o), 0), orders: dayOrders.length });
  }

  const cert = data.documents
    .filter((d) => d.sellerId === sellerId && d.type === 'organic_cert' && d.status === 'approved' && d.expiresAt)
    .sort((a, b) => (b.expiresAt ?? '').localeCompare(a.expiresAt ?? ''))[0];
  const certExpiringDays = cert?.expiresAt ? Math.ceil((new Date(cert.expiresAt).getTime() - nowMs) / DAY) : null;

  return {
    range: { from: new Date(start).toISOString(), to: new Date(end).toISOString(), days },
    sales: round2(sales),
    salesPrev: round2(salesPrev),
    orders: cur.length,
    ordersPrev: prev.length,
    liveProducts: products.filter((p) => p.status === 'approved' && p.available).length,
    totalProducts: products.length,
    lowStock,
    cancellations,
    cancellationRate: cur.length ? cancellations / cur.length : 0,
    returns,
    rating: reviews.length ? round2(reviews.reduce((s, r) => s + r.rating, 0) / reviews.length) : null,
    ratingCount: reviews.length,
    netEarnings,
    netEarningsPrev,
    series,
    awaiting: mine.filter((o) => o.status === 'awaiting_confirmation').length,
    certExpiringDays,
    pendingProducts: products.filter((p) => p.status === 'pending').length,
    rejectedProducts: products.filter((p) => p.status === 'rejected').length,
  };
}

export type { LedgerEntry, Settlement };
