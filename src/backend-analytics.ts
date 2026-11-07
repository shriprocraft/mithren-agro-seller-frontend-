// Seller dashboard analytics from the FastAPI backend, mapped onto the dashboard's metrics. Kept free of
// browser APIs so it can be unit-tested.

import type { DashboardMetrics } from './api-core.js';

export interface BackendDashboard {
  range: { start: string; end: string; days: number };
  revenue_paise: number;
  revenue_prev_paise: number;
  commission_paise: number;
  net_earnings_paise: number;
  net_earnings_prev_paise: number;
  orders: { total: number; pending: number; processing: number; completed: number; cancelled: number };
  orders_prev_total: number;
  average_order_value_paise: number;
  cancellation_rate: number;
  trends: { daily: { period_start: string; revenue_paise: number; orders: number }[] };
  products: { live: number; total: number };
  low_stock_threshold: number;
  low_stock: { product_id: string; title: string; variant_label: string | null; stock: number }[];
}

const rupees = (paise: number) => paise / 100;

/**
 * The backend figures in the dashboard's shape. Reviews, returns, certificates and moderation are
 * not on the backend yet, so those read as none.
 */
export function toDashboardMetrics(d: BackendDashboard): DashboardMetrics {
  return {
    range: { from: new Date(`${d.range.start}T00:00:00+05:30`).toISOString(), to: new Date(`${d.range.end}T23:59:59+05:30`).toISOString(), days: d.range.days },
    sales: rupees(d.revenue_paise),
    salesPrev: rupees(d.revenue_prev_paise),
    orders: d.orders.total,
    ordersPrev: d.orders_prev_total,
    liveProducts: d.products.live,
    totalProducts: d.products.total,
    lowStock: d.low_stock.map((l) => ({ productId: l.product_id, name: l.title, variant: l.variant_label ?? '', stock: l.stock, threshold: d.low_stock_threshold })),
    cancellations: d.orders.cancelled,
    cancellationRate: d.cancellation_rate,
    returns: 0,
    rating: null,
    ratingCount: 0,
    netEarnings: rupees(d.net_earnings_paise),
    netEarningsPrev: rupees(d.net_earnings_prev_paise),
    averageOrderValue: rupees(d.average_order_value_paise),
    series: d.trends.daily.map((p) => ({ date: new Date(`${p.period_start}T00:00:00+05:30`).toISOString(), sales: rupees(p.revenue_paise), orders: p.orders })),
    awaiting: d.orders.pending,
    certExpiringDays: null,
    pendingProducts: 0,
    rejectedProducts: 0,
  };
}
