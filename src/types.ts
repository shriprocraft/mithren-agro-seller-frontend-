// Domain types for the Seller Portal. These mirror the entities a production
// backend would expose; in this phase they are served by the mock API in api.ts.

export type SellerStatus =
  | 'not_registered'
  | 'submitted'
  | 'under_review'
  | 'changes_requested'
  | 'approved'
  | 'rejected'
  | 'suspended';

export type Unit = 'g' | 'kg' | 'bunch' | 'piece' | 'box';

export interface WorkingHours {
  day: 'Mon' | 'Tue' | 'Wed' | 'Thu' | 'Fri' | 'Sat' | 'Sun';
  open: string;
  close: string;
  closed: boolean;
}

export type NotificationChannel = 'email' | 'sms' | 'push';
export type NotificationTopic =
  | 'new_order'
  | 'order_update'
  | 'moderation'
  | 'settlement'
  | 'low_stock'
  | 'support';

export interface StaffMember {
  id: string;
  name: string;
  email: string;
  role: 'manager' | 'packer';
  invitedAt: string;
  active: boolean;
}

export interface Seller {
  id: string;
  shopName: string;
  slug: string;
  ownerName: string;
  email: string;
  phone: string;
  emailVerified: boolean;
  phoneVerified: boolean;
  status: SellerStatus;
  reviewMessage?: string;
  description: string;
  address: string;
  pickupAddress: string;
  serviceAreas: string[];
  productTypes: string[];
  gstin?: string;
  pan?: string;
  /** Only masked bank details ever reach the frontend. */
  bank: { accountName: string; last4: string; ifsc: string; verified: boolean };
  brandColor: string;
  bannerTagline: string;
  workingHours: WorkingHours[];
  holidays: { id: string; date: string; note: string }[];
  fulfilment: {
    autoAccept: boolean;
    acceptWindowMins: number;
    packingTimeMins: number;
    minOrderValue: number;
  };
  notifications: Record<NotificationTopic, Record<NotificationChannel, boolean>>;
  staff: StaffMember[];
  supportEmail: string;
  // Platform-controlled (read-only for the seller)
  payoutRequestsEnabled: boolean;
  joinedAt: string;
}

export type ProductStatus = 'draft' | 'pending' | 'approved' | 'rejected' | 'inactive';
export type OrganicClaim = 'none' | 'certified' | 'in_conversion';
export type Seasonality = 'year_round' | 'seasonal';

export interface Variant {
  id: string;
  label: string;
  sku: string;
  packSize: number;
  unit: Unit;
  price: number;
  mrp?: number;
  stock: number;
}

export interface Product {
  id: string;
  sellerId: string;
  name: string;
  slug: string;
  description: string;
  category: string;
  emoji: string;
  variants: Variant[];
  origin: string;
  seasonality: Seasonality;
  seasonMonths: number[];
  harvestDate?: string;
  packedDate?: string;
  storage: string;
  organicClaim: OrganicClaim;
  certificateId?: string;
  status: ProductStatus;
  moderationNote?: string;
  available: boolean;
  minQty: number;
  maxQty: number;
  lowStockThreshold: number;
  archived: boolean;
  updatedAt: string;
}

export type AdjustmentReason =
  | 'restock'
  | 'damage'
  | 'correction'
  | 'order'
  | 'order_cancelled'
  | 'return'
  | 'csv_import';

export interface InventoryAdjustment {
  id: string;
  sellerId: string;
  productId: string;
  variantId: string;
  delta: number;
  resultingStock: number;
  reason: AdjustmentReason;
  note: string;
  actor: string;
  at: string;
}

export type OrderStatus =
  | 'awaiting_confirmation'
  | 'accepted'
  | 'packed'
  | 'ready_for_pickup'
  | 'in_transit'
  | 'delivered'
  | 'rejected'
  | 'cancelled'
  | 'return_requested'
  | 'returned';

export type PaymentStatus = 'paid' | 'cod_pending' | 'refunded' | 'partially_refunded' | 'refund_pending';

export interface OrderItem {
  productId: string;
  variantId: string;
  name: string;
  variantLabel: string;
  sku: string;
  qty: number;
  unitPrice: number;
  unavailable?: boolean;
}

export interface StatusEvent {
  status: OrderStatus;
  at: string;
  actor: string;
  note?: string;
}

export interface SubOrder {
  id: string;
  parentOrderId: string;
  sellerId: string;
  placedAt: string;
  deliverySlot: string;
  /** Minimum fulfilment info only. Full address is revealed after acceptance. */
  customer: { firstName: string; area: string; phoneMasked: string; address: string; instructions?: string };
  items: OrderItem[];
  discountAllocation: number;
  deliveryAdjustment: number;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  paymentMethod: 'online' | 'cod';
  history: StatusEvent[];
  reason?: string;
  /** Count only. Other sellers' details are never exposed. */
  otherSellerCount: number;
}

export type SettlementState = 'pending' | 'eligible' | 'processing' | 'paid' | 'failed' | 'reversed';

export interface LedgerEntry {
  id: string;
  sellerId: string;
  subOrderId: string;
  date: string;
  gross: number;
  discount: number;
  commissionRate: number;
  commission: number;
  deliveryAdjustment: number;
  refund: number;
  hold: number;
  net: number;
  state: SettlementState;
  settlementId?: string;
}

export interface Settlement {
  id: string;
  sellerId: string;
  periodStart: string;
  periodEnd: string;
  amount: number;
  entryIds: string[];
  state: SettlementState;
  method: 'manual' | 'automated';
  /** Required before a settlement can be shown as paid. */
  reference?: string;
  initiatedAt: string;
  paidAt?: string;
  failureReason?: string;
}

export interface PayoutRequest {
  id: string;
  sellerId: string;
  amount: number;
  requestedAt: string;
  state: 'requested' | 'approved' | 'rejected' | 'paid';
  note?: string;
}

export interface Review {
  id: string;
  sellerId: string;
  productId: string;
  subOrderId: string;
  rating: number;
  title: string;
  body: string;
  customerFirstName: string;
  date: string;
  reply?: { body: string; at: string };
  reported?: boolean;
}

export type DocumentType =
  | 'pan'
  | 'gst'
  | 'bank_proof'
  | 'address_proof'
  | 'fssai'
  | 'organic_cert';

export interface SellerDocument {
  id: string;
  sellerId: string;
  type: DocumentType;
  fileName: string;
  mimeType: string;
  sizeKb: number;
  uploadedAt: string;
  status: 'pending' | 'approved' | 'rejected';
  reviewerNote?: string;
  expiresAt?: string;
  certBody?: string;
  certNumber?: string;
  certScope?: string;
}

export interface AppNotification {
  id: string;
  sellerId: string;
  topic: NotificationTopic;
  title: string;
  body: string;
  at: string;
  read: boolean;
  link?: string;
}

export interface CommissionRule {
  category: string;
  ratePct: number;
}
