// Points the built site at the FastAPI backend named by BACKEND_API_URL (set in Vercel, e.g. the
// current ngrok URL), by rewriting <meta name="otp-api"> in index.html. Without the variable the
// file is left as it is, so local builds keep using http://127.0.0.1:8000.
import { readFileSync, writeFileSync } from 'node:fs';

const raw = process.env.BACKEND_API_URL?.trim();
if (!raw) {
  console.log('[build] BACKEND_API_URL not set: index.html keeps its backend URL.');
  process.exit(0);
}
let url;
try {
  url = new URL(raw);
} catch {
  console.error(`[build] BACKEND_API_URL is not a valid URL: ${raw}`);
  process.exit(1);
}
if (url.protocol !== 'https:' && url.protocol !== 'http:') {
  console.error('[build] BACKEND_API_URL must start with https:// or http://');
  process.exit(1);
}
// Only scheme, host and port: the frontend adds /api/v1/... itself.
const origin = url.origin;
const file = new URL('../index.html', import.meta.url);
const html = readFileSync(file, 'utf8');
const pattern = /<meta name="otp-api" content="[^"]*" \/>/;
if (!pattern.test(html)) {
  console.error('[build] index.html has no <meta name="otp-api"> tag to update.');
  process.exit(1);
}
writeFileSync(file, html.replace(pattern, `<meta name="otp-api" content="${origin}" />`));
console.log(`[build] Backend API URL set to ${origin}`);
