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
