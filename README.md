# Mithren Agro — Seller Portal (frontend prototype)

A working frontend for the Seller/Vendor Portal described in [`docs/ORGANIC_MARKETPLACE_SELLER_PORTAL_SCOPE.md`](docs/ORGANIC_MARKETPLACE_SELLER_PORTAL_SCOPE.md). It covers all 12 `/seller` routes, uses **clearly labelled fictional demo data**, and runs on a mock API that behaves like the production backend should.

> **Phase note:** This is the frontend-only phase. Production requires a real backend, database, auth and integrations (scope doc §15). That scope hasn't changed.

## Run it

Requires Node 18+ and TypeScript (`npm i -g typescript` if `tsc` is missing). There are no runtime dependencies.

```bash
npm run build                    # tsc → dist/
npx http-server . -p 5173 -c-1   # or any static server
# open http://localhost:5173/#/seller
```

Routes use hash URLs (`#/seller/orders`), so the prototype works on any static host without server rewrites. Swap to history routing when a real server exists.

## Tests

```bash
npm test                                    # 16 business-rule tests (Node test runner)
node tests/e2e.cjs http://localhost:5173/   # 16 end-to-end workflow steps (needs Playwright + Chromium)
```

The unit tests cover scope §13: seller A can't read or edit seller B's data, unapproved sellers can't publish or fulfil, ledger and settlement totals reconcile, refunds and rejections restore stock with audit entries, CSV validation works, uploads are validated and non-editable fields are ignored.

## What's included

| Route | Highlights |
|---|---|
| `/seller` | Entry point. Approved sellers are redirected to the dashboard; others see application status, progress and reviewer messages |
| `/seller/register` | 5-step application: email/phone OTP (demo code `123456`), shop and service area, PAN/GSTIN (cross-checked), bank details (masked), KYC and organic-certificate uploads with type/size checks, consent |
| `/seller/dashboard` | 8 metrics with definitions (ⓘ), 7/30/90-day range, comparison with the previous period, SVG sales/orders chart, alerts that need action, recent orders |
| `/seller/products` (+ `/new`, `/:id`) | Status tabs (draft, pending, approved, rejected, inactive, archived), search, availability toggle, archive, CSV export. The form covers variants and pack sizes, grams/kg/bunch/piece/box, MRP, min/max quantity, seasonality, harvest/packed dates, storage, and organic claims tied to a verified, unexpired certificate. Changes to moderated fields trigger re-approval |
| `/seller/orders` (+ `/:id`) | Own sub-orders only. Accept/reject → packed → ready for pickup; in transit and delivered come from the delivery partner. Reasons are required for reject/cancel; items can be marked unavailable; timestamped history; the address is shown only while the order is being fulfilled; payment status is read-only |
| `/seller/inventory` | Audited adjustments (reason, note, actor), low/out-of-stock filters, CSV import with a line-by-line error report |
| `/seller/earnings` | Gross → discounts → commission → delivery adjustments → refunds → holds → net, with a reconciliation check, read-only commission rates and the ledger |
| `/seller/settlements` | Pending, eligible, processing, paid, failed and reversed. A settlement shows as paid only when a transaction reference exists. Payout requests (when enabled) are capped by a server-computed balance |
| `/seller/reviews` | Rating distribution, performance, replies, reporting a review to moderation |
| `/seller/store-settings` | Profile/banner preview, pickup and service areas, hours and holidays, fulfilment, notification matrix, staff invites |
| `/seller/documents` | KYC and certificate status, expiry warnings, private-storage notice |

**Prototype controls** (flask icon in the top bar) stand in for systems outside the Seller Portal:

- Change the account status (Admin review), which includes switching to "new applicant" to try registration.
- Simulate a customer order.
- Simulate network failures.
- Run the seller-isolation check.
- Reset the demo data.

## Architecture

```
src/
  types.ts        domain model (seller, product, sub-order, ledger, settlement, …)
  api.ts          mock API: async, seller-scoped, whitelisted writes, 404 for others' records
  data/seed.ts    deterministic demo data + platform-side ledger calculation
  lib.ts          pure helpers: formatting, validation regexes, CSV, order-flow rules
  router.ts       hash router
  main.ts         shell: nav, notifications, onboarding gate, prototype controls
  ui/             escaped html templating, components, modal/toast/tooltip, SVG charts
  pages/          one module per route (lazy-loaded)
```

When the backend exists, `api.ts` is the only file that needs replacing. Every page already handles loading, error, empty, 403/404/409/422 and field-level validation responses.

## Constraints and limitations

- **No npm packages.** The build environment couldn't reach the npm registry, so the prototype is dependency-free TypeScript compiled with `tsc`. Moving to React/Vite later is straightforward because the API layer and domain logic are framework-independent.
- **Demo state lives in `localStorage`**, for demo continuity only. It isn't a database and bank or identity numbers are never stored there. Reset it from Prototype controls.
- **Not implemented, or simulated only:**
  - real authentication and sessions;
  - server-side enforcement (mirrored in the mock, but the client isn't a security boundary);
  - file storage (only uploaded file metadata is kept);
  - image uploads (emoji placeholders);
  - email/SMS delivery (in-app notifications only; providers must be configured);
  - payout provider integration;
  - staff permission enforcement;
  - support tickets.
- **Legal and tax fields** (GSTIN, PAN, FSSAI) are format-checked only. The operator must confirm what applies; nothing here claims compliance.
- **Search indexing:** private routes are marked `noindex` (meta tag and `robots.txt`).
