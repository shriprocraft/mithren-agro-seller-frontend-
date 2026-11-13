// Deterministic mock data for the frontend-only phase.
// Every value here is fictional demo data; nothing represents a real seller,
// customer, certificate or payout.

import type {
  AppNotification,
  CommissionRule,
  InventoryAdjustment,
  LedgerEntry,
  OrderItem,
  OrderStatus,
  PayoutRequest,
  Product,
  Review,
  Seller,
  SellerDocument,
  Settlement,
  StatusEvent,
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

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

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
  const r = rng(20261024);
  const firstNames = ['Priya', 'Arjun', 'Meera', 'Karan', 'Sneha', 'Rohan', 'Isha', 'Aditya', 'Neha', 'Siddharth', 'Pooja', 'Varun', 'Tanvi', 'Nikhil',
    'Ananya', 'Rahul', 'Kavya', 'Vikram', 'Shruti', 'Aniket', 'Gauri', 'Omkar', 'Farah', 'Joseph', 'Harpreet', 'Lakshmi', 'Imran', 'Rutuja', 'Devika', 'Sameer'];
  const areas = sellers[0]!.serviceAreas;
  // Out-of-season or out-of-stock items still appear in older orders.
  const sellable = products.filter((p) => p.sellerId === SELLER_A && ['approved'].includes(p.status) && p.id !== 'p_papaya');
  const orders: SubOrder[] = [];
  const pick = <T,>(arr: T[]) => arr[Math.floor(r() * arr.length)]!;

  const flow: OrderStatus[] = ['awaiting_confirmation', 'accepted', 'packed', 'ready_for_pickup', 'in_transit', 'delivered'];
  const actorFor = (s: OrderStatus) =>
    s === 'awaiting_confirmation' ? 'Customer checkout' : s === 'in_transit' || s === 'delivered' ? 'Delivery partner' : 'Ananya K. (seller)';

  for (let i = 0; i < 260; i++) {
    // The newest few orders are pinned so there is always a live queue to work through.
    const recentMins = [18, 52, 150, 290, 470, 1050];
    const randomAge = Math.floor(Math.pow(r(), 1.25) * 88 * DAY) + 20 * 60_000;
    const ageMs = i < recentMins.length ? recentMins[i]! * 60_000 : randomAge;
    const placed = t - ageMs;
    const nItems = 1 + Math.floor(r() * 3);
    const items: OrderItem[] = [];
    const used = new Set<string>();
    for (let k = 0; k < nItems; k++) {
      const p = pick(sellable);
      if (used.has(p.id)) continue;
      used.add(p.id);
      const vr = pick(p.variants);
      items.push({ productId: p.id, variantId: vr.id, name: p.name, variantLabel: vr.label, sku: vr.sku, qty: 1 + Math.floor(r() * 3), unitPrice: vr.price });
    }
    const subtotal = items.reduce((s, it) => s + it.qty * it.unitPrice, 0);
    const discount = r() < 0.3 ? Math.round(subtotal * 0.1) : 0;

    let status: OrderStatus;
    const ageH = ageMs / 3_600_000;
    if (ageH < 1.5) status = 'awaiting_confirmation';
    else if (ageH < 4) status = pick(['accepted', 'packed', 'awaiting_confirmation']);
    else if (ageH < 10) status = pick(['packed', 'ready_for_pickup', 'in_transit']);
    else if (ageH < 24) status = pick(['in_transit', 'delivered', 'delivered']);
    else {
      const x = r();
      status = x < 0.84 ? 'delivered' : x < 0.91 ? 'cancelled' : x < 0.95 ? 'rejected' : x < 0.975 ? 'returned' : 'return_requested';
    }
    if (status === 'return_requested' && ageMs > 9 * DAY) status = 'returned';

    const history: StatusEvent[] = [];
    let at = placed;
    const terminalIndex = flow.indexOf(status);
    const pushStep = (s: OrderStatus, note?: string) => {
      history.push({ status: s, at: new Date(at).toISOString(), actor: actorFor(s), ...(note ? { note } : {}) });
      at += (15 + r() * 90) * 60_000;
    };
    let reason: string | undefined;
    if (terminalIndex >= 0) {
      for (let k = 0; k <= terminalIndex; k++) pushStep(flow[k]!);
    } else if (status === 'cancelled') {
      pushStep('awaiting_confirmation');
      pushStep('accepted');
      reason = pick(['Customer cancelled before packing', 'Delivery slot unavailable']);
      pushStep('cancelled', reason);
    } else if (status === 'rejected') {
      pushStep('awaiting_confirmation');
      reason = pick(['Item out of stock at harvest', 'Outside service hours']);
      pushStep('rejected', reason);
    } else {
      for (const s of flow) pushStep(s);
      reason = pick(['Bruised fruit on arrival', 'Wrong variant delivered']);
      pushStep('return_requested', reason);
      if (status === 'returned') pushStep('returned', 'Return approved by platform support');
    }

    const online = r() < 0.75;
    const refunded = status === 'cancelled' || status === 'rejected' || status === 'returned';
    orders.push({
      id: `SO-${(48210 + i).toString()}-GV`,
      parentOrderId: `ORD-${(48210 + i).toString()}`,
      sellerId: SELLER_A,
      placedAt: new Date(placed).toISOString(),
      deliverySlot: pick(['7–9 AM', '9–11 AM', '5–7 PM', '7–9 PM']),
      customer: {
        firstName: pick(firstNames),
        area: pick(areas),
        phoneMasked: `+91 •••••• ${Math.floor(1000 + r() * 8999)}`,
        address: `Flat ${Math.floor(101 + r() * 900)}, ${pick(['Sai Residency', 'Green Meadows', 'Lotus Towers', 'Palm Grove', 'Kumar Pebble Park', 'Nyati Elysia', 'Rohan Mithila', 'Paranjape Gulmohar', 'Kalpataru Splendour', 'Sukhwani Coronet'])}`,
        ...(r() < 0.3 ? { instructions: pick(['Leave with security', 'Call on arrival', 'No plastic bags please', 'Ring the bell twice', 'Deliver after 6 PM', 'Don’t call, use the intercom']) } : {}),
      },
      items,
      discountAllocation: discount,
      deliveryAdjustment: r() < 0.2 ? -20 : 0,
      status,
      paymentMethod: online ? 'online' : 'cod',
      paymentStatus: refunded ? (online ? 'refunded' : 'refunded') : status === 'return_requested' ? 'refund_pending' : online || status === 'delivered' ? 'paid' : 'cod_pending',
      history,
      ...(reason ? { reason } : {}),
      otherSellerCount: r() < 0.35 ? 1 + Math.floor(r() * 2) : 0,
    });
  }
  orders.sort((a, b) => b.placedAt.localeCompare(a.placedAt));

  // A couple of Seller B orders for isolation checks
  orders.push({
    id: 'SO-48300-SR', parentOrderId: 'ORD-48300', sellerId: SELLER_B, placedAt: iso(2 * 3_600_000), deliverySlot: '5–7 PM',
    customer: { firstName: 'Kavya', area: 'Wakad', phoneMasked: '+91 •••••• 4410', address: 'Flat 22, Blue Ridge' },
    items: [{ productId: 'p_sr_kale', variantId: 'v1', name: 'Curly Kale', variantLabel: '200 g', sku: 'SR-KAL-200', qty: 2, unitPrice: 120 }],
    discountAllocation: 0, deliveryAdjustment: 0, status: 'accepted', paymentStatus: 'paid', paymentMethod: 'online',
    history: [{ status: 'awaiting_confirmation', at: iso(2 * 3_600_000), actor: 'Customer checkout' }], otherSellerCount: 1,
  });

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
  // [rating, title, body, product the review is about (null: whatever the order contained)]
  const reviewTexts: [number, string, string, string | null][] = [
    [5, 'Oranges were juicy', 'Sweet and easy to peel. My kids finished the box in two days.', 'p_orange'],
    [4, 'Good pomegranates', 'Seeds were deep red and sweet. One fruit was slightly dry inside.', 'p_pomegranate'],
    [5, 'Methi was spotless', 'No mud, no yellow leaves. Made lovely theplas.', 'p_methi'],
    [5, 'Fragrant curry leaves', 'Still fresh after a week in the fridge.', 'p_curry'],
    [3, 'Broccoli was small', 'Tasted fine but the 250 g pack had small florets.', 'p_broccoli'],
    [5, 'Strawberries!', 'Sweetest strawberries we’ve had this season. Not a single squashed one.', 'p_strawberry'],
    [4, 'Nice cauliflower', 'Clean and fresh. Would love a smaller size option.', 'p_cauliflower'],
    [2, 'Mint wilted quickly', 'It was limp by the next morning even though I refrigerated it.', 'p_mint'],
    [5, 'Consistent quality', 'Third month ordering weekly. Packaging is always neat and plastic-free.', null],
    [4, 'Sweet potatoes', 'Creamy and sweet when roasted. A couple were small.', 'p_sweetpotato'],
    [5, 'Great for sambar', 'Drumsticks were tender and long. Exactly what I wanted.', 'p_drumstick'],
    [1, 'Wrong item delivered', 'Received bottle gourd instead of brinjal. Support resolved it the same day though.', 'p_brinjal'],
    [5, 'Cherry tomatoes are addictive', 'Sweet and firm. Half the box was gone before dinner.', 'p_cherrytomato'],
    [4, 'Fresh amaranth', 'Lovely colour, a little sand on the roots.', 'p_amaranth'],
    [5, 'Guava with crunch', 'Just the way I like them — crisp, not overripe.', 'p_guava'],
    [3, 'Delivery slot missed', 'Arrived 40 minutes late, but the produce itself was excellent.', null],
    [5, 'Loved the packaging', 'Paper bags and cloth ties. Zero plastic. Thank you!', null],
    [4, 'Bharta brinjals', 'Big and smoky after roasting. Good value.', 'p_brinjal'],
    [5, 'Organic and tasty', 'You can taste the difference in the heirloom tomatoes.', 'p_tomato'],
    [4, 'Good bottle gourd', 'Tender with very few seeds.', 'p_bottlegourd'],
    [5, 'Best mangoes this season', 'Sweet, fragrant and perfectly ripe. Packed beautifully.', 'p_alphonso'],
    [5, 'Super fresh spinach', 'Lasted almost a week in the fridge. No yellow leaves.', 'p_spinach'],
    [4, 'Good tomatoes', 'Great flavour, a couple were slightly soft.', 'p_tomato'],
    [5, 'Coriander smells amazing', 'You can tell it was picked the same day.', 'p_coriander'],
    [3, 'Bananas were unripe', 'Took 4 days to ripen. Taste was fine eventually.', 'p_banana'],
    [5, 'Reliable every week', 'Have ordered 10+ times. Always on time.', null],
    [2, 'Okra was fibrous', 'Half the okra was too mature to cook.', 'p_okra'],
    [4, 'Nice carrots', 'Sweet and crunchy, would buy again.', 'p_carrot'],
    [5, 'Basil for pesto', 'Very aromatic, made great pesto.', 'p_basil'],
    [4, 'Fresh but small bunch', 'Quality is good, quantity could be better.', 'p_methi'],
    [1, 'Late delivery', 'Arrived 2 hours after slot. Greens had wilted.', null],
    [5, 'Lovely heirloom mix', 'The colours and flavours are fantastic.', 'p_tomato'],
  ];
  const delivered = orders.filter((o) => o.sellerId === SELLER_A && o.status === 'delivered');
  const used = new Set<string>();
  const reviews: Review[] = reviewTexts.map(([rating, title, body, productId], i) => {
    // A delivered order that actually contains the reviewed product (one review per order).
    const o =
      delivered.find((x) => !used.has(x.id) && (!productId || x.items.some((it) => it.productId === productId)) && new Date(x.placedAt).getTime() < t - 3 * DAY) ??
      delivered.find((x) => !used.has(x.id))!;
    used.add(o.id);
    const placed = new Date(o.placedAt).getTime();
    const reviewedAt = Math.min(placed + 2 * DAY, t - 6 * 3_600_000);
    return {
      id: `rv${i + 1}`,
      sellerId: SELLER_A,
      productId: productId && o.items.some((it) => it.productId === productId) ? productId : o.items[0]!.productId,
      subOrderId: o.id,
      rating,
      title,
      body,
      customerFirstName: o.customer.firstName,
      date: new Date(reviewedAt).toISOString(),
      ...(rating <= 3 || i % 4 === 0
        ? {
            reply: {
              body:
                rating <= 2
                  ? 'We’re sorry about this. We’ve shared it with our packing team and issued a credit to your account. Please write to us if anything else goes wrong.'
                  : rating === 3
                    ? 'Thanks for the honest feedback — we’re adjusting harvest timing and grading so this doesn’t happen again.'
                    : 'Thank you! It means a lot to our farm team.',
              at: new Date(Math.min(reviewedAt + DAY, t - 3_600_000)).toISOString(),
            },
          }
        : {}),
    };
  });
  reviews.push({ id: 'rv_sr1', sellerId: SELLER_B, productId: 'p_sr_kale', subOrderId: 'SO-48300-SR', rating: 4, title: 'Crisp kale', body: 'Good.', customerFirstName: 'Kavya', date: iso(1 * DAY) });

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
