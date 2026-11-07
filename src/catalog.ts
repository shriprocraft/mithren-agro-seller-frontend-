// Category-specific product rules, shared by the product form and the API.

/** Fashion categories: sold by size, with no organic claim or freshness details. */
export const APPAREL_CATEGORIES = ['Women Apparel', 'Women Accessories'] as const;
/** Produce categories: sold by weight or pack, with organic claims and freshness details. */
export const PRODUCE_CATEGORIES = ['Fruits', 'Vegetables', 'Leafy Greens', 'Root Vegetables', 'Herbs', 'Exotic'] as const;

export const APPAREL_SIZES = ['S', 'M', 'L', 'XL', 'XXL', 'Free Size'] as const;
export type ApparelSize = (typeof APPAREL_SIZES)[number];

/** apparel: size variants, no organic or freshness fields. produce and others: today's full form. */
export type CategoryKind = 'apparel' | 'produce' | 'other';

export function categoryKind(category: string): CategoryKind {
  if ((APPAREL_CATEGORIES as readonly string[]).includes(category)) return 'apparel';
  if ((PRODUCE_CATEGORIES as readonly string[]).includes(category)) return 'produce';
  return 'other';
}

export const isApparelSize = (s: unknown): s is ApparelSize => (APPAREL_SIZES as readonly unknown[]).includes(s);

/**
 * Rupees to integer paise, as the backend requires (rule K3: money is BIGINT paise).
 * Returns null unless the amount is a finite, non-negative rupee value with at most two decimals,
 * so a price is never silently rounded.
 */
export function rupeesToPaise(rupees: number): number | null {
  if (typeof rupees !== 'number' || !Number.isFinite(rupees) || rupees < 0) return null;
  const paise = Math.round(rupees * 100);
  if (Math.abs(rupees * 100 - paise) > 1e-6 || !Number.isSafeInteger(paise)) return null;
  return paise;
}

// ---------- FastAPI product payload ----------

export interface BackendVariant {
  label: string;
  sku: string;
  size?: ApparelSize;
  pack_size?: number;
  unit?: string;
  price_paise: number;
  mrp_paise?: number;
  stock: number;
}

/** The body of POST /api/v1/products. The seller comes from the Bearer token. */
export interface BackendProduct {
  title: string;
  description?: string;
  category: string;
  variants: BackendVariant[];
  images: string[];
  is_active: boolean;
}

interface FormProduct {
  name: string;
  description: string;
  category: string;
  variants: { label: string; sku: string; size?: ApparelSize; packSize: number; unit: string; price: number; mrp?: number; stock: number }[];
}

/**
 * Maps the product form to the backend body. Rupee prices become integer paise with
 * rupeesToPaise; a price that can't convert exactly throws instead of being rounded.
 */
export function toBackendProduct(p: FormProduct, active: boolean): BackendProduct {
  const apparel = categoryKind(p.category) === 'apparel';
  const paise = (rupees: number, what: string) => {
    const value = rupeesToPaise(rupees);
    if (value === null || value < 1) throw new Error(`${what} must be a rupee amount with at most 2 decimals.`);
    return value;
  };
  const description = p.description.trim();
  return {
    title: p.name.trim(),
    ...(description ? { description } : {}),
    category: p.category,
    variants: p.variants.map((v, i) => ({
      label: v.label.trim(),
      sku: v.sku.trim().toUpperCase(),
      ...(apparel ? { size: v.size } : { pack_size: v.packSize, unit: v.unit }),
      price_paise: paise(v.price, `Variant ${i + 1} price`),
      ...(v.mrp !== undefined ? { mrp_paise: paise(v.mrp, `Variant ${i + 1} MRP`) } : {}),
      stock: v.stock,
    })),
    // Picked photos stay in the browser until image upload exists.
    images: [],
    is_active: active,
  };
}

/** The body of PATCH /api/v1/products/{id}: the whole form, so variants replace the stored list. */
export type BackendProductUpdate = Omit<BackendProduct, 'description' | 'images'> & { description: string | null };

/**
 * Maps the form to a PATCH body. Images are left out so photos stored on the server are kept,
 * and an empty description clears the stored one.
 */
export function toBackendUpdate(p: FormProduct, active: boolean): BackendProductUpdate {
  const { images: _images, description, ...rest } = toBackendProduct(p, active);
  void _images;
  return { ...rest, description: description ?? null };
}

// ---------- automatic SKUs ----------

const CATEGORY_CODES: Record<string, string> = {
  Fruits: 'FRT',
  Vegetables: 'VEG',
  'Leafy Greens': 'LFG',
  'Root Vegetables': 'RTV',
  Herbs: 'HRB',
  Exotic: 'EXO',
  'Women Apparel': 'APP',
  'Women Accessories': 'ACC',
  Others: 'OTH',
};
const UNIT_CODES: Record<string, string> = { g: 'G', kg: 'KG', bunch: 'BN', piece: 'PC', box: 'BX' };
// Pack words say nothing about the product, so they don't name it.
const PACK_WORDS = new Set(['G', 'GM', 'GMS', 'GRAM', 'GRAMS', 'KG', 'KGS', 'BUNCH', 'PIECE', 'PIECES', 'PCS', 'BOX', 'PACK', 'SIZE', 'FREE', 'ML', 'LITRE']);

/** The product's main word: the last word of 3+ letters that isn't a pack word, e.g. "Cotton Kurti" -> KURTI. */
function nameCode(name: string): string {
  const words = name.toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim().split(' ').filter((w) => /^[A-Z]{3,}$/.test(w) && !PACK_WORDS.has(w));
  return (words[words.length - 1] ?? 'ITEM').slice(0, 10);
}

function variantCode(category: string, v: { size?: ApparelSize; packSize: number; unit: string }): string {
  if (categoryKind(category) === 'apparel') return v.size === 'Free Size' ? 'FS' : (v.size ?? '');
  if (!(v.packSize > 0)) return '';
  const qty = String(Number(v.packSize.toFixed(3))).replace('.', 'P');
  return `${qty}${UNIT_CODES[v.unit] ?? ''}`;
}

/**
 * A SKU from category, product name and variant, e.g. APP-KURTI-M or FRT-MANGO-500G.
 * `taken` holds SKUs already in use; a clash gets a numeric suffix (-2, -3, ...).
 */
export function generateSku(category: string, name: string, v: { size?: ApparelSize; packSize: number; unit: string }, taken: ReadonlySet<string> = new Set()): string {
  const base = [CATEGORY_CODES[category] ?? 'GEN', nameCode(name), variantCode(category, v)].filter(Boolean).join('-').slice(0, 29);
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}
