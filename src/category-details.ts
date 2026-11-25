// Product details by category field type. The Super Admin sets each category's field type; the backend
// checks the same rules (app/services/seller_categories.py DETAIL_FIELDS). Kept free of the DOM.

import type { CategoryFieldType } from './api.js';

export interface DetailField {
  key: string;
  label: string;
  required: boolean;
  kind: 'text' | 'long' | 'date' | 'choice';
  placeholder?: string;
  hint?: string;
  choices?: [string, string][];
}

const MADE_BY: [string, string][] = [
  ['machine_made', 'Machine-made'],
  ['handmade', 'Handmade (made or stitched by hand)'],
  ['handloom', 'Handloom'],
];
const COUNTRY: DetailField = { key: 'country_of_origin', label: 'Country of origin', required: false, kind: 'text', placeholder: 'e.g. India' };

export const DETAIL_FIELDS: Record<CategoryFieldType, DetailField[]> = {
  // Fresh produce keeps the origin, harvest and storage fields the form already has.
  fresh_produce: [],
  packaged_food: [
    { key: 'manufacturer_fssai', label: 'Manufacturer FSSAI number', required: false, kind: 'text', placeholder: 'The 14-digit number on the pack', hint: 'Optional. Leave it empty for products made under Mithren Agro’s FSSAI licence.' },
    { key: 'best_before', label: 'Best before date', required: true, kind: 'date' },
    { key: 'manufacturer', label: 'Manufacturer or packer', required: true, kind: 'text', placeholder: 'Name and town on the pack' },
    { key: 'product_type', label: 'Type', required: false, kind: 'text', placeholder: 'e.g. Cold-pressed, Refined, Stone-ground' },
    COUNTRY,
  ],
  cosmetics: [
    { key: 'ingredients', label: 'Ingredients', required: true, kind: 'long', placeholder: 'As listed on the pack, in the same order' },
    { key: 'expiry_date', label: 'Expiry date', required: true, kind: 'date' },
    { key: 'mfg_licence', label: 'Manufacturing licence number', required: true, kind: 'text', placeholder: 'Mfg. Lic. No. on the pack' },
    { key: 'manufacturer', label: 'Manufacturer', required: true, kind: 'text', placeholder: 'Name and town on the pack' },
    { key: 'suitable_for', label: 'Skin or hair type', required: false, kind: 'text', placeholder: 'e.g. All skin types, Dry hair' },
    { key: 'how_to_use', label: 'How to use', required: false, kind: 'long' },
    COUNTRY,
  ],
  apparel: [
    { key: 'fabric', label: 'Fabric', required: true, kind: 'text', placeholder: 'e.g. Cotton, Silk cotton' },
    { key: 'wash_care', label: 'Wash care', required: true, kind: 'text', placeholder: 'e.g. Hand wash cold, dry in shade' },
    { key: 'made_by', label: 'How it’s made', required: false, kind: 'choice', choices: MADE_BY },
    { key: 'handloom_mark', label: 'Handloom Mark number', required: false, kind: 'text', hint: 'Only if it carries the Handloom Mark or India Handloom Brand.' },
    { key: 'fit', label: 'Fit', required: false, kind: 'text', placeholder: 'e.g. Regular, Relaxed' },
    { key: 'colour', label: 'Colour', required: false, kind: 'text' },
    { key: 'occasion', label: 'Occasion', required: false, kind: 'text', placeholder: 'e.g. Daily wear, Festive' },
    { key: 'manufacturer', label: 'Manufacturer', required: false, kind: 'text' },
    COUNTRY,
  ],
  crafts: [
    { key: 'material', label: 'Material', required: true, kind: 'text', placeholder: 'e.g. Glass, Terracotta, Brass' },
    { key: 'made_by', label: 'How it’s made', required: false, kind: 'choice', choices: MADE_BY },
    { key: 'handloom_mark', label: 'Handloom Mark number', required: false, kind: 'text', hint: 'Only for handloom items carrying the mark.' },
    { key: 'colour', label: 'Colour', required: false, kind: 'text' },
    { key: 'dimensions', label: 'Size or dimensions', required: false, kind: 'text', placeholder: 'e.g. 2.4 inch, 10 × 15 cm' },
    { key: 'care', label: 'Care instructions', required: false, kind: 'text' },
    { key: 'manufacturer', label: 'Manufacturer or importer', required: false, kind: 'text' },
    COUNTRY,
  ],
  farm_inputs: [
    {
      key: 'input_type',
      label: 'Type',
      required: true,
      kind: 'choice',
      choices: [
        ['organic', 'Organic'],
        ['bio', 'Bio-fertilizer'],
        ['chemical', 'Chemical'],
      ],
    },
    { key: 'composition', label: 'Composition (NPK)', required: true, kind: 'text', placeholder: 'e.g. N 2%, P 1%, K 1%' },
    { key: 'dosage', label: 'Dosage and how to use', required: true, kind: 'long' },
    { key: 'expiry_date', label: 'Expiry date', required: true, kind: 'date' },
    { key: 'suitable_crops', label: 'Suitable crops', required: false, kind: 'text' },
    { key: 'safety_note', label: 'Safety note', required: false, kind: 'long', placeholder: 'e.g. Keep away from children; wear gloves' },
    { key: 'mfg_date', label: 'Manufacturing date', required: false, kind: 'date' },
    { key: 'manufacturer', label: 'Manufacturer', required: false, kind: 'text' },
    COUNTRY,
  ],
};

/** Field errors (key: details_<field>) for the details a category needs. */
export function detailErrors(type: CategoryFieldType, details: Record<string, string>, today = new Date().toISOString().slice(0, 10)): Record<string, string> {
  const e: Record<string, string> = {};
  for (const f of DETAIL_FIELDS[type] ?? []) {
    const v = (details[f.key] ?? '').trim();
    if (f.required && !v) e[`details_${f.key}`] = `${f.label} is required.`;
    else if (v && f.key === 'manufacturer_fssai' && !/^\d{14}$/.test(v.replace(/\s/g, ''))) e[`details_${f.key}`] = 'The FSSAI number has 14 digits.';
    else if (v && (f.key === 'best_before' || f.key === 'expiry_date') && v < today) e[`details_${f.key}`] = 'This date has passed.';
  }
  return e;
}

/** Only the details this field type has, with empty ones left out. */
export function keepDetails(type: CategoryFieldType, details: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of DETAIL_FIELDS[type] ?? []) {
    const v = (details[f.key] ?? '').trim();
    if (v) out[f.key] = f.key === 'manufacturer_fssai' ? v.replace(/\s/g, '') : v;
  }
  return out;
}
