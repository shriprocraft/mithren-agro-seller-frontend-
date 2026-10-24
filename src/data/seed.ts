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
  Variant,
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

// Bumped to 4 when the default changed to an empty dataset; older saved data is discarded.
export const DB_VERSION = 4;
export const SELLER_A = 's_greenvalley';
export const SELLER_B = 's_sunrise';
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
];

export const CATEGORIES = COMMISSION_RULES.map((r) => r.category);

const defaultHours = (): Seller['workingHours'] =>
  (['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const).map((day) => ({
    day,
    open: '07:00',
    close: day === 'Sat' ? '14:00' : '19:00',
    closed: day === 'Sun',
  }));

const defaultNotifications = (): Seller['notifications'] => ({
  new_order: { email: true, sms: true, push: true },
  order_update: { email: false, sms: false, push: true },
  moderation: { email: true, sms: false, push: true },
  settlement: { email: true, sms: false, push: false },
  low_stock: { email: true, sms: false, push: true },
  support: { email: true, sms: false, push: false },
});

function v(id: string, label: string, sku: string, packSize: number, unit: Variant['unit'], price: number, stock: number, mrp?: number): Variant {
  return { id, label, sku, packSize, unit, price, stock, ...(mrp ? { mrp } : {}) };
}

export function createSeed(now = new Date()): DB {
  const t = now.getTime();
  const iso = (msAgo: number) => new Date(t - msAgo).toISOString();
  const dateOnly = (daysFromNow: number) => new Date(t + daysFromNow * DAY).toISOString().slice(0, 10);

  const sellers: Seller[] = [
    {
      id: SELLER_A,
      shopName: 'Green Valley Organics',
      slug: 'green-valley-organics',
      ownerName: 'Ananya Kulkarni',
      email: 'ananya@greenvalley.example',
      phone: '+91 98•••••210',
      emailVerified: true,
      phoneVerified: true,
      status: 'approved',
      description:
        'Family-run farm cluster in the Mulshi valley growing seasonal fruits, leafy greens and heirloom vegetables. Harvested to order, packed the same morning.',
      address: 'Survey 42, Mulshi Road, Pirangut, Pune 412115',
      pickupAddress: 'Packhouse 2, Survey 42, Mulshi Road, Pirangut, Pune 412115',
      serviceAreas: ['Kothrud', 'Baner', 'Aundh', 'Bavdhan', 'Pashan', 'Wakad'],
      productTypes: ['Fruits', 'Vegetables', 'Leafy Greens', 'Herbs'],
      gstin: '27ABCDE1234F1Z5',
      pan: 'ABCDE1234F',
      bank: { accountName: 'Green Valley Organics', last4: '4821', ifsc: 'HDFC0001234', verified: true },
      brandColor: '#2f7d4a',
      bannerTagline: 'Harvested this morning, at your door by evening.',
      workingHours: defaultHours(),
      holidays: [{ id: 'h1', date: dateOnly(18), note: 'Farm maintenance day' }],
      fulfilment: { autoAccept: false, acceptWindowMins: 30, packingTimeMins: 45, minOrderValue: 199 },
      notifications: defaultNotifications(),
      staff: [
        { id: 'st1', name: 'Rahul Patil', email: 'rahul@greenvalley.example', role: 'packer', invitedAt: iso(60 * DAY), active: true },
      ],
      supportEmail: 'seller-support@marketplace.example',
      payoutRequestsEnabled: true,
      joinedAt: iso(240 * DAY),
    },
    {
      id: SELLER_B,
      shopName: 'Sunrise Farm Co.',
      slug: 'sunrise-farm-co',
      ownerName: 'Vikram Shah',
      email: 'vikram@sunrise.example',
      phone: '+91 99•••••771',
      emailVerified: true,
      phoneVerified: true,
      status: 'approved',
      description: 'Hydroponic exotics and microgreens.',
      address: 'Plot 9, Hinjewadi Phase 3, Pune',
      pickupAddress: 'Plot 9, Hinjewadi Phase 3, Pune',
      serviceAreas: ['Hinjewadi', 'Wakad'],
      productTypes: ['Exotic'],
      bank: { accountName: 'Sunrise Farm Co', last4: '0093', ifsc: 'ICIC0004321', verified: true },
      brandColor: '#c2410c',
      bannerTagline: '',
      workingHours: defaultHours(),
      holidays: [],
      fulfilment: { autoAccept: true, acceptWindowMins: 20, packingTimeMins: 30, minOrderValue: 249 },
      notifications: defaultNotifications(),
      staff: [],
      supportEmail: 'seller-support@marketplace.example',
      payoutRequestsEnabled: false,
      joinedAt: iso(120 * DAY),
    },
  ];

  const P = (p: Omit<Product, 'sellerId' | 'archived' | 'updatedAt' | 'minQty' | 'maxQty' | 'available'> & Partial<Product>): Product => ({
    sellerId: SELLER_A,
    archived: false,
    updatedAt: iso(3 * DAY),
    minQty: 1,
    maxQty: 10,
    available: true,
    ...p,
  });

  const products: Product[] = [
    P({ id: 'p_alphonso', name: 'Alphonso Mango', slug: 'alphonso-mango', category: 'Fruits', emoji: '🥭', description: 'Naturally ripened Ratnagiri Alphonso. No carbide.', origin: 'Ratnagiri, Maharashtra', seasonality: 'seasonal', seasonMonths: [3, 4, 5, 6], storage: 'Store at room temperature until ripe, then refrigerate up to 3 days.', organicClaim: 'certified', certificateId: 'd_cert1', status: 'approved', lowStockThreshold: 10, harvestDate: dateOnly(-2), packedDate: dateOnly(-1),
      variants: [v('v1', '1 kg', 'GV-MNG-1K', 1, 'kg', 649, 42, 749), v('v2', '1 box (12 pcs)', 'GV-MNG-BX12', 12, 'piece', 1499, 6, 1699)] }),
    P({ id: 'p_spinach', name: 'Baby Spinach', slug: 'baby-spinach', category: 'Leafy Greens', emoji: '🥬', description: 'Tender baby spinach leaves, triple washed.', origin: 'Mulshi, Pune', seasonality: 'year_round', seasonMonths: [], storage: 'Refrigerate at 2–4 °C. Best within 3 days.', organicClaim: 'certified', certificateId: 'd_cert1', status: 'approved', lowStockThreshold: 15,
      variants: [v('v1', '250 g', 'GV-SPN-250', 250, 'g', 59, 8), v('v2', '500 g', 'GV-SPN-500', 500, 'g', 109, 4)] }),
    P({ id: 'p_tomato', name: 'Heirloom Tomatoes', slug: 'heirloom-tomatoes', category: 'Vegetables', emoji: '🍅', description: 'Mixed heirloom varieties — Cherokee Purple, Brandywine and local desi.', origin: 'Mulshi, Pune', seasonality: 'year_round', seasonMonths: [], storage: 'Keep at room temperature, away from sunlight.', organicClaim: 'certified', certificateId: 'd_cert1', status: 'approved', lowStockThreshold: 12,
      variants: [v('v1', '500 g', 'GV-TOM-500', 500, 'g', 89, 64), v('v2', '1 kg', 'GV-TOM-1K', 1, 'kg', 169, 31, 189)] }),
    P({ id: 'p_coriander', name: 'Fresh Coriander', slug: 'fresh-coriander', category: 'Herbs', emoji: '🌿', description: 'Fragrant coriander bunches with roots on.', origin: 'Mulshi, Pune', seasonality: 'year_round', seasonMonths: [], storage: 'Wrap roots in damp cloth and refrigerate.', organicClaim: 'certified', certificateId: 'd_cert1', status: 'approved', lowStockThreshold: 20,
      variants: [v('v1', '1 bunch', 'GV-COR-1B', 1, 'bunch', 25, 0)] }),
    P({ id: 'p_banana', name: 'Elaichi Banana', slug: 'elaichi-banana', category: 'Fruits', emoji: '🍌', description: 'Small, sweet cardamom bananas.', origin: 'Jalgaon, Maharashtra', seasonality: 'year_round', seasonMonths: [], storage: 'Hang at room temperature.', organicClaim: 'in_conversion', status: 'approved', lowStockThreshold: 10,
      variants: [v('v1', '6 pieces', 'GV-BAN-6P', 6, 'piece', 69, 55), v('v2', '12 pieces', 'GV-BAN-12P', 12, 'piece', 129, 22)] }),
    P({ id: 'p_carrot', name: 'Ooty Carrots', slug: 'ooty-carrots', category: 'Root Vegetables', emoji: '🥕', description: 'Crunchy, sweet carrots.', origin: 'Nilgiris, Tamil Nadu', seasonality: 'year_round', seasonMonths: [], storage: 'Refrigerate in a breathable bag up to 2 weeks.', organicClaim: 'none', status: 'approved', lowStockThreshold: 10,
      variants: [v('v1', '500 g', 'GV-CAR-500', 500, 'g', 49, 80), v('v2', '1 kg', 'GV-CAR-1K', 1, 'kg', 92, 40)] }),
    P({ id: 'p_okra', name: 'Tender Okra', slug: 'tender-okra', category: 'Vegetables', emoji: '🫛', description: 'Young okra pods, picked before they turn fibrous.', origin: 'Mulshi, Pune', seasonality: 'seasonal', seasonMonths: [6, 7, 8, 9, 10], storage: 'Refrigerate dry, use within 3 days.', organicClaim: 'certified', certificateId: 'd_cert1', status: 'approved', lowStockThreshold: 10,
      variants: [v('v1', '250 g', 'GV-OKR-250', 250, 'g', 39, 9), v('v2', '500 g', 'GV-OKR-500', 500, 'g', 72, 26)] }),
    P({ id: 'p_basil', name: 'Italian Basil', slug: 'italian-basil', category: 'Herbs', emoji: '🌱', description: 'Genovese basil, great for pesto.', origin: 'Mulshi, Pune', seasonality: 'year_round', seasonMonths: [], storage: 'Keep stems in water at room temperature.', organicClaim: 'certified', certificateId: 'd_cert1', status: 'approved', lowStockThreshold: 8,
      variants: [v('v1', '100 g', 'GV-BSL-100', 100, 'g', 79, 18)] }),
    P({ id: 'p_papaya', name: 'Red Lady Papaya', slug: 'red-lady-papaya', category: 'Fruits', emoji: '🍈', description: 'Sweet, deep-orange flesh.', origin: 'Satara, Maharashtra', seasonality: 'year_round', seasonMonths: [], storage: 'Ripen at room temperature.', organicClaim: 'none', status: 'inactive', available: false, lowStockThreshold: 5,
      variants: [v('v1', '1 piece (~1.2 kg)', 'GV-PAP-1P', 1, 'piece', 119, 0)] }),
    P({ id: 'p_avocado', name: 'Hass Avocado', slug: 'hass-avocado', category: 'Exotic', emoji: '🥑', description: 'Creamy Hass avocados.', origin: 'Coorg, Karnataka', seasonality: 'seasonal', seasonMonths: [7, 8, 9, 10, 11], storage: 'Ripen at room temperature, refrigerate when soft.', organicClaim: 'certified', status: 'rejected', moderationNote: 'Certified organic claim needs a certificate that covers Coorg-sourced produce. Your uploaded certificate scope is limited to the Mulshi farm cluster. Either upload the supplier’s certificate or change the claim to “No organic claim”.', lowStockThreshold: 5,
      variants: [v('v1', '2 pieces', 'GV-AVO-2P', 2, 'piece', 299, 20)] }),
    P({ id: 'p_beet', name: 'Beetroot', slug: 'beetroot', category: 'Root Vegetables', emoji: '🫜', description: 'Earthy, sweet beetroot with greens.', origin: 'Mulshi, Pune', seasonality: 'year_round', seasonMonths: [], storage: 'Refrigerate, greens separately.', organicClaim: 'certified', certificateId: 'd_cert1', status: 'pending', lowStockThreshold: 10,
      variants: [v('v1', '500 g', 'GV-BET-500', 500, 'g', 45, 50)] }),
    P({ id: 'p_microgreens', name: 'Sunflower Microgreens', slug: 'sunflower-microgreens', category: 'Leafy Greens', emoji: '🌻', description: 'Draft — description to be written.', origin: '', seasonality: 'year_round', seasonMonths: [], storage: '', organicClaim: 'none', status: 'draft', lowStockThreshold: 5,
      variants: [v('v1', '100 g', 'GV-MCG-100', 100, 'g', 99, 0)] }),
    // Seller B products, used to verify isolation
    { id: 'p_sr_kale', sellerId: SELLER_B, name: 'Curly Kale', slug: 'curly-kale', category: 'Exotic', emoji: '🥬', description: 'Hydroponic curly kale.', origin: 'Hinjewadi, Pune', seasonality: 'year_round', seasonMonths: [], storage: 'Refrigerate.', organicClaim: 'none', status: 'approved', available: true, minQty: 1, maxQty: 5, lowStockThreshold: 5, archived: false, updatedAt: iso(2 * DAY),
      variants: [v('v1', '200 g', 'SR-KAL-200', 200, 'g', 120, 30)] },
  ];

  // ---- Orders ----
  const r = rng(20261024);
  const firstNames = ['Priya', 'Arjun', 'Meera', 'Karan', 'Sneha', 'Rohan', 'Isha', 'Aditya', 'Neha', 'Siddharth', 'Pooja', 'Varun', 'Tanvi', 'Nikhil'];
  const areas = sellers[0]!.serviceAreas;
  const sellable = products.filter((p) => p.sellerId === SELLER_A && ['approved'].includes(p.status) && p.id !== 'p_papaya');
  const orders: SubOrder[] = [];
  const pick = <T,>(arr: T[]) => arr[Math.floor(r() * arr.length)]!;

  const flow: OrderStatus[] = ['awaiting_confirmation', 'accepted', 'packed', 'ready_for_pickup', 'in_transit', 'delivered'];
  const actorFor = (s: OrderStatus) =>
    s === 'awaiting_confirmation' ? 'Customer checkout' : s === 'in_transit' || s === 'delivered' ? 'Delivery partner' : 'Ananya K. (seller)';

  for (let i = 0; i < 132; i++) {
    const ageMs = Math.floor(Math.pow(r(), 1.25) * 88 * DAY) + 20 * 60_000;
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
        address: `Flat ${Math.floor(101 + r() * 900)}, ${pick(['Sai Residency', 'Green Meadows', 'Lotus Towers', 'Palm Grove'])}`,
        ...(r() < 0.3 ? { instructions: pick(['Leave with security', 'Call on arrival', 'No plastic bags please']) } : {}),
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
    { id: 'PR-0007', sellerId: SELLER_A, amount: 4200, requestedAt: iso(26 * DAY), state: 'paid', note: 'Included in STL settlement' },
  ];

  // ---- Reviews ----
  const reviewTexts: [number, string, string][] = [
    [5, 'Best mangoes this season', 'Sweet, fragrant and perfectly ripe. Packed beautifully.'],
    [5, 'Super fresh spinach', 'Lasted almost a week in the fridge. No yellow leaves.'],
    [4, 'Good tomatoes', 'Great flavour, a couple were slightly soft.'],
    [5, 'Coriander smells amazing', 'You can tell it was picked the same day.'],
    [3, 'Bananas were unripe', 'Took 4 days to ripen. Taste was fine eventually.'],
    [5, 'Reliable every week', 'Have ordered 10+ times. Always on time.'],
    [2, 'Okra was fibrous', 'Half the okra was too mature to cook.'],
    [4, 'Nice carrots', 'Sweet and crunchy, would buy again.'],
    [5, 'Basil for pesto', 'Very aromatic, made great pesto.'],
    [4, 'Fresh but small bunch', 'Quality is good, quantity could be better.'],
    [1, 'Late delivery', 'Arrived 2 hours after slot. Greens had wilted.'],
    [5, 'Lovely heirloom mix', 'The colours and flavours are fantastic.'],
  ];
  const delivered = orders.filter((o) => o.sellerId === SELLER_A && o.status === 'delivered');
  const reviews: Review[] = reviewTexts.map(([rating, title, body], i) => {
    const o = delivered[(i * 5 + 3) % delivered.length]!;
    return {
      id: `rv${i + 1}`,
      sellerId: SELLER_A,
      productId: o.items[0]!.productId,
      subOrderId: o.id,
      rating,
      title,
      body,
      customerFirstName: o.customer.firstName,
      date: new Date(new Date(o.placedAt).getTime() + 2 * DAY).toISOString(),
      ...(i === 1 || i === 4 ? { reply: { body: 'Thank you for the feedback! We have adjusted our harvest timing.', at: new Date(new Date(o.placedAt).getTime() + 3 * DAY).toISOString() } } : {}),
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
  ];

  const notifications: AppNotification[] = [
    { id: 'n1', sellerId: SELLER_A, topic: 'new_order', title: 'New order awaiting confirmation', body: 'Accept or reject within your 30-minute window.', at: iso(20 * 60_000), read: false, link: '/seller/orders?status=awaiting_confirmation' },
    { id: 'n2', sellerId: SELLER_A, topic: 'moderation', title: 'Listing rejected: Hass Avocado', body: 'Certificate scope does not cover this product’s origin.', at: iso(1 * DAY), read: false, link: '/seller/products/p_avocado' },
    { id: 'n3', sellerId: SELLER_A, topic: 'low_stock', title: '3 variants are low on stock', body: 'Baby Spinach, Tender Okra and Alphonso Mango box.', at: iso(5 * 3_600_000), read: false, link: '/seller/inventory?filter=low' },
    { id: 'n4', sellerId: SELLER_A, topic: 'settlement', title: 'Settlement processing', body: 'A settlement for last period is being processed.', at: iso(2 * DAY), read: true, link: '/seller/settlements' },
    { id: 'n5', sellerId: SELLER_A, topic: 'moderation', title: 'Organic certificate expires in 21 days', body: 'Upload a renewed certificate to keep organic labels on your listings.', at: iso(1 * DAY), read: true, link: '/seller/documents' },
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
