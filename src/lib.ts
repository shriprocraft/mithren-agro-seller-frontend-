// Pure helpers: formatting, validation, CSV and order-flow rules.
// Kept free of DOM access so they can be unit-tested in Node.

import type { OrderStatus, SettlementState, ProductStatus, SellerStatus, Unit } from './types.js';

// ---------- formatting ----------
const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2, minimumFractionDigits: 0 });
const inr2 = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num = new Intl.NumberFormat('en-IN');

export const money = (n: number) => inr.format(n);
export const money2 = (n: number) => inr2.format(n);
export const count = (n: number) => num.format(n);

export function fmtDate(iso: string, withTime = false) {
  const d = new Date(iso);
  return d.toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: withTime ? undefined : 'numeric',
    ...(withTime ? { hour: 'numeric', minute: '2-digit' } : {}),
  });
}

export function timeAgo(iso: string, now = Date.now()) {
  const s = Math.round((now - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return d < 30 ? `${d} d ago` : fmtDate(iso);
}

export function slugify(s: string) {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

// ---------- labels ----------
export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  awaiting_confirmation: 'Awaiting confirmation',
  accepted: 'Accepted',
  packed: 'Packed',
  ready_for_pickup: 'Ready for pickup',
  in_transit: 'In transit',
  delivered: 'Delivered',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
  return_requested: 'Return requested',
  returned: 'Returned',
};

export const PRODUCT_STATUS_LABEL: Record<ProductStatus, string> = {
  draft: 'Draft',
  pending: 'Pending approval',
  approved: 'Approved',
  rejected: 'Rejected',
  inactive: 'Inactive',
};

export const SETTLEMENT_LABEL: Record<SettlementState, string> = {
  pending: 'Pending',
  eligible: 'Eligible',
  processing: 'Processing',
  paid: 'Paid',
  failed: 'Failed',
  reversed: 'Reversed',
};

export const SELLER_STATUS_LABEL: Record<SellerStatus, string> = {
  not_registered: 'Not registered',
  submitted: 'Application submitted',
  under_review: 'Under review',
  changes_requested: 'Changes requested',
  approved: 'Approved',
  rejected: 'Rejected',
  suspended: 'Suspended',
};

export const UNIT_LABEL: Record<Unit, string> = { g: 'grams', kg: 'kilograms', bunch: 'bunch', piece: 'piece', box: 'box' };

// ---------- order flow ----------
/** Transitions a seller may perform. In-transit and delivered are set by the delivery workflow. */
export const SELLER_TRANSITIONS: Partial<Record<OrderStatus, OrderStatus[]>> = {
  awaiting_confirmation: ['accepted', 'rejected'],
  accepted: ['packed', 'cancelled'],
  packed: ['ready_for_pickup', 'cancelled'],
};

export const FULFILMENT_FLOW: OrderStatus[] = ['awaiting_confirmation', 'accepted', 'packed', 'ready_for_pickup', 'in_transit', 'delivered'];

export function canSellerTransition(from: OrderStatus, to: OrderStatus) {
  return (SELLER_TRANSITIONS[from] ?? []).includes(to);
}

export const ACTIVE_STATUSES: OrderStatus[] = ['awaiting_confirmation', 'accepted', 'packed', 'ready_for_pickup', 'in_transit'];

// ---------- validation ----------
export const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
export const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
export const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export const PHONE_RE = /^(\+91[\s-]?)?[6-9]\d{9}$/;
export const PINCODE_RE = /^[1-9][0-9]{5}$/;
export const SKU_RE = /^[A-Z0-9][A-Z0-9-]{2,31}$/;

export const UPLOAD_RULES = {
  maxBytes: 5 * 1024 * 1024,
  mimeTypes: ['application/pdf', 'image/jpeg', 'image/png'],
  label: 'PDF, JPG or PNG, up to 5 MB',
};

export function validateUpload(file: { size: number; type: string; name: string }): string | null {
  if (!UPLOAD_RULES.mimeTypes.includes(file.type)) return `“${file.name}” is not an accepted file type (${UPLOAD_RULES.label}).`;
  if (file.size > UPLOAD_RULES.maxBytes) return `“${file.name}” is ${(file.size / 1048576).toFixed(1)} MB — the limit is 5 MB.`;
  if (file.size === 0) return `“${file.name}” is empty.`;
  return null;
}

export function passwordIssues(pw: string): string[] {
  const issues: string[] = [];
  if (pw.length < 10) issues.push('at least 10 characters');
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) issues.push('letters and numbers');
  return issues;
}

// ---------- CSV ----------
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') inQuotes = false;
      else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      if (row.some((f) => f.trim() !== '')) rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== '')) rows.push(row);
  return rows;
}

export function toCsv(rows: (string | number)[][]): string {
  return rows
    .map((r) =>
      r
        .map((v) => {
          const s = String(v);
          // Neutralise spreadsheet formula injection
          const safe = /^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s) ? `'${s}` : s;
          return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
        })
        .join(','),
    )
    .join('\n');
}

export interface CsvStockRow {
  line: number;
  sku: string;
  stock: number;
  price?: number;
}

export interface CsvValidation {
  rows: CsvStockRow[];
  errors: { line: number; message: string }[];
}

/** Validates an inventory CSV with columns: sku, stock[, price]. */
export function validateInventoryCsv(text: string, knownSkus: Set<string>): CsvValidation {
  const parsed = parseCsv(text);
  const errors: CsvValidation['errors'] = [];
  const rows: CsvStockRow[] = [];
  if (parsed.length === 0) return { rows, errors: [{ line: 1, message: 'The file is empty.' }] };
  const header = parsed[0]!.map((h) => h.trim().toLowerCase());
  const iSku = header.indexOf('sku');
  const iStock = header.indexOf('stock');
  const iPrice = header.indexOf('price');
  if (iSku < 0 || iStock < 0) return { rows, errors: [{ line: 1, message: 'Header row must include “sku” and “stock” columns.' }] };
  const seen = new Set<string>();
  parsed.slice(1).forEach((cells, idx) => {
    const line = idx + 2;
    const sku = (cells[iSku] ?? '').trim().toUpperCase();
    const stockRaw = (cells[iStock] ?? '').trim();
    const priceRaw = iPrice >= 0 ? (cells[iPrice] ?? '').trim() : '';
    if (!sku) return errors.push({ line, message: 'SKU is missing.' });
    if (!knownSkus.has(sku)) return errors.push({ line, message: `SKU ${sku} does not match any of your products.` });
    if (seen.has(sku)) return errors.push({ line, message: `SKU ${sku} appears more than once.` });
    if (!/^\d+$/.test(stockRaw)) return errors.push({ line, message: `Stock “${stockRaw}” must be a whole number ≥ 0.` });
    const stock = Number(stockRaw);
    if (stock > 100000) return errors.push({ line, message: 'Stock exceeds the 100,000 limit.' });
    let price: number | undefined;
    if (priceRaw) {
      if (!/^\d+(\.\d{1,2})?$/.test(priceRaw) || Number(priceRaw) <= 0) return errors.push({ line, message: `Price “${priceRaw}” must be a positive amount.` });
      price = Number(priceRaw);
    }
    seen.add(sku);
    rows.push({ line, sku, stock, ...(price !== undefined ? { price } : {}) });
    return undefined;
  });
  return { rows, errors };
}
