// Earnings, settlements and payout requests from the FastAPI backend (amounts in paise), in the
// portal's shapes (rupees).

import type { CommissionRule, LedgerEntry, PayoutRequest, Settlement } from './types.js';

export interface BackendEarning {
  id: string;
  seller_order_id: string;
  order_number: string;
  delivered_at: string;
  gross_paise: number;
  discount_paise: number;
  commission_rate_bp: number;
  commission_paise: number;
  delivery_adjustment_paise: number;
  refund_paise: number;
  hold_paise: number;
  net_paise: number;
  state: LedgerEntry['state'];
  settlement_id: string | null;
}
export interface BackendEarningsPage {
  items: BackendEarning[];
  hold_days: number;
}
export interface BackendCommissionRules {
  items: { category: string; rate_bp: number }[];
  default_rate_bp: number;
}
export interface BackendSettlement {
  id: string;
  number: string;
  period_start: string;
  period_end: string;
  amount_paise: number;
  state: Settlement['state'];
  method: Settlement['method'];
  reference: string | null;
  initiated_at: string;
  paid_at: string | null;
  failure_reason: string | null;
  order_numbers: string[];
}
export interface BackendPayoutRequest {
  id: string;
  number: string;
  amount_paise: number;
  state: PayoutRequest['state'];
  note: string | null;
  requested_at: string;
}
export interface BackendPayoutRequests {
  items: BackendPayoutRequest[];
  enabled: boolean;
  min_amount_paise: number;
}

const rupees = (paise: number) => paise / 100;

export function toLedgerEntry(e: BackendEarning, sellerId: string): LedgerEntry {
  return {
    id: e.id,
    sellerId,
    // The portal opens orders by their number (SO-000004).
    subOrderId: e.order_number,
    date: e.delivered_at,
    gross: rupees(e.gross_paise),
    discount: rupees(e.discount_paise),
    commissionRate: e.commission_rate_bp / 100,
    commission: rupees(e.commission_paise),
    deliveryAdjustment: rupees(e.delivery_adjustment_paise),
    refund: rupees(e.refund_paise),
    hold: rupees(e.hold_paise),
    net: rupees(e.net_paise),
    state: e.state,
    ...(e.settlement_id ? { settlementId: e.settlement_id } : {}),
  };
}

export function toCommissionRules(r: BackendCommissionRules): CommissionRule[] {
  return r.items.map((i) => ({ category: i.category, ratePct: i.rate_bp / 100 }));
}

export function toSettlement(s: BackendSettlement, sellerId: string): Settlement {
  return {
    id: s.number,
    sellerId,
    periodStart: s.period_start,
    periodEnd: s.period_end,
    amount: rupees(s.amount_paise),
    entryIds: s.order_numbers,
    state: s.state,
    method: s.method,
    initiatedAt: s.initiated_at,
    ...(s.reference ? { reference: s.reference } : {}),
    ...(s.paid_at ? { paidAt: s.paid_at } : {}),
    ...(s.failure_reason ? { failureReason: s.failure_reason } : {}),
  };
}

export function toPayoutRequest(r: BackendPayoutRequest, sellerId: string): PayoutRequest {
  return { id: r.number, sellerId, amount: rupees(r.amount_paise), requestedAt: r.requested_at, state: r.state, ...(r.note ? { note: r.note } : {}) };
}
