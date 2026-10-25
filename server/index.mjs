// Start the Seller Portal server.  Usage: npm run build && npm start
//
// Environment:
//   PORT                 default 8787
//   HOST                 default 127.0.0.1
//   DATA_DIR             default ./.data (database + private uploads; keep out of web roots and backups you don't control)
//   DATA_ENCRYPTION_KEY  base64 32 bytes. Required when NODE_ENV=production.
//   COOKIE_SECURE        "true" behind HTTPS (default: true in production)
//   ADMIN_API_TOKENS     "token1:Reviewer Name;token2:Other Reviewer" (tokens ≥ 32 chars) for the Super Admin Portal
//   CODE_DELIVERY        "console" (development only) — no email/SMS provider is configured yet
//   DEMO_TOOLS           "1" to enable checkout/delivery simulators (never in production)

import { createServer } from 'node:http';
import { createApp } from './app.mjs';
import { loadAppConfig } from './config.mjs';

const env = process.env;
const app = createApp(loadAppConfig());

const port = Number(env.PORT ?? 8787);
const host = env.HOST ?? '127.0.0.1';
createServer((req, res) => void app.handle(req, res)).listen(port, host, () => {
  console.log(`Mithren Agro Seller Portal listening on http://${host}:${port}`);
});
