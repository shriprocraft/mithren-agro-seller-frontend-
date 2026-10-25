// The development seed creates one seller per application status, is safe to re-run,
// and refuses to run in production.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const run = (env) => execFileSync(process.execPath, ['--disable-warning=ExperimentalWarning', 'server/seed-dev.mjs'], { cwd: root, env: { ...process.env, ...env }, encoding: 'utf8' });

test('seed:dev creates fictional sellers in every status and is idempotent', () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'seed-test-'));
  const env = { DATA_DIR: dataDir, DATA_ENCRYPTION_KEY: randomBytes(32).toString('base64'), NODE_ENV: 'development' };
  try {
    run(env);
    const db = new DatabaseSync(join(dataDir, 'seller-portal.sqlite'));
    const statuses = db.prepare('SELECT u.email, a.status, a.reference_id FROM users u JOIN seller_applications a ON a.user_id = u.id ORDER BY u.email').all();
    assert.deepEqual(
      Object.fromEntries(statuses.map((s) => [s.email, s.status])),
      {
        'ananya@greenvalley.example': 'approved',
        'harpreet@punjabfields.example': 'suspended',
        'imran@deccanharvest.example': 'changes_requested',
        'kavita@raofarms.example': 'pending',
        'lakshmi@kaverigreens.example': 'incomplete',
      },
    );
    assert.ok(statuses.filter((s) => s.status !== 'incomplete').every((s) => /^MA-\d{4}-\d{6}$/.test(s.reference_id)));
    assert.ok(statuses.every((s) => s.email.endsWith('.example')), 'only reserved example domains');
    const ws = JSON.parse(db.prepare('SELECT data_json FROM workspace').get().data_json);
    const ananya = db.prepare("SELECT seller_id FROM users WHERE email = 'ananya@greenvalley.example'").get().seller_id;
    assert.ok(ws.products.filter((p) => p.sellerId === ananya).length >= 25);
    assert.ok(ws.orders.filter((o) => o.sellerId === ananya).length >= 200);
    assert.ok(ws.reviews.filter((r) => r.sellerId === ananya).length >= 30);
    const organic = db.prepare("SELECT o.status FROM organic_certifications o JOIN seller_applications a ON a.id = o.application_id JOIN users u ON u.id = a.user_id WHERE u.email = 'ananya@greenvalley.example'").get();
    assert.equal(organic.status, 'verified');
    const pending = db.prepare("SELECT o.status FROM organic_certifications o JOIN seller_applications a ON a.id = o.application_id JOIN users u ON u.id = a.user_id WHERE u.email = 'kavita@raofarms.example'").get();
    assert.equal(pending.status, 'submitted', 'unreviewed certificate stays unverified');
    const changes = db.prepare("SELECT reviewer_message, requested_items_json FROM seller_applications a JOIN users u ON u.id = a.user_id WHERE u.email = 'imran@deccanharvest.example'").get();
    assert.match(changes.reviewer_message, /address proof/);
    assert.equal(JSON.parse(changes.requested_items_json).length, 2);
    const userCount = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
    const productCount = ws.products.length;
    db.close();
    assert.ok(!readFileSync(join(dataDir, 'seller-portal.sqlite')).includes(Buffer.from('50100000004821')), 'bank numbers are encrypted');

    const second = run(env);
    assert.match(second, /skipped \(already exists\)/);
    const db2 = new DatabaseSync(join(dataDir, 'seller-portal.sqlite'));
    assert.equal(db2.prepare('SELECT COUNT(*) AS n FROM users').get().n, userCount);
    assert.equal(JSON.parse(db2.prepare('SELECT data_json FROM workspace').get().data_json).products.length, productCount, 're-running adds nothing');
    db2.close();
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('seed:dev refuses to run in production', () => {
  const r = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', 'server/seed-dev.mjs'], { cwd: root, env: { ...process.env, NODE_ENV: 'production', DATA_ENCRYPTION_KEY: randomBytes(32).toString('base64'), CODE_DELIVERY: 'console' }, encoding: 'utf8' });
  assert.notEqual(r.status, 0);
});
