// Deterministic mock data for the frontend-only phase.
// Every value here is fictional demo data; nothing represents a real seller,
// customer, certificate or payout.

import type {
  AppNotification,
  CommissionRule,
  InventoryAdjustment,
  LedgerEntry,
  PayoutRequest,
  Product,
  Review,
  Seller,
  SellerDocument,
  Settlement,
  SubOrder,
} from '../types.js';

export interface DB {
  version: number;
  sellers: Seller[];
  products: Product[];
  adjustments: InventoryAdjustment[];
  orders: SubOrder[];
  ledger: LedgerEntry[];
  settlements: Settlement[];
  payoutRequests: PayoutRequest[];
  reviews: Review[];
  documents: SellerDocument[];
  notifications: AppNotification[];
  commissionRules: CommissionRule[];
}

// 4: empty dataset by default. 5: unified seller status model (v4 data is migrated, not discarded).
// 6: the preview ships with sample data again (saved data with records is kept).
// 7: removed hardcoded demo sellers (Green Valley Organics, Sunrise Fruits) for clean slate.
export const DB_VERSION = 7;
export const SELLER_A = 's_demo_a';
export const SELLER_B = 's_demo_b';
const DAY = 86_400_000;

export const COMMISSION_RULES: CommissionRule[] = [
  { category: 'Fruits', ratePct: 8 },
  { category: 'Vegetables', ratePct: 7 },
  { category: 'Leafy Greens', ratePct: 6 },
  { category: 'Root Vegetables', ratePct: 7 },
  { category: 'Herbs', ratePct: 6 },
  { category: 'Exotic', ratePct: 10 },
  // Non-produce categories. 8% matches the default rate for categories without a rule.
  { category: 'Women Apparel', ratePct: 8 },
  { category: 'Women Accessories', ratePct: 8 },
  { category: 'Others', ratePct: 8 },
];

export const CATEGORIES = COMMISSION_RULES.map((r) => r.category);

export function createSeed(now = new Date()): DB {
  const t = now.getTime();
  const iso = (msAgo: number) => new Date(t - msAgo).toISOString();
  const dateOnly = (daysFromNow: number) => new Date(t + daysFromNow * DAY).toISOString().slice(0, 10);

  // Empty sellers array - all demo data removed for clean slate.
  // Users will register their own sellers through the signup flow.
  const sellers: Seller[] = [];

  // Products array is empty - demo sellers have been removed.
  // Users will add their products after registration.
  const products: Product[] = [];

  // ---- Orders ----
  // Orders are empty - demo data removed. Users will create orders through transactions.
  const orders: SubOrder[] = [];


  // ---- Ledger & settlements ----
  const rateFor = (cat: string) => COMMISSION_RULES.find((c) => c.category === cat)?.ratePct ?? 8;
  const ledger: LedgerEntry[] = [];
  for (const o of orders) {
    if (o.sellerId !== SELLER_A) continue;
    if (!['delivered', 'returned', 'return_requested'].includes(o.status)) continue;
    const deliveredAt = o.history.find((h) => h.status === 'delivered')?.at ?? o.placedAt;
    ledger.push(buildLedgerEntry(o, products, rateFor, deliveredAt, t));
  }

  // Weekly settlements for entries older than the 7-day return window
  const settlements: Settlement[] = [];
  const settleable = ledger.filter((l) => l.state === 'eligible').sort((a, b) => a.date.localeCompare(b.date));
  const weekOf = (d: string) => Math.floor((t - new Date(d).getTime()) / (7 * DAY));
  const byWeek = new Map<number, LedgerEntry[]>();
  for (const l of settleable) {
    const w = weekOf(l.date);
    if (w < 2) continue; // last 2 weeks stay "eligible"
    byWeek.set(w, [...(byWeek.get(w) ?? []), l]);
  }
  let sIdx = 1;
  for (const [w, entries] of [...byWeek.entries()].sort((a, b) => b[0] - a[0])) {
    const amount = round2(entries.reduce((s, e) => s + e.net, 0));
    const id = `STL-2026-${String(sIdx++).padStart(3, '0')}`;
    let state: Settlement['state'] = 'paid';
    if (w === 2) state = 'processing';
    if (w === 5) state = 'failed';
    const st: Settlement = {
      id,
      sellerId: SELLER_A,
      periodStart: new Date(t - (w + 1) * 7 * DAY).toISOString().slice(0, 10),
      periodEnd: new Date(t - w * 7 * DAY - DAY).toISOString().slice(0, 10),
      amount,
      entryIds: entries.map((e) => e.id),
      state,
      method: 'manual',
      initiatedAt: new Date(t - (w - 1) * 7 * DAY).toISOString(),
      ...(state === 'paid' ? { reference: `UTR${(884120330 + sIdx * 7919).toString()}`, paidAt: new Date(t - (w - 1) * 7 * DAY + DAY).toISOString() } : {}),
      ...(state === 'failed' ? { failureReason: 'Beneficiary bank rejected transfer (account name mismatch). Re-queued after bank verification.' } : {}),
    };
    settlements.push(st);
    for (const e of entries) {
      e.settlementId = id;
      e.state = state === 'failed' ? 'eligible' : state;
    }
  }
  // One reversed entry: a return processed after payout
  const reversedSource = ledger.find((l) => l.state === 'paid');
  if (reversedSource) {
    const { settlementId: _paidIn, ...rest } = reversedSource;
    void _paidIn;
    ledger.push({ ...rest, id: reversedSource.id + '-R', gross: 0, discount: 0, commission: -reversedSource.commission, deliveryAdjustment: 0, refund: round2(reversedSource.net + reversedSource.commission), hold: 0, net: -reversedSource.net, state: 'reversed', date: iso(4 * DAY) });
  }

  const payoutRequests: PayoutRequest[] = [
    { id: 'PR-0007', sellerId: SELLER_A, amount: 4200, requestedAt: iso(26 * DAY), state: 'paid', note: 'Included in the weekly settlement' },
    { id: 'PR-0005', sellerId: SELLER_A, amount: 2500, requestedAt: iso(48 * DAY), state: 'paid', note: 'Paid early for seed purchase' },
    { id: 'PR-0003', sellerId: SELLER_A, amount: 9800, requestedAt: iso(70 * DAY), state: 'rejected', note: 'Exceeded eligible balance at review time' },
  ];

  // ---- Reviews ----
  const reviews: Review[] = [];

  // ---- Documents ----
  const documents: SellerDocument[] = [
    { id: 'd_pan', sellerId: SELLER_A, type: 'pan', fileName: 'pan-card.pdf', mimeType: 'application/pdf', sizeKb: 212, uploadedAt: iso(240 * DAY), status: 'approved' },
    { id: 'd_gst', sellerId: SELLER_A, type: 'gst', fileName: 'gst-registration.pdf', mimeType: 'application/pdf', sizeKb: 488, uploadedAt: iso(240 * DAY), status: 'approved' },
    { id: 'd_bank', sellerId: SELLER_A, type: 'bank_proof', fileName: 'cancelled-cheque.jpg', mimeType: 'image/jpeg', sizeKb: 1310, uploadedAt: iso(240 * DAY), status: 'approved' },
    { id: 'd_addr', sellerId: SELLER_A, type: 'address_proof', fileName: 'electricity-bill.pdf', mimeType: 'application/pdf', sizeKb: 356, uploadedAt: iso(240 * DAY), status: 'approved' },
    { id: 'd_fssai', sellerId: SELLER_A, type: 'fssai', fileName: 'fssai-registration.pdf', mimeType: 'application/pdf', sizeKb: 274, uploadedAt: iso(30 * DAY), status: 'pending' },
    { id: 'd_cert1', sellerId: SELLER_A, type: 'organic_cert', fileName: 'npop-scope-certificate.pdf', mimeType: 'application/pdf', sizeKb: 902, uploadedAt: iso(200 * DAY), status: 'approved', expiresAt: dateOnly(21), certBody: 'Demo Certification Body (fictional)', certNumber: 'DEMO/NPOP/2025/0142', certScope: 'Mulshi farm cluster — fruits, vegetables, leafy greens, herbs' },
    { id: 'd_sr_pan', sellerId: SELLER_B, type: 'pan', fileName: 'pan.pdf', mimeType: 'application/pdf', sizeKb: 150, uploadedAt: iso(120 * DAY), status: 'approved' },
  ];

  // ---- Inventory audit trail ----
  const adjustments: InventoryAdjustment[] = [
    { id: 'adj1', sellerId: SELLER_A, productId: 'p_alphonso', variantId: 'v1', delta: 40, resultingStock: 58, reason: 'restock', note: 'Morning harvest batch', actor: 'Ananya K.', at: iso(1 * DAY) },
    { id: 'adj2', sellerId: SELLER_A, productId: 'p_spinach', variantId: 'v1', delta: -6, resultingStock: 8, reason: 'damage', note: 'Wilted in cold-room power cut', actor: 'Rahul P.', at: iso(20 * 3_600_000) },
    { id: 'adj3', sellerId: SELLER_A, productId: 'p_coriander', variantId: 'v1', delta: -12, resultingStock: 0, reason: 'correction', note: 'Physical count mismatch', actor: 'Ananya K.', at: iso(6 * 3_600_000) },
    { id: 'adj4', sellerId: SELLER_A, productId: 'p_tomato', variantId: 'v1', delta: 30, resultingStock: 64, reason: 'restock', note: '', actor: 'Rahul P.', at: iso(2 * DAY) },
    { id: 'adj5', sellerId: SELLER_A, productId: 'p_okra', variantId: 'v1', delta: -3, resultingStock: 9, reason: 'order', note: 'SO-48211-GV', actor: 'System', at: iso(3 * 3_600_000) },
    { id: 'adj6', sellerId: SELLER_A, productId: 'p_orange', variantId: 'v1', delta: 60, resultingStock: 74, reason: 'restock', note: 'Consignment from Nagpur partner farm', actor: 'Sunita J.', at: iso(1.5 * DAY) },
    { id: 'adj7', sellerId: SELLER_A, productId: 'p_strawberry', variantId: 'v1', delta: -4, resultingStock: 24, reason: 'damage', note: 'Punnets crushed in transit', actor: 'Rahul P.', at: iso(26 * 3_600_000) },
    { id: 'adj8', sellerId: SELLER_A, productId: 'p_drumstick', variantId: 'v1', delta: -6, resultingStock: 0, reason: 'correction', note: 'End of season — remaining stock unsellable', actor: 'Ananya K.', at: iso(4 * DAY) },
    { id: 'adj9', sellerId: SELLER_A, productId: 'p_mint', variantId: 'v1', delta: 40, resultingStock: 65, reason: 'restock', note: 'Morning harvest', actor: 'Rahul P.', at: iso(9 * 3_600_000) },
    { id: 'adj10', sellerId: SELLER_A, productId: 'p_methi', variantId: 'v1', delta: 2, resultingStock: 42, reason: 'return', note: 'Customer return restocked (unopened)', actor: 'Sunita J.', at: iso(3 * DAY) },
  ];

  const notifications: AppNotification[] = [
    { id: 'n1', sellerId: SELLER_A, topic: 'new_order', title: 'New order awaiting confirmation', body: 'Accept or reject within your 30-minute window.', at: iso(20 * 60_000), read: false, link: '/seller/orders?status=awaiting_confirmation' },
    { id: 'n2', sellerId: SELLER_A, topic: 'moderation', title: 'Listing rejected: Hass Avocado', body: 'Certificate scope does not cover this product’s origin.', at: iso(1 * DAY), read: false, link: '/seller/products/p_avocado' },
    { id: 'n3', sellerId: SELLER_A, topic: 'low_stock', title: '3 variants are low on stock', body: 'Baby Spinach, Tender Okra and Alphonso Mango box.', at: iso(5 * 3_600_000), read: false, link: '/seller/inventory?filter=low' },
    { id: 'n4', sellerId: SELLER_A, topic: 'settlement', title: 'Settlement processing', body: 'A settlement for last period is being processed.', at: iso(2 * DAY), read: true, link: '/seller/settlements' },
    { id: 'n5', sellerId: SELLER_A, topic: 'moderation', title: 'Organic certificate expires in 21 days', body: 'Upload a renewed certificate to keep organic labels on your listings.', at: iso(1 * DAY), read: true, link: '/seller/documents' },
    { id: 'n6', sellerId: SELLER_A, topic: 'moderation', title: 'Green Zucchini is pending approval', body: 'Moderation usually completes within 1 business day.', at: iso(7 * 3_600_000), read: false, link: '/seller/products/p_zucchini' },
    { id: 'n7', sellerId: SELLER_A, topic: 'settlement', title: 'Payout request PR-0007 paid', body: '₹4,200 was included in the weekly settlement.', at: iso(25 * DAY), read: true, link: '/seller/settlements' },
    { id: 'n8', sellerId: SELLER_A, topic: 'order_update', title: 'Order delivered', body: 'The delivery partner marked an order as delivered.', at: iso(14 * 3_600_000), read: true, link: '/seller/orders?status=delivered' },
    { id: 'n9', sellerId: SELLER_A, topic: 'support', title: 'Support replied to your ticket', body: 'We’ve credited the customer for the wrong-item delivery. No action needed.', at: iso(6 * DAY), read: true, link: '/seller/reviews' },
  ];

  return {
    version: DB_VERSION,
    sellers,
    products,
    adjustments,
    orders,
    ledger,
    settlements,
    payoutRequests,
    reviews,
    documents,
    notifications,
    commissionRules: COMMISSION_RULES,
  };
}

/**
 * A fresh start: seller accounts, KYC documents, store settings and platform
 * commission rules are kept; all business records are empty, so every metric
 * reads zero or shows its empty state.
 */
export function createEmptySeed(now = new Date()): DB {
  const base = createSeed(now);
  return {
    ...base,
    products: [],
    adjustments: [],
    orders: [],
    ledger: [],
    settlements: [],
    payoutRequests: [],
    reviews: [],
    notifications: [],
  };
}

export function round2(n: number) {
  return Math.round(n * 100) / 100;
}

/** Platform-side calculation. The seller UI only ever displays the result. */
export function buildLedgerEntry(
  o: SubOrder,
  products: Product[],
  rateFor: (cat: string) => number,
  deliveredAt: string,
  nowMs: number,
): LedgerEntry {
  const gross = o.items.filter((i) => !i.unavailable).reduce((s, i) => s + i.qty * i.unitPrice, 0);
  // Weighted commission rate by item category
  let commission = 0;
  for (const it of o.items) {
    if (it.unavailable) continue;
    const cat = products.find((p) => p.id === it.productId)?.category ?? '';
    const share = gross ? (it.qty * it.unitPrice) / gross : 0;
    commission += (gross - o.discountAllocation) * share * (rateFor(cat) / 100);
  }
  commission = round2(commission);
  const effRate = gross - o.discountAllocation ? round2((commission / (gross - o.discountAllocation)) * 100) : 0;
  const refund = o.status === 'returned' ? gross - o.discountAllocation : 0;
  const hold = o.status === 'return_requested' ? gross - o.discountAllocation - commission + o.deliveryAdjustment : 0;
  const returned = o.status === 'returned';
  const deliveryAdjustment = returned ? 0 : o.deliveryAdjustment;
  const appliedCommission = returned ? 0 : commission;
  // net = gross − discount − commission + delivery adjustment − refund − hold
  const net = round2(gross - o.discountAllocation - appliedCommission + deliveryAdjustment - refund - hold);
  const ageDays = (nowMs - new Date(deliveredAt).getTime()) / DAY;
  return {
    id: 'L-' + o.id,
    sellerId: o.sellerId,
    subOrderId: o.id,
    date: deliveredAt,
    gross,
    discount: o.discountAllocation,
    commissionRate: effRate,
    commission: appliedCommission,
    deliveryAdjustment,
    refund,
    hold: round2(hold),
    net,
    state: o.status === 'returned' ? 'reversed' : ageDays < 7 || hold > 0 ? 'pending' : 'eligible',
  };
}
