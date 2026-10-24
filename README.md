# Mithren Agro — Seller Portal

The Seller/Vendor Portal described in [`docs/ORGANIC_MARKETPLACE_SELLER_PORTAL_SCOPE.md`](docs/ORGANIC_MARKETPLACE_SELLER_PORTAL_SCOPE.md): a TypeScript frontend plus a zero-dependency Node backend (built-in `node:sqlite`, `node:crypto`, `node:http`).

- **Server mode** (`npm start`): real accounts, sessions, SQLite persistence, private file storage, encrypted bank details, and server-enforced statuses and permissions.
- **Preview mode** (any static host, such as the hosted preview link): the same UI and rules run against an in-browser stand-in. Data stays in that browser, uploaded files aren't kept, and verification codes are shown on screen.

## Run it

Requires Node 22.13+ and TypeScript (`npm i -g typescript` if `tsc` is missing). There are no npm dependencies.

```bash
npm run build      # tsc → dist/
npm start          # http://127.0.0.1:8787  (data in ./.data)
```

Server configuration (environment variables, see `server/index.mjs`):

| Variable | Purpose |
|---|---|
| `DATA_ENCRYPTION_KEY` | Base64 32-byte key for bank-account encryption and code hashing. **Required in production.** Development generates `.data/dev-encryption.key`. |
| `DATA_DIR` | Database and private uploads (default `./.data`). Keep it out of any web root. |
| `COOKIE_SECURE` | `true` behind HTTPS (default on when `NODE_ENV=production`). |
| `ADMIN_API_TOKENS` | `token:Reviewer Name;…` for the Super Admin Portal. Each token must be at least 32 characters. |
| `CODE_DELIVERY` | `console` prints verification codes to the server log (development only; refused in production). |
| `DEMO_TOOLS` | `1` enables the checkout and delivery simulators (refused in production). |

Static preview without the server: `npm run serve:static`, then open `http://localhost:5173/#/seller`. The preview's demo seller is `ananya@greenvalley.example` with password `preview-demo-2026`.

## Seller registration, KYC and approval (scope §3.1–3.2)

1. **Account verification.** Sign up (seller role only), then verify email and mobile with 6-digit codes. Codes are hashed, expire after 10 minutes, allow 5 attempts, and have a 30-second resend cooldown and an hourly cap.
2. **Shop and owner details**, including an optional logo (PNG/JPG, 2 MB).
3. **Address and service area.** India only; state is chosen from a list; PIN codes are validated.
4. **Product categories and pickup location.**
5. **Business and KYC.** Conditional rules in `src/application.ts` (`kycRules`):
   - PAN is required unless the seller is an individual farmer who isn't GST-registered.
   - GSTIN is required only when the seller is GST-registered, and must match the PAN.
   - A registration number and certificate are required for partnerships, LLPs, companies, FPOs and cooperatives.
   - An address proof is always required.
6. **Bank and payout.** Sent only in the authenticated request body, encrypted at rest (AES-256-GCM, bound to the application row) and returned masked (last 4 digits). A cancelled cheque or statement is required.
7. **Organic certification.** Optional. If claimed: issuing body, certificate number, dates and certificate upload, plus optional evidence. The status is *Not submitted → Submitted for review → Verified / Rejected*, and *Expired* is derived from the expiry date. Uploading never verifies anything.
8. **Review and submit.** A declaration is required. Submission generates a reference ID (`MA-YYYY-NNNNNN`), records timestamps, and uses an idempotency key so duplicate submissions are impossible.

Progress is saved server-side on every step ("Save draft" and "Next"), so sellers can sign out and resume.

**Statuses** are `incomplete`, `pending`, `changes_requested`, `approved`, `rejected` and `suspended`. They form the single seller status model across the portal, and only the server changes them:

- seller submit: `incomplete` → `pending`, and `changes_requested` → `pending`;
- Super Admin: `pending` → `approved` / `rejected` / `changes_requested`, `approved` → `suspended`, and `suspended` → (reinstate) the status held before suspension.

The `/seller` status page shows only what the backend returns: reference ID, dates, status, reviewer message, requested corrections, missing documents and the next action.

**Permissions** are enforced on the server for every request:
- Unapproved sellers can save drafts but can't publish listings, act on orders or request payouts.
- Suspended sellers are read-only.
- Sellers can never change their own status.
- Internal functions are not reachable: `/api/rpc` exposes only the allowlist in `src/rpc.ts`.

## Super Admin Portal integration

The review screens belong to the Super Admin Portal. This backend exposes the API it calls (Bearer token from `ADMIN_API_TOKENS`; the reviewer identity comes from the token, never from the request):

| Method and path | Purpose |
|---|---|
| `GET /api/admin/applications?status=pending` | Review queue |
| `GET /api/admin/applications/:id` | Full application, documents (masked bank details) and audit trail |
| `GET /api/admin/applications/:id/bank` | Full account number for payout processing (audited) |
| `POST /api/admin/applications/:id/decision` | `{ action: approve \| reject \| request_changes \| suspend \| reinstate, message, requestedItems[] }`. A message is required for reject, request changes and suspend. |
| `POST /api/admin/documents/:id/review` | `{ decision: verified \| rejected, note }`. Verifying an `organic_cert` verifies the organic certification. |
| `GET /api/admin/documents/:id/file` | View an uploaded file (audited) |

## Tests

```bash
npm test                                      # 36 tests: business rules + backend integration (Node test runner)
node tests/e2e-server.cjs                     # 17-step browser test against the real server
npm run serve:static & node tests/e2e.cjs     # 17-step browser test of the preview
```

`tests/server.test.mjs` covers the acceptance criteria end to end over HTTP:
- registration and verification, duplicate accounts, and sign-out/sign-in persistence;
- conditional tax validation and upload content sniffing;
- reference IDs and idempotent submission;
- pending sellers blocked from publishing, and sellers unable to change their own status;
- changes requested and resubmission, suspension and reinstatement;
- organic certificates staying unverified until reviewed;
- bank numbers absent from responses, logs and the database file;
- cross-seller isolation, CSRF protection, rate limits, and no static file leaks.

## Architecture

```
src/
  application.ts          application model, shared validation rules, review state machine
  application-service.ts  registration/application workflow over a storage interface
  api-core.ts             business rules (catalogue, orders, earnings…) — runs on the server
  api.ts                  what pages call: HTTPS to the server, or the in-browser stand-in
  local-backend.ts        in-browser stand-in for the static preview
  rpc.ts                  allowlist of business functions callable from the browser
  pages/, ui/, main.ts    frontend (hash router, escaped templates, no framework)
server/
  index.mjs               configuration and startup
  app.mjs                 routes, sessions, CSRF, uploads, admin API, static files, security headers
  store.mjs               SQLite storage, workspace persistence, field encryption
  db.mjs                  schema and migrations
  security.mjs            scrypt, AES-256-GCM, token hashing
```

## Constraints and limitations

- **No email/SMS provider is integrated.** Codes go to the server console in development. Production refuses to start until a provider is wired into `codeDelivery()` in `server/index.mjs`.
- **No password reset or contact-change flow yet.** Changing email, phone or bank details after approval goes through support.
- **The business workspace (products, orders, ledger) is stored as one JSON document** in SQLite and written in the same transaction as each change. That's fine at this scale; move it to relational tables before high volume.
- **Single process.** Rate limits and the workspace are in memory per process, so run one instance (or move both to shared storage) until then.
- **Payouts are not automated**; no payout provider is configured.
- **Legal and tax rules** (`kycRules`) are an operator-reviewable default. They are not legal advice and don't establish compliance.
- `node:sqlite` is marked experimental in Node 22; the scripts silence that warning.
