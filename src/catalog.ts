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

/** The body of POST /api/v1/products. */
export interface BackendProduct {
  seller_id: string;
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
export function toBackendProduct(p: FormProduct, sellerId: string, active: boolean): BackendProduct {
  const apparel = categoryKind(p.category) === 'apparel';
  const paise = (rupees: number, what: string) => {
    const value = rupeesToPaise(rupees);
    if (value === null || value < 1) throw new Error(`${what} must be a rupee amount with at most 2 decimals.`);
    return value;
  };
  const description = p.description.trim();
  return {
    seller_id: sellerId,
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
