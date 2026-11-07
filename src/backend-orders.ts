// Seller orders from the FastAPI backend, mapped onto the portal's SubOrder shape. Kept free of
// browser APIs so it can be unit-tested.

import type { OrderStatus, SubOrder } from './types.js';

export type BackendOrderStatus = 'pending' | 'confirmed' | 'packed' | 'shipped' | 'delivered' | 'cancelled';
export interface BackendOrder {
  id: string;
  order_number: string;
  customer_order_ref: string | null;
  other_seller_count: number;
  status: BackendOrderStatus;
  placed_at: string;
  confirmed_at: string | null;
  cancel_reason: string | null;
  payment_method: 'online' | 'cod';
  payment_status: 'paid' | 'cod_pending' | 'refund_pending' | 'refunded';
  delivery_slot: string | null;
  customer: { name: string; phone: string; address: string; city: string; state: string; pincode: string; instructions: string | null };
  items: { product_id: string | null; variant_id: string | null; title: string; variant_label: string | null; sku: string | null; quantity: number; unit_price_paise: number }[];
  discount_paise: number;
  delivery_fee_paise: number;
  events: { status: BackendOrderStatus; actor: string; note: string | null; at: string }[];
}

/** Backend status as the portal's: shipped is "ready for pickup", and a cancel before confirming is a rejection. */
export function portalStatus(status: BackendOrderStatus, confirmed: boolean): OrderStatus {
  switch (status) {
    case 'pending':
      return 'awaiting_confirmation';
    case 'confirmed':
      return 'accepted';
    case 'shipped':
      return 'ready_for_pickup';
    case 'cancelled':
      return confirmed ? 'cancelled' : 'rejected';
    default:
      return status;
  }
}
export const BACKEND_STATUS: Partial<Record<OrderStatus, BackendOrderStatus>> = {
  accepted: 'confirmed',
  packed: 'packed',
  ready_for_pickup: 'shipped',
  rejected: 'cancelled',
  cancelled: 'cancelled',
};

export function toSubOrder(o: BackendOrder, sellerId = ''): SubOrder {
  const confirmed = o.confirmed_at !== null;
  return {
    id: o.order_number,
    backendId: o.id,
    parentOrderId: o.customer_order_ref ?? o.order_number,
    sellerId,
    placedAt: o.placed_at,
    deliverySlot: o.delivery_slot ?? '—',
    customer: {
      firstName: o.customer.name.split(/\s+/)[0] ?? o.customer.name,
      area: `${o.customer.city} ${o.customer.pincode}`,
      phoneMasked: o.customer.phone,
      address: o.status === 'confirmed' || o.status === 'packed' || o.status === 'shipped' ? `${o.customer.address}, ${o.customer.city}, ${o.customer.state} ${o.customer.pincode}` : o.customer.address,
      ...(o.customer.instructions ? { instructions: o.customer.instructions } : {}),
    },
    items: o.items.map((i) => ({
      productId: i.product_id ?? '',
      variantId: i.variant_id ?? '',
      name: i.title,
      variantLabel: i.variant_label ?? '—',
      sku: i.sku ?? '—',
      qty: i.quantity,
      unitPrice: i.unit_price_paise / 100,
    })),
    discountAllocation: o.discount_paise / 100,
    deliveryAdjustment: o.delivery_fee_paise / 100,
    status: portalStatus(o.status, confirmed),
    paymentStatus: o.payment_status,
    paymentMethod: o.payment_method,
    history: o.events.map((e) => ({ status: portalStatus(e.status, confirmed), at: e.at, actor: e.actor, ...(e.note ? { note: e.note } : {}) })),
    ...(o.cancel_reason ? { reason: o.cancel_reason } : {}),
    otherSellerCount: o.other_seller_count,
  };
}
