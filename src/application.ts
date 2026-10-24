// Seller application model and validation rules (scope doc §3.1–3.2).
//
// Shared by the browser (instant feedback) and the Node server (authoritative
// checks), so both sides apply exactly the same rules. Keep this module free of
// DOM and Node APIs.

import { CATEGORIES } from './data/seed.js';
import { ApiError } from './errors.js';
import type { Seller, SellerDocument, DocumentType } from './types.js';

export type ApplicationStatus = 'incomplete' | 'pending' | 'changes_requested' | 'approved' | 'rejected' | 'suspended';
export type CertificationStatus = 'not_submitted' | 'submitted' | 'verified' | 'rejected' | 'expired';
export type DocumentReviewStatus = 'unverified' | 'verified' | 'rejected';

export type BusinessType = 'individual_farmer' | 'proprietorship' | 'partnership' | 'llp' | 'private_limited' | 'fpo' | 'cooperative';
export type GstStatus = 'registered' | 'not_registered' | 'exempt';
export type ApplicationDocKind =
  | 'pan'
  | 'gst'
  | 'business_registration'
  | 'address_proof'
  | 'bank_proof'
  | 'organic_cert'
  | 'organic_evidence'
  | 'logo'
  | 'additional';

/** Non-sensitive application fields. Bank details are handled separately and never stored here. */
export interface ApplicationData {
  shopName: string;
  ownerName: string;
  contactName: string;
  businessEmail: string;
  primaryPhone: string;
  altPhone: string;
  description: string;
  addressLine1: string;
  addressLine2: string;
  country: string;
  state: string;
  district: string;
  city: string;
  pincode: string;
  serviceAreas: string[];
  productTypes: string[];
  pickupSameAsBusiness: boolean;
  pickupAddress: string;
  pickupPincode: string;
  businessType: BusinessType | '';
  gstStatus: GstStatus | '';
  gstin: string;
  pan: string;
  registrationNumber: string;
  claimsOrganic: boolean | null;
  certBody: string;
  certNumber: string;
  certIssueDate: string;
  certExpiryDate: string;
}

export interface BankInput {
  holderName: string;
  accountNumber: string;
  accountNumberConfirm: string;
  ifsc: string;
  bankName: string;
}

/** What the browser is allowed to see about bank details: masked only. */
export interface BankView {
  holderName: string;
  last4: string;
  ifsc: string;
  bankName: string;
  updatedAt: string;
}

export interface ApplicationDocument {
  id: string;
  kind: ApplicationDocKind;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  uploadedAt: string;
  status: DocumentReviewStatus;
  reviewerNote?: string;
}

export interface OrganicCertificationView {
  status: CertificationStatus;
  documentId?: string;
  reviewerNote?: string;
  reviewedAt?: string;
}

/** The authenticated seller's own application, as returned by the backend. */
export interface ApplicationView {
  referenceId: string | null;
  status: ApplicationStatus;
  currentStep: number;
  data: ApplicationData;
  bank: BankView | null;
  documents: ApplicationDocument[];
  organic: OrganicCertificationView;
  createdAt: string;
  submittedAt: string | null;
  lastSubmittedAt: string | null;
  updatedAt: string;
  reviewerMessage: string | null;
  requestedItems: string[];
  reviewedAt: string | null;
  /** Fields can be edited only while incomplete or when changes were requested. */
  editable: boolean;
}

export interface AccountView {
  userId: string;
  sellerId: string;
  fullName: string;
  email: string;
  phoneMasked: string;
  emailVerified: boolean;
  phoneVerified: boolean;
}

// ---------- labels ----------
export const APPLICATION_STATUS_LABEL: Record<ApplicationStatus, string> = {
  incomplete: 'Incomplete',
  pending: 'Pending review',
  changes_requested: 'Changes requested',
  approved: 'Approved',
  rejected: 'Rejected',
  suspended: 'Suspended',
};

export const CERTIFICATION_STATUS_LABEL: Record<CertificationStatus, string> = {
  not_submitted: 'Not submitted',
  submitted: 'Submitted for review',
  verified: 'Verified by reviewer',
  rejected: 'Rejected',
  expired: 'Expired',
};

export const BUSINESS_TYPES: [BusinessType, string][] = [
  ['individual_farmer', 'Individual farmer'],
  ['proprietorship', 'Sole proprietorship'],
  ['partnership', 'Partnership firm'],
  ['llp', 'Limited liability partnership (LLP)'],
  ['private_limited', 'Private limited company'],
  ['fpo', 'Farmer producer organisation (FPO)'],
  ['cooperative', 'Cooperative society'],
];

export const GST_STATUSES: [GstStatus, string][] = [
  ['registered', 'Registered for GST'],
  ['not_registered', 'Not registered (below threshold)'],
  ['exempt', 'Exempt (e.g. only unprocessed agricultural produce)'],
];

export const DOC_KIND_LABEL: Record<ApplicationDocKind, string> = {
  pan: 'PAN card',
  gst: 'GST registration certificate',
  business_registration: 'Business registration certificate',
  address_proof: 'Business address proof',
  bank_proof: 'Bank proof (cancelled cheque or statement)',
  organic_cert: 'Organic certificate',
  organic_evidence: 'Supporting organic evidence',
  logo: 'Store logo',
  additional: 'Additional document',
};

export const INDIAN_STATES = [
  'Andaman and Nicobar Islands', 'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chandigarh', 'Chhattisgarh',
  'Dadra and Nagar Haveli and Daman and Diu', 'Delhi', 'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jammu and Kashmir',
  'Jharkhand', 'Karnataka', 'Kerala', 'Ladakh', 'Lakshadweep', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya',
  'Mizoram', 'Nagaland', 'Odisha', 'Puducherry', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura',
  'Uttar Pradesh', 'Uttarakhand', 'West Bengal',
];

export const STEPS = [
  { n: 1, key: 'account', label: 'Account verification' },
  { n: 2, key: 'shop', label: 'Shop & owner details' },
  { n: 3, key: 'address', label: 'Address & service area' },
  { n: 4, key: 'products', label: 'Products & pickup' },
  { n: 5, key: 'kyc', label: 'Business & KYC' },
  { n: 6, key: 'bank', label: 'Bank & payout' },
  { n: 7, key: 'organic', label: 'Organic certification' },
  { n: 8, key: 'review', label: 'Review & submit' },
] as const;

/** Payout details are needed before approval because settlements are paid by bank transfer. */
export const PAYOUT_DETAILS_REQUIRED = true;

export const UPLOAD_LIMITS = {
  maxBytes: 5 * 1024 * 1024,
  logoMaxBytes: 2 * 1024 * 1024,
  documentTypes: ['application/pdf', 'image/jpeg', 'image/png'],
  logoTypes: ['image/jpeg', 'image/png'],
};

export function emptyApplicationData(): ApplicationData {
  return {
    shopName: '', ownerName: '', contactName: '', businessEmail: '', primaryPhone: '', altPhone: '', description: '',
    addressLine1: '', addressLine2: '', country: 'India', state: '', district: '', city: '', pincode: '', serviceAreas: [],
    productTypes: [], pickupSameAsBusiness: true, pickupAddress: '', pickupPincode: '',
    businessType: '', gstStatus: '', gstin: '', pan: '', registrationNumber: '',
    claimsOrganic: null, certBody: '', certNumber: '', certIssueDate: '', certExpiryDate: '',
  };
}

// ---------- normalisation ----------
const str = (v: unknown, max = 500) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const strList = (v: unknown, maxItems = 50, maxLen = 60) =>
  Array.isArray(v) ? [...new Set(v.map((x) => str(x, maxLen)).filter(Boolean))].slice(0, maxItems) : [];

/** Coerce untrusted input into ApplicationData, dropping unknown keys (e.g. a client-sent `status`). */
export function normaliseApplicationData(input: unknown): ApplicationData {
  const i = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const pick = <T extends string>(v: unknown, allowed: readonly T[]): T | '' => (allowed.includes(v as T) ? (v as T) : '');
  return {
    shopName: str(i.shopName, 60),
    ownerName: str(i.ownerName, 80),
    contactName: str(i.contactName, 80),
    businessEmail: str(i.businessEmail, 120).toLowerCase(),
    primaryPhone: normalisePhone(str(i.primaryPhone, 20)),
    altPhone: normalisePhone(str(i.altPhone, 20)),
    description: str(i.description, 800),
    addressLine1: str(i.addressLine1, 120),
    addressLine2: str(i.addressLine2, 120),
    country: 'India',
    state: pick(str(i.state, 60), INDIAN_STATES),
    district: str(i.district, 60),
    city: str(i.city, 60),
    pincode: str(i.pincode, 6),
    serviceAreas: strList(i.serviceAreas),
    productTypes: strList(i.productTypes, 20).filter((c) => CATEGORIES.includes(c)),
    pickupSameAsBusiness: i.pickupSameAsBusiness !== false,
    pickupAddress: str(i.pickupAddress, 240),
    pickupPincode: str(i.pickupPincode, 6),
    businessType: pick(i.businessType, BUSINESS_TYPES.map((b) => b[0])),
    gstStatus: pick(i.gstStatus, GST_STATUSES.map((g) => g[0])),
    gstin: str(i.gstin, 15).toUpperCase(),
    pan: str(i.pan, 10).toUpperCase(),
    registrationNumber: str(i.registrationNumber, 40).toUpperCase(),
    claimsOrganic: i.claimsOrganic === true ? true : i.claimsOrganic === false ? false : null,
    certBody: str(i.certBody, 120),
    certNumber: str(i.certNumber, 60),
    certIssueDate: /^\d{4}-\d{2}-\d{2}$/.test(str(i.certIssueDate)) ? str(i.certIssueDate) : '',
    certExpiryDate: /^\d{4}-\d{2}-\d{2}$/.test(str(i.certExpiryDate)) ? str(i.certExpiryDate) : '',
  };
}

export function normalisePhone(p: string) {
  const digits = p.replace(/[^\d+]/g, '');
  const m = /^(?:\+?91)?([6-9]\d{9})$/.exec(digits);
  return m ? `+91${m[1]}` : p.replace(/\s+/g, '');
}

export const maskPhone = (p: string) => (p.length >= 4 ? `${p.slice(0, 3)} •••••• ${p.slice(-4)}` : '••••');
export const maskAccount = (last4: string) => `•••• •••• ${last4}`;

// ---------- validation ----------
export const RE = {
  email: /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/,
  phone: /^\+91[6-9]\d{9}$/,
  pincode: /^[1-9]\d{5}$/,
  pan: /^[A-Z]{5}\d{4}[A-Z]$/,
  gstin: /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/,
  ifsc: /^[A-Z]{4}0[A-Z0-9]{6}$/,
  account: /^\d{9,18}$/,
  llpin: /^[A-Z]{3}-\d{4}$/,
  cin: /^[LU]\d{5}[A-Z]{2}\d{4}[A-Z]{3}\d{6}$/,
};

/**
 * Conditional KYC rules. Tax requirements depend on the seller's circumstances,
 * so nothing here applies to every seller. The operator should review these
 * rules with their legal adviser.
 */
export function kycRules(d: Pick<ApplicationData, 'businessType' | 'gstStatus' | 'pan'>) {
  const panRequired = d.gstStatus === 'registered' || (d.businessType !== '' && d.businessType !== 'individual_farmer');
  const gstinRequired = d.gstStatus === 'registered';
  const registrationRequired = ['partnership', 'llp', 'private_limited', 'fpo', 'cooperative'].includes(d.businessType);
  const registrationLabel: Record<string, string> = {
    partnership: 'Partnership firm registration number',
    llp: 'LLPIN',
    private_limited: 'Corporate identity number (CIN)',
    fpo: 'FPO registration number (CIN or society registration)',
    cooperative: 'Cooperative society registration number',
  };
  return {
    panRequired,
    gstinRequired,
    registrationRequired,
    registrationLabel: registrationLabel[d.businessType] ?? 'Business registration number',
  };
}

/** Documents the application needs, given its answers. */
export function requiredDocuments(d: ApplicationData): ApplicationDocKind[] {
  const r = kycRules(d);
  const docs: ApplicationDocKind[] = ['address_proof'];
  if (r.panRequired || d.pan) docs.push('pan');
  if (r.gstinRequired) docs.push('gst');
  if (r.registrationRequired) docs.push('business_registration');
  if (PAYOUT_DETAILS_REQUIRED) docs.push('bank_proof');
  if (d.claimsOrganic) docs.push('organic_cert');
  return docs;
}

export interface ValidationContext {
  documentKinds: ApplicationDocKind[];
  bankProvided: boolean;
  emailVerified: boolean;
  phoneVerified: boolean;
  today?: string;
}

type Errors = Record<string, string>;

export function validateStep(step: number, d: ApplicationData, ctx: ValidationContext): Errors {
  const e: Errors = {};
  const today = ctx.today ?? new Date().toISOString().slice(0, 10);
  const docMissing = (k: ApplicationDocKind) => !ctx.documentKinds.includes(k);
  switch (step) {
    case 1:
      if (!ctx.emailVerified) e.emailCode = 'Verify your email address to continue.';
      if (!ctx.phoneVerified) e.phoneCode = 'Verify your mobile number to continue.';
      break;
    case 2:
      if (d.shopName.length < 3) e.shopName = 'Shop name must be at least 3 characters.';
      if (d.ownerName.length < 2) e.ownerName = 'Enter the owner’s full name.';
      if (d.contactName && d.contactName.length < 2) e.contactName = 'Enter the contact person’s full name, or leave it blank.';
      if (!RE.email.test(d.businessEmail)) e.businessEmail = 'Enter a valid business email address.';
      if (!RE.phone.test(d.primaryPhone)) e.primaryPhone = 'Enter a 10-digit Indian mobile number.';
      if (d.altPhone && !RE.phone.test(d.altPhone)) e.altPhone = 'Enter a 10-digit Indian mobile number, or leave it blank.';
      if (d.altPhone && d.altPhone === d.primaryPhone) e.altPhone = 'Alternate number must be different from the primary number.';
      if (d.description.length < 30) e.description = 'Describe your business in at least 30 characters.';
      break;
    case 3:
      if (d.addressLine1.length < 5) e.addressLine1 = 'Enter the building and street.';
      if (!d.state) e.state = 'Choose a state or union territory.';
      if (d.district.length < 2) e.district = 'Enter the district.';
      if (d.city.length < 2) e.city = 'Enter the city, town or village.';
      if (!RE.pincode.test(d.pincode)) e.pincode = 'Enter a valid 6-digit PIN code.';
      if (!d.serviceAreas.length) e.serviceAreas = 'Add at least one locality or PIN code you deliver to.';
      else if (d.serviceAreas.some((a) => a.length < 2)) e.serviceAreas = 'Each service area must be at least 2 characters.';
      break;
    case 4:
      if (!d.productTypes.length) e.productTypes = 'Choose at least one product category.';
      if (!d.pickupSameAsBusiness) {
        if (d.pickupAddress.length < 10) e.pickupAddress = 'Enter the full pickup address.';
        if (!RE.pincode.test(d.pickupPincode)) e.pickupPincode = 'Enter a valid 6-digit PIN code.';
      }
      break;
    case 5: {
      if (!d.businessType) e.businessType = 'Choose your business type.';
      if (!d.gstStatus) e.gstStatus = 'Choose your GST registration status.';
      const r = kycRules(d);
      if (r.panRequired && !d.pan) e.pan = 'PAN is required for this business type.';
      else if (d.pan && !RE.pan.test(d.pan)) e.pan = 'PAN should look like ABCDE1234F.';
      if (r.gstinRequired) {
        if (!RE.gstin.test(d.gstin)) e.gstin = 'GSTIN should be 15 characters, like 27ABCDE1234F1Z5.';
        else if (d.pan && d.gstin.slice(2, 12) !== d.pan) e.gstin = 'GSTIN doesn’t match the PAN entered.';
      }
      if (r.registrationRequired) {
        if (d.businessType === 'llp' && !RE.llpin.test(d.registrationNumber)) e.registrationNumber = 'LLPIN should look like AAB-1234.';
        else if (d.businessType === 'private_limited' && !RE.cin.test(d.registrationNumber)) e.registrationNumber = 'CIN should be 21 characters, like U01100MH2020PTC123456.';
        else if (d.registrationNumber.length < 3) e.registrationNumber = `Enter your ${r.registrationLabel}.`;
      }
      for (const k of requiredDocuments(d)) {
        if (['pan', 'gst', 'business_registration', 'address_proof'].includes(k) && docMissing(k)) e[`doc_${k}`] = `Upload your ${DOC_KIND_LABEL[k].toLowerCase()}.`;
      }
      break;
    }
    case 6:
      if (PAYOUT_DETAILS_REQUIRED && !ctx.bankProvided) e.bank = 'Add your payout bank account.';
      if (PAYOUT_DETAILS_REQUIRED && docMissing('bank_proof')) e.doc_bank_proof = 'Upload a cancelled cheque or bank statement.';
      break;
    case 7:
      if (d.claimsOrganic === null) e.claimsOrganic = 'Tell us whether you sell certified organic products.';
      if (d.claimsOrganic) {
        if (d.certBody.length < 3) e.certBody = 'Enter the certification body or issuing organisation.';
        if (d.certIssueDate && d.certIssueDate > today) e.certIssueDate = 'Issue date can’t be in the future.';
        if (d.certExpiryDate && d.certExpiryDate <= today) e.certExpiryDate = 'This certificate has expired. Upload a current certificate.';
        if (d.certIssueDate && d.certExpiryDate && d.certExpiryDate <= d.certIssueDate) e.certExpiryDate = 'Expiry date must be after the issue date.';
        if (docMissing('organic_cert')) e.doc_organic_cert = 'Upload your organic certificate.';
      }
      break;
  }
  return e;
}

export function validateBank(b: BankInput): Errors {
  const e: Errors = {};
  if (str(b.holderName).length < 3) e.holderName = 'Enter the account holder name as it appears in bank records.';
  const acc = String(b.accountNumber ?? '').replace(/\s/g, '');
  if (!RE.account.test(acc)) e.accountNumber = 'Account number should be 9–18 digits.';
  else if (acc !== String(b.accountNumberConfirm ?? '').replace(/\s/g, '')) e.accountNumberConfirm = 'Account numbers don’t match.';
  if (!RE.ifsc.test(str(b.ifsc).toUpperCase())) e.ifsc = 'IFSC should look like HDFC0001234.';
  return e;
}

/** All steps that must pass before the application can be submitted. */
export function validateApplication(d: ApplicationData, ctx: ValidationContext): { step: number; errors: Errors } | null {
  for (let s = 1; s <= 7; s++) {
    const errors = validateStep(s, d, ctx);
    if (Object.keys(errors).length) return { step: s, errors };
  }
  return null;
}

export function sniffMime(bytes: Uint8Array): string | null {
  if (bytes.length >= 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) return 'application/pdf';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  return null;
}

export const isEditableStatus = (s: ApplicationStatus) => s === 'incomplete' || s === 'changes_requested';

// =====================================================================
// Application service rules, shared by the server and the browser stand-in.
// =====================================================================

export interface ApplicationRecord {
  id: string;
  userId: string;
  sellerId: string;
  referenceId: string | null;
  status: ApplicationStatus;
  currentStep: number;
  data: ApplicationData;
  createdAt: string;
  submittedAt: string | null;
  lastSubmittedAt: string | null;
  updatedAt: string;
  reviewerMessage: string | null;
  requestedItems: string[];
  reviewedAt: string | null;
  previousStatus: ApplicationStatus | null;
}

export interface DocumentRecord extends ApplicationDocument {
  applicationId: string;
  supersededAt: string | null;
}

export interface OrganicRecord {
  status: Exclude<CertificationStatus, 'expired'>;
  documentId: string | null;
  reviewerNote: string | null;
  reviewedAt: string | null;
}

/** Expired is derived from the expiry date at read time, never stored. */
export function organicStatus(rec: OrganicRecord | null, d: ApplicationData, today: string): CertificationStatus {
  if (!d.claimsOrganic || !rec || rec.status === 'not_submitted') return 'not_submitted';
  if (d.certExpiryDate && d.certExpiryDate < today && rec.status !== 'rejected') return 'expired';
  return rec.status;
}

export function buildView(app: ApplicationRecord, docs: DocumentRecord[], bank: BankView | null, organic: OrganicRecord | null, today = new Date().toISOString().slice(0, 10)): ApplicationView {
  const current = docs.filter((x) => !x.supersededAt);
  const status = organicStatus(organic, app.data, today);
  return {
    referenceId: app.referenceId,
    status: app.status,
    currentStep: app.currentStep,
    data: app.data,
    bank,
    documents: current.map(({ applicationId: _a, supersededAt: _s, ...pub }) => pub),
    organic: {
      status,
      ...(organic?.documentId ? { documentId: organic.documentId } : {}),
      ...(organic?.reviewerNote ? { reviewerNote: organic.reviewerNote } : {}),
      ...(organic?.reviewedAt ? { reviewedAt: organic.reviewedAt } : {}),
    },
    createdAt: app.createdAt,
    submittedAt: app.submittedAt,
    lastSubmittedAt: app.lastSubmittedAt,
    updatedAt: app.updatedAt,
    reviewerMessage: app.reviewerMessage,
    requestedItems: app.requestedItems,
    reviewedAt: app.reviewedAt,
    editable: isEditableStatus(app.status),
  };
}

/** Which documents a seller may upload in each status. */
export function canUpload(status: ApplicationStatus, kind: ApplicationDocKind): boolean {
  switch (status) {
    case 'incomplete':
    case 'changes_requested':
      return true;
    case 'pending':
      return kind === 'additional';
    case 'approved':
      return ['organic_cert', 'organic_evidence', 'additional', 'logo'].includes(kind);
    case 'suspended':
      return kind === 'additional';
    default:
      return false;
  }
}

export function assertCanEdit(app: ApplicationRecord) {
  if (!isEditableStatus(app.status)) {
    const why: Record<string, string> = {
      pending: 'Your application is under review, so its details are locked. You can still upload additional documents.',
      approved: 'Your application is approved. Update shop details in Store settings, or contact support to change verified details.',
      rejected: 'This application was rejected and can no longer be edited.',
      suspended: 'Your account is suspended. Contact seller support.',
    };
    throw new ApiError(409, why[app.status] ?? 'This application can’t be edited now.');
  }
}

export type AdminAction = 'approve' | 'reject' | 'request_changes' | 'suspend' | 'reinstate';

/** The review state machine. Only the Super Admin side may call this. */
export function adminTransition(app: ApplicationRecord, action: AdminAction): ApplicationStatus {
  const allowed: Record<AdminAction, ApplicationStatus[]> = {
    approve: ['pending'],
    reject: ['pending'],
    request_changes: ['pending'],
    suspend: ['approved'],
    reinstate: ['suspended'],
  };
  if (!allowed[action].includes(app.status)) throw new ApiError(409, `Can’t ${action.replace('_', ' ')} an application that is ${APPLICATION_STATUS_LABEL[app.status].toLowerCase()}.`);
  switch (action) {
    case 'approve':
      return 'approved';
    case 'reject':
      return 'rejected';
    case 'request_changes':
      return 'changes_requested';
    case 'suspend':
      return 'suspended';
    case 'reinstate':
      // Restore the status held before suspension (normally approved).
      return app.previousStatus && app.previousStatus !== 'suspended' ? app.previousStatus : 'approved';
  }
}

const DOC_TO_WORKSPACE: Record<ApplicationDocKind, DocumentType> = {
  pan: 'pan',
  gst: 'gst',
  business_registration: 'business_registration',
  address_proof: 'address_proof',
  bank_proof: 'bank_proof',
  organic_cert: 'organic_cert',
  organic_evidence: 'organic_evidence',
  logo: 'logo',
  additional: 'additional',
};

/** Map application documents into the workspace shape used by the rest of the portal. */
export function toWorkspaceDocuments(app: ApplicationRecord, docs: DocumentRecord[], organic: OrganicRecord | null): SellerDocument[] {
  return docs
    .filter((x) => !x.supersededAt)
    .map((x) => {
      const isCert = x.kind === 'organic_cert';
      const verified = isCert ? organic?.documentId === x.id && organic.status === 'verified' : x.status === 'verified';
      const rejected = isCert ? organic?.documentId === x.id && organic.status === 'rejected' : x.status === 'rejected';
      return {
        id: x.id,
        sellerId: app.sellerId,
        type: DOC_TO_WORKSPACE[x.kind],
        fileName: x.fileName,
        mimeType: x.mimeType,
        sizeKb: Math.max(1, Math.round(x.sizeBytes / 1024)),
        uploadedAt: x.uploadedAt,
        status: verified ? 'approved' : rejected ? 'rejected' : 'pending',
        ...(x.reviewerNote ? { reviewerNote: x.reviewerNote } : {}),
        ...(isCert && app.data.certExpiryDate ? { expiresAt: app.data.certExpiryDate } : {}),
        ...(isCert && app.data.certBody ? { certBody: app.data.certBody } : {}),
        ...(isCert && app.data.certNumber ? { certNumber: app.data.certNumber } : {}),
      } satisfies SellerDocument;
    });
}

/** Build or refresh the workspace seller from the application (the source of truth). */
export function toWorkspaceSeller(existing: Seller | undefined, app: ApplicationRecord, account: { fullName: string; email: string; phone: string; emailVerified: boolean; phoneVerified: boolean }, bank: BankView | null, supportEmail: string): Seller {
  const d = app.data;
  const address = [d.addressLine1, d.addressLine2, d.city, d.district, d.state, d.pincode].filter(Boolean).join(', ');
  const base: Seller = existing ?? {
    id: app.sellerId,
    shopName: '',
    slug: '',
    ownerName: '',
    email: '',
    phone: '',
    emailVerified: false,
    phoneVerified: false,
    status: 'incomplete',
    description: '',
    address: '',
    pickupAddress: '',
    serviceAreas: [],
    productTypes: [],
    bank: { accountName: '', last4: '', ifsc: '', verified: false },
    brandColor: '#2f7d4a',
    bannerTagline: '',
    workingHours: (['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const).map((day) => ({ day, open: '08:00', close: '18:00', closed: day === 'Sun' })),
    holidays: [],
    fulfilment: { autoAccept: false, acceptWindowMins: 30, packingTimeMins: 45, minOrderValue: 0 },
    notifications: {
      new_order: { email: true, sms: false, push: true },
      order_update: { email: false, sms: false, push: true },
      moderation: { email: true, sms: false, push: true },
      settlement: { email: true, sms: false, push: false },
      low_stock: { email: true, sms: false, push: true },
      support: { email: true, sms: false, push: false },
    },
    staff: [],
    supportEmail,
    payoutRequestsEnabled: false,
    joinedAt: app.createdAt,
  };
  // Approved sellers manage shop name, description, pickup and service areas in
  // Store settings; until then the application drives them.
  const appDriven = app.status !== 'approved' && app.status !== 'suspended';
  const next: Seller = {
    ...base,
    shopName: appDriven || !base.shopName ? d.shopName || base.shopName : base.shopName,
    ownerName: d.ownerName || account.fullName,
    email: d.businessEmail || account.email,
    phone: maskPhone(d.primaryPhone || account.phone),
    emailVerified: account.emailVerified,
    phoneVerified: account.phoneVerified,
    status: app.status,
    address,
    productTypes: d.productTypes,
    ...(d.gstin ? { gstin: d.gstin } : {}),
    ...(d.pan ? { pan: d.pan } : {}),
    bank: bank ? { accountName: bank.holderName, last4: bank.last4, ifsc: bank.ifsc, verified: app.status === 'approved' || app.status === 'suspended' } : base.bank,
  };
  if (appDriven || !base.description) next.description = d.description || base.description;
  if (appDriven || !base.pickupAddress) next.pickupAddress = d.pickupSameAsBusiness ? address : `${d.pickupAddress}, ${d.pickupPincode}`;
  if (appDriven || !base.serviceAreas.length) next.serviceAreas = d.serviceAreas;
  next.slug = next.shopName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  if (app.reviewerMessage && app.status !== 'approved') next.reviewMessage = app.reviewerMessage;
  else delete next.reviewMessage;
  return next;
}
