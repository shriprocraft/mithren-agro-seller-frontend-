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
  /** Set by the delivery partner: assigned (accepted the pickup), picked_up, out_for_delivery, delivered; cancelled if the order was. */
  delivery_status?: 'assigned' | 'picked_up' | 'out_for_delivery' | 'delivered' | 'cancelled' | null;
  delivery_partner?: { name: string; phone: string; assigned_at: string } | null;
  /** While an approved order waits for a partner. */
  delivery_note?: string | null;
  customer: { name: string; phone: string; address: string; city: string; state: string; pincode: string; instructions: string | null };
  items: { product_id: string | null; variant_id: string | null; title: string; variant_label: string | null; sku: string | null; quantity: number; unit_price_paise: number }[];
  discount_paise: number;
  delivery_fee_paise: number;
  events: { status: BackendOrderStatus; actor: string; note: string | null; at: string }[];
}

/**
 * Backend status as the portal's. "shipped" means a delivery partner has collected it: picked up, or in
 * transit once they set out for the customer. A cancel before confirming is a rejection.
 */
export function portalStatus(status: BackendOrderStatus, confirmed: boolean, deliveryStatus?: string | null): OrderStatus {
  switch (status) {
    case 'pending':
      return 'awaiting_confirmation';
    case 'confirmed':
      return 'accepted';
    case 'shipped':
      return deliveryStatus === 'out_for_delivery' ? 'in_transit' : 'picked_up';
    case 'cancelled':
      return confirmed ? 'cancelled' : 'rejected';
    default:
      return status;
  }
}
export const BACKEND_STATUS: Partial<Record<OrderStatus, BackendOrderStatus>> = {
  accepted: 'confirmed',
  packed: 'packed',
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
    status: portalStatus(o.status, confirmed, o.delivery_status),
    ...(o.delivery_status || o.delivery_note
      ? {
          delivery: {
            status: o.delivery_status ?? null,
            ...(o.delivery_partner ? { partner: { name: o.delivery_partner.name, phone: o.delivery_partner.phone, assignedAt: o.delivery_partner.assigned_at } } : {}),
            ...(o.delivery_note ? { note: o.delivery_note } : {}),
          },
        }
      : {}),
    paymentStatus: o.payment_status,
    paymentMethod: o.payment_method,
    history: o.events.map((e) => ({
      // The partner's two "shipped" steps: collecting it, then setting out for the customer.
      status: e.status === 'shipped' ? (e.note?.startsWith('On the way') ? 'in_transit' : 'picked_up') : portalStatus(e.status, confirmed),
      at: e.at,
      actor: e.actor,
      ...(e.note ? { note: e.note } : {}),
    })),
    ...(o.cancel_reason ? { reason: o.cancel_reason } : {}),
    otherSellerCount: o.other_seller_count,
  };
}
