# Seller / Vendor Portal — Scope Document

> **Project:** Organic Fruits & Vegetables Multi-Vendor Marketplace  
> **Source:** Extracted from `GLM_Organic_MultiVendor_Marketplace_Prompt.md`  
> **Scope boundary:** Seller/Vendor Portal only. Customer storefront, Super Admin operations, and Delivery Partner portal are outside this document except where they create a dependency for seller workflows.

## 1. Purpose

Provide a separate, polished Seller/Vendor Portal at `/seller` where approved sellers can manage their store profile, product listings, inventory, seller-specific orders, earnings, settlements, reviews, and relevant settings.

The source describes the overall marketplace as a real full-stack application with persistent data, server-side authorization, and real integrations when configured. This document preserves those source requirements; it does not redefine the production scope as a frontend-only demo.

## 2. Seller role and access boundaries

- Seller/Vendor is a distinct marketplace role.
- A seller may manage only their own store, products, stock, seller sub-orders, earnings, settlements, reviews, and settings.
- A seller must never see another seller's private orders, earnings, settings, or products through seller-only access.
- Seller access to customer information is limited to information required to fulfil an order.
- Sellers cannot change platform-wide commission rules or another seller's products.
- Sellers cannot mark an order paid or issue a refund directly unless the configured payment workflow explicitly authorizes it.
- Public registration must not create an Admin or Super Admin account.
- Protected actions require server-side authorization in the production implementation; hiding UI controls is not a security boundary.

## 3. Seller onboarding and approval

### 3.1 Registration and application
- Seller registration.
- Email and/or phone verification.
- Capture shop name, owner/contact details, address, service area, product types, pickup location, and business description.
- Collect required business/KYC documents and bank/payout information securely.
- Capture relevant business/tax fields such as GSTIN and PAN only where appropriate to the seller's business and legal requirements.
- Allow organic certification/evidence uploads if the seller claims products are certified organic.

### 3.2 Review status and restrictions
- Seller applications must support an Admin review workflow: approve, reject, request changes, suspend, and reinstate.
- Sellers must not list products for public sale until their seller account is approved.
- An uploaded certificate must not be represented as verified until an authorized reviewer approves it.
- Seller-facing application status and any review/requested-change message should be presented when the underlying workflow provides that information.

**Dependency:** The review queue and approval actions belong to the Super Admin Portal. They are referenced here only as dependencies; their administrative screens are not Seller Portal scope.

## 4. Seller dashboard overview

Show seller-relevant business metrics:
- Sales.
- Orders.
- Products.
- Low-stock items.
- Cancellations.
- Returns.
- Ratings.
- Net earnings.

Dashboard capabilities:
- Date-range filters.
- Clear definitions for displayed metrics.
- Recent orders.
- Actionable alerts.
- Responsive charts.

The production source requires these metrics to use real database data. A frontend-only implementation may use clearly identified mock data during its current phase.

## 5. Product management

Sellers need to:
- Create, edit, archive, and view their own products.
- Manage product name, slug, description, category, images, variants/pack sizes, SKU, unit, selling price, MRP if applicable, stock quantity, minimum/maximum order quantity, availability, origin, seasonal status, and relevant storage information.
- See product states: draft, pending approval, approved, rejected, and inactive.
- Support product moderation where required by the platform.
- Adjust inventory with an audit trail.
- Receive low-stock alerts and handle out-of-stock status.
- Use CSV import/export with validation and error reporting if feasible.
- Be prevented from editing platform-wide commission rules or other sellers' products.

### Organic produce details relevant to listings
- Support unit-based pricing for grams, kilograms, bunches, pieces, and boxes.
- Support variants such as 250 g, 500 g, 1 kg, and configurable bundles.
- Support seasonal availability and seller-specific stock.
- Capture origin, harvest/packed date, and storage details where provided and supported by validation.
- Organic labels and certificate metadata must reflect review/expiry status.
- Organic claims must remain truthful and traceable. Products must not automatically be labelled organic merely because the seller belongs to this marketplace.

## 6. Seller order management

- Show only the seller's own vendor sub-orders and the fulfilment information necessary to complete them.
- Support accepting/rejecting an order according to the configured workflow and policy.
- Source status flow: placed/awaiting confirmation → accepted → preparing/packed → ready for pickup → picked up/in transit → delivered.
- Support cancellation, unavailable-item handling, refunds, and disputes with audit history where authorized by the configured workflow.
- Sellers cannot mark orders paid or issue refunds directly unless explicitly authorized by the payment workflow.
- Meaningful order-status changes should notify customers through the platform's notification service.
- Maintain timestamped status history.

### Multi-vendor order dependency
A customer may buy from multiple sellers in one checkout. The platform uses one customer-facing parent order and one vendor sub-order per seller. Seller views must isolate each seller's sub-order and must not reveal another seller's private information. Parent-order tracking and cross-seller order architecture are platform-level concerns, not seller administration features.

## 7. Earnings, commissions, settlements, and payouts

### 7.1 Earnings breakdown
Show, where applicable:
- Gross sales.
- Discount allocation.
- Platform commission.
- Delivery adjustments.
- Refunds/returns.
- Holds.
- Net payable amount.

### 7.2 Commission calculation
- Commission can be configured globally and per seller/category by the platform.
- Seller-facing calculations must be transparent.
- Sellers cannot edit commission rules.
- Historical calculation records must remain consistent with the platform's financial records.

### 7.3 Settlement ledger and payout requests
- Settlement states: pending, eligible, processing, paid, failed, and reversed.
- Seller payout requests are available only if enabled.
- Admin review and payout processing are platform dependencies.
- Automated payouts may be integrated only after a compatible provider and credentials are configured.
- Otherwise, the source permits a documented manual settlement workflow with transaction reference and audit trail.
- Never display a payout as completed without a recorded successful settlement.

**Dependency:** Admin review, settlement processing, and provider configuration belong to the platform/Admin workflow. The Seller Portal displays the seller's permitted ledger/status and offers payout requests only when enabled.

## 8. Seller settings and profile

Seller settings include:
- Shop profile.
- Logo and banner.
- Pickup address.
- Service areas.
- Working hours.
- Holiday availability.
- Fulfilment settings.
- Notification preferences.
- Authorized staff accounts, if implemented.
- Seller reviews and performance metrics.
- Support/contact channel.

## 9. Seller routes/pages from the source

The source explicitly lists these Seller routes:
- `/seller/register`
- `/seller`
- `/seller/dashboard`
- `/seller/products`
- `/seller/products/new`
- `/seller/orders`
- `/seller/inventory`
- `/seller/earnings`
- `/seller/settlements`
- `/seller/reviews`
- `/seller/store-settings`
- `/seller/documents`

`/seller` is the seller portal entry point. The exact redirect/landing behavior should follow the authentication and onboarding state in the production app. Route aliases or redirects may be used as needed, but navigation links must lead to real pages.

## 10. Seller-facing notifications

The source identifies seller notifications for:
- New seller orders.
- Seller approval/rejection and listing moderation.
- Meaningful order status updates affecting the seller.
- Refund and settlement status.
- Support ticket replies, where the seller support workflow applies.

A notification service should store delivery status and errors. If a provider is not configured, documentation must clearly state that setup is required; the system must not pretend a message was sent.

## 11. Security, privacy, and reliability requirements

Production requirements relevant to the Seller Portal:
- Secure password hashing and secure session handling.
- Server-side role and resource authorization on every protected action.
- Enforce seller ownership for product, inventory, order, earnings, settlement, review, and setting records.
- Validate inputs on client and server.
- Secure file uploads with file-size, MIME-type, and access validation.
- Do not expose secrets, bank details, or unnecessary personal information in frontend code or logs.
- Use safe error messages that do not expose secrets or stack traces.
- Log sensitive actions and inventory/financial changes where required.
- Never trust client-provided prices, commissions, payout states, or ownership IDs.
- Use persistent database storage in production; browser storage must not be the primary database.
- Do not claim legal compliance automatically; required legal and business configuration must be reviewed by the operator.

## 12. Accessibility, responsiveness, and performance

- Seller dashboard and management pages must work on mobile, tablet, and desktop.
- Use semantic controls, keyboard-accessible navigation, visible focus states, accessible labels, and meaningful validation messages.
- Include loading, error, and empty states.
- Optimize images and large lists.
- Avoid exposing private seller routes to search indexing.
- Do not fabricate sales, ratings, stock, certification, or payout data.

## 13. Testing and acceptance criteria from the source

The source's platform-wide testing criteria that directly apply to Seller Portal include:
1. Seller A cannot read or edit Seller B's products, orders, or earnings.
2. A seller can add products, manage stock, and fulfil only their own orders.
3. Unapproved sellers and products are not publicly purchasable.
4. Admin can review seller documents and product listings (dependency test across Seller/Admin workflows).
5. Commission calculations and seller settlement totals reconcile.
6. Refund/cancellation workflows update order and ledger states correctly.
7. Mobile dashboards and seller workflows work on small screens.
8. Invalid forms show clear errors; network failures do not lose critical order state.
9. Main routes load without 404s, broken links, or console errors.
10. No secrets are exposed in the frontend bundle or repository.
11. Build, lint, type-check, migrations, and automated tests pass, or remaining blockers are reported clearly.

The full source also requires testing of inventory overselling, payment verification, duplicate webhooks, checkout, and delivery authorization. Those are cross-platform integration tests and are not solely Seller Portal UI tests.

## 14. Related platform dependencies (not Seller Portal scope)

The Seller Portal depends on these platform capabilities:
- Super Admin seller approval, document review, product moderation, commissions, settlements, settings, and audit logs.
- Customer storefront product visibility, order placement, customer notifications, and review eligibility.
- Payment workflow for payment state, refunds, commission ledger, and settlement.
- Delivery workflow for pickup/fulfilment status and delivery handoff.
- Shared authentication, roles/permissions, database, storage, and notification services.

These dependencies are listed to clarify boundaries. This document does not define the UI or operational scope of the Customer, Admin, or Delivery Partner portals.

## 15. Source-level implementation context

The master source expects a production-oriented full-stack application, not a static UI or mock-only demo. It calls for:
- A maintainable TypeScript-first frontend.
- Real database persistence and server-side authorization.
- Integration setup documentation for external services.
- Testing for business rules, critical APIs, and end-to-end workflows.
- Actual test results and an explicit list of unconfigured integrations and limitations.

If the development team is currently implementing only the frontend, use a separate phase-specific development guide to specify mock data and simulated interactions. That phase restriction should not be mistaken for a change to the original production scope.
