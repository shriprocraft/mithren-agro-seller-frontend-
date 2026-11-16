// The portal's own listing details, stored with the product on the backend (products.portal_meta),
// so every device and browser the seller signs in on shows the same product. Kept free of browser
// APIs so it can be unit-tested.

import type { OrganicClaim, Product, ProductStatus, Seasonality } from './types.js';

/** The backend's PortalMeta (snake_case). On PATCH, the fields sent are merged into the stored ones. */
export interface PortalMeta {
  origin?: string;
  seasonality?: Seasonality;
  season_months?: number[];
  harvest_date?: string;
  packed_date?: string;
  storage?: string;
  organic_claim?: OrganicClaim;
  certificate_id?: string;
  status?: ProductStatus;
  available?: boolean;
  archived?: boolean;
  min_qty?: number;
  max_qty?: number;
  low_stock_threshold?: number;
  emoji?: string;
  custom_category?: string;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(n)));
const isDate = (s: unknown): s is string => typeof s === 'string' && DATE.test(s);

/** Everything the portal knows about a product beyond what the Customer App uses. */
export function portalMetaOf(p: Product): PortalMeta {
  return {
    origin: (p.origin ?? '').slice(0, 120),
    seasonality: p.seasonality,
    season_months: (p.seasonMonths ?? []).filter((m) => Number.isInteger(m) && m >= 1 && m <= 12).slice(0, 12),
    ...(isDate(p.harvestDate) ? { harvest_date: p.harvestDate } : {}),
    ...(isDate(p.packedDate) ? { packed_date: p.packedDate } : {}),
    storage: (p.storage ?? '').slice(0, 300),
    organic_claim: p.organicClaim,
    ...(p.certificateId ? { certificate_id: p.certificateId.slice(0, 64) } : {}),
    status: p.status,
    available: p.available,
    archived: p.archived,
    min_qty: clamp(p.minQty || 1, 1, 1000),
    max_qty: clamp(p.maxQty || 10, 1, 1000),
    low_stock_threshold: clamp(p.lowStockThreshold ?? 10, 0, 100000),
    ...(p.emoji ? { emoji: p.emoji.slice(0, 8) } : {}),
    // Always sent, so clearing it (another category chosen) reaches other devices too.
    custom_category: p.category === 'Others' ? (p.customCategory ?? '').trim().slice(0, 40) : '',
  };
}

/** Just the listing's state: what Archive, Restore and the Available switch change. */
export const portalStateOf = (p: Product): PortalMeta => ({ status: p.status, available: p.available, archived: p.archived });

export const hasPortalMeta = (m: PortalMeta | null | undefined): m is PortalMeta => !!m && Object.keys(m).length > 0;

/** Copies the stored details onto the portal's product. Fields the backend doesn't have stay as they are. */
export function applyPortalMeta(p: Product, m: PortalMeta): void {
  if (m.origin !== undefined) p.origin = m.origin;
  if (m.seasonality !== undefined) p.seasonality = m.seasonality;
  if (m.season_months !== undefined) p.seasonMonths = [...m.season_months];
  if (m.harvest_date !== undefined) p.harvestDate = m.harvest_date;
  if (m.packed_date !== undefined) p.packedDate = m.packed_date;
  if (m.storage !== undefined) p.storage = m.storage;
  if (m.organic_claim !== undefined) p.organicClaim = m.organic_claim;
  if (m.certificate_id !== undefined) p.certificateId = m.certificate_id;
  // Older records may still say pending or rejected: there is no product review any more.
  if (m.status !== undefined) p.status = (m.status as string) === 'pending' ? 'approved' : (m.status as string) === 'rejected' ? 'draft' : m.status;
  if (m.available !== undefined) p.available = m.available;
  if (m.archived !== undefined) p.archived = m.archived;
  if (m.min_qty !== undefined) p.minQty = m.min_qty;
  if (m.max_qty !== undefined) p.maxQty = m.max_qty;
  if (m.low_stock_threshold !== undefined) p.lowStockThreshold = m.low_stock_threshold;
  if (m.emoji !== undefined) p.emoji = m.emoji;
  if (m.custom_category !== undefined) p.customCategory = m.custom_category || undefined;
}
