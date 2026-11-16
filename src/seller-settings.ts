// Store settings kept on the backend (shop_details.portal_settings), so every device and browser
// the seller signs in on shows the same. Kept free of browser APIs so it can be unit-tested.

import type { Seller } from './types.js';

export type SettingsPatch = Partial<
  Pick<Seller, 'serviceAreas' | 'workingHours' | 'holidays' | 'fulfilment' | 'notifications' | 'brandColor' | 'bannerTagline' | 'staff'>
>;
export const SETTINGS_KEYS = ['serviceAreas', 'workingHours', 'holidays', 'fulfilment', 'notifications', 'brandColor', 'bannerTagline', 'staff'] as const;

/** The backend's PortalSettings (snake_case). On PUT, the fields sent replace the stored ones. */
export interface BackendSettings {
  service_areas?: string[];
  working_hours?: { day: string; open: string; close: string; closed: boolean }[];
  holidays?: { id: string; date: string; note: string }[];
  fulfilment?: { auto_accept: boolean; accept_window_mins: number; packing_time_mins: number; min_order_value: number };
  notifications?: Record<string, Record<string, boolean>>;
  brand_color?: string;
  banner_tagline?: string;
  staff?: { id: string; name: string; email: string; role: 'manager' | 'packer'; invited_at: string; active: boolean }[];
}

export const hasSettings = (b: BackendSettings | null | undefined): b is BackendSettings => !!b && Object.keys(b).length > 0;

/** Only the settings present in the patch. */
export function toBackendSettings(p: SettingsPatch): BackendSettings {
  const out: BackendSettings = {};
  if (p.serviceAreas) out.service_areas = p.serviceAreas.map((a) => a.trim()).filter(Boolean).slice(0, 200);
  if (p.workingHours) out.working_hours = p.workingHours.map(({ day, open, close, closed }) => ({ day, open, close, closed }));
  if (p.holidays) out.holidays = p.holidays.map(({ id, date, note }) => ({ id, date, note: (note ?? '').slice(0, 120) }));
  if (p.fulfilment)
    out.fulfilment = {
      auto_accept: p.fulfilment.autoAccept,
      accept_window_mins: p.fulfilment.acceptWindowMins,
      packing_time_mins: p.fulfilment.packingTimeMins,
      min_order_value: p.fulfilment.minOrderValue,
    };
  if (p.notifications) out.notifications = structuredClone(p.notifications) as Record<string, Record<string, boolean>>;
  if (p.brandColor !== undefined && /^#[0-9A-Fa-f]{6}$/.test(p.brandColor)) out.brand_color = p.brandColor;
  if (p.bannerTagline !== undefined) out.banner_tagline = p.bannerTagline.slice(0, 120);
  if (p.staff)
    out.staff = p.staff.map(({ id, name, email, role, invitedAt, active }) => ({ id, name, email, role, invited_at: invitedAt, active }));
  return out;
}

/** The stored settings as a patch for the portal's seller. */
export function fromBackendSettings(b: BackendSettings): SettingsPatch {
  const out: SettingsPatch = {};
  if (b.service_areas) out.serviceAreas = [...b.service_areas];
  if (b.working_hours) out.workingHours = b.working_hours.map((h) => ({ ...h })) as Seller['workingHours'];
  if (b.holidays) out.holidays = b.holidays.map((h) => ({ ...h }));
  if (b.fulfilment)
    out.fulfilment = {
      autoAccept: b.fulfilment.auto_accept,
      acceptWindowMins: b.fulfilment.accept_window_mins,
      packingTimeMins: b.fulfilment.packing_time_mins,
      minOrderValue: b.fulfilment.min_order_value,
    };
  if (b.notifications) out.notifications = structuredClone(b.notifications) as Seller['notifications'];
  if (b.brand_color !== undefined) out.brandColor = b.brand_color;
  if (b.banner_tagline !== undefined) out.bannerTagline = b.banner_tagline;
  if (b.staff) out.staff = b.staff.map(({ invited_at, ...s }) => ({ ...s, invitedAt: invited_at }));
  return out;
}

/** The settings part of a seller, for a first upload of this device's settings. */
export function settingsOf(s: Seller): SettingsPatch {
  return Object.fromEntries(SETTINGS_KEYS.map((k) => [k, s[k]])) as SettingsPatch;
}

/** JSON with object keys sorted, so the same settings always compare equal whatever their key order. */
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    const o = value as Record<string, unknown>;
    return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${stable(o[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/** The keys of `patch` whose values differ from the seller's, so unchanged settings aren't rewritten. */
export function changedSettings(s: Seller, patch: SettingsPatch): SettingsPatch {
  const out: SettingsPatch = {};
  for (const k of SETTINGS_KEYS) {
    if (patch[k] !== undefined && stable(patch[k]) !== stable(s[k])) (out as Record<string, unknown>)[k] = patch[k];
  }
  return out;
}
