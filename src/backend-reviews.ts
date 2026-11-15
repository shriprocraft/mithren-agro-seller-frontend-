// Product reviews from the FastAPI backend (GET /seller/reviews), mapped onto the portal's Review.
// Kept free of browser APIs so it can be unit-tested.

import type { Review } from './types.js';

export interface BackendReview {
  id: string;
  product_id: string;
  product_title: string;
  product_image: string | null;
  order_number: string | null;
  rating: number;
  title: string | null;
  body: string | null;
  customer_name: string;
  created_at: string;
  reply: { body: string; at: string } | null;
  reported: boolean;
}

export interface BackendReviewPage {
  items: BackendReview[];
  total: number;
  limit: number;
  offset: number;
}

export function toReview(r: BackendReview, sellerId: string): Review {
  return {
    id: r.id,
    sellerId,
    // The backend product id; the page shows productName, since portal ids differ.
    productId: r.product_id,
    productName: r.product_title,
    // The customer application's order number (MA-…), not a seller order the portal can open.
    subOrderId: r.order_number ?? '',
    orderInPortal: false,
    rating: r.rating,
    title: r.title ?? '',
    body: r.body ?? '',
    customerFirstName: r.customer_name,
    date: r.created_at,
    ...(r.reply ? { reply: { body: r.reply.body, at: r.reply.at } } : {}),
    ...(r.reported ? { reported: true } : {}),
  };
}
