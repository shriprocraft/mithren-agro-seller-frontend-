// SQLite database (Node's built-in node:sqlite) with forward-only migrations.

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const STATUSES = "'incomplete','pending','changes_requested','approved','rejected','suspended'";
const DOC_KINDS = "'pan','gst','business_registration','address_proof','bank_proof','organic_cert','organic_evidence','logo','additional'";

const MIGRATIONS = [
  {
    version: 1,
    sql: `
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        seller_id TEXT NOT NULL UNIQUE,
        full_name TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE COLLATE NOCASE,
        phone TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        email_verified_at TEXT,
        phone_verified_at TEXT,
        failed_logins INTEGER NOT NULL DEFAULT 0,
        locked_until TEXT,
        created_at TEXT NOT NULL
      );
      CREATE TABLE sessions (
        token_hash TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
      );
      CREATE INDEX sessions_user ON sessions(user_id);
      CREATE TABLE verification_codes (
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        channel TEXT NOT NULL CHECK (channel IN ('email','phone')),
        code_hash TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        sent_at TEXT NOT NULL,
        window_started_at TEXT NOT NULL,
        sends_in_window INTEGER NOT NULL DEFAULT 1,
        PRIMARY KEY (user_id, channel)
      );
      CREATE TABLE seller_applications (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL UNIQUE REFERENCES users(id),
        seller_id TEXT NOT NULL UNIQUE,
        reference_id TEXT UNIQUE,
        status TEXT NOT NULL CHECK (status IN (${STATUSES})),
        previous_status TEXT CHECK (previous_status IS NULL OR previous_status IN (${STATUSES})),
        current_step INTEGER NOT NULL DEFAULT 1 CHECK (current_step BETWEEN 1 AND 8),
        data_json TEXT NOT NULL CHECK (json_valid(data_json)),
        submit_key TEXT,
        reviewer_message TEXT,
        requested_items_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(requested_items_json)),
        reviewed_at TEXT,
        created_at TEXT NOT NULL,
        submitted_at TEXT,
        last_submitted_at TEXT,
        updated_at TEXT NOT NULL,
        CHECK (status = 'incomplete' OR reference_id IS NOT NULL)
      );
      CREATE INDEX applications_status ON seller_applications(status);
      CREATE TABLE bank_accounts (
        application_id TEXT PRIMARY KEY REFERENCES seller_applications(id) ON DELETE CASCADE,
        holder_name TEXT NOT NULL,
        account_number_enc TEXT NOT NULL,
        account_last4 TEXT NOT NULL CHECK (length(account_last4) = 4),
        ifsc TEXT NOT NULL,
        bank_name TEXT NOT NULL DEFAULT '',
        key_version TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE application_documents (
        id TEXT PRIMARY KEY,
        application_id TEXT NOT NULL REFERENCES seller_applications(id),
        kind TEXT NOT NULL CHECK (kind IN (${DOC_KINDS})),
        file_name TEXT NOT NULL,
        mime_type TEXT NOT NULL CHECK (mime_type IN ('application/pdf','image/jpeg','image/png')),
        size_bytes INTEGER NOT NULL CHECK (size_bytes > 0),
        sha256 TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'unverified' CHECK (status IN ('unverified','verified','rejected')),
        reviewer_note TEXT,
        uploaded_at TEXT NOT NULL,
        superseded_at TEXT
      );
      CREATE INDEX documents_application ON application_documents(application_id);
      CREATE TABLE organic_certifications (
        application_id TEXT PRIMARY KEY REFERENCES seller_applications(id) ON DELETE CASCADE,
        status TEXT NOT NULL CHECK (status IN ('not_submitted','submitted','verified','rejected')),
        document_id TEXT REFERENCES application_documents(id),
        reviewer_note TEXT,
        reviewed_at TEXT,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        at TEXT NOT NULL,
        actor_type TEXT NOT NULL CHECK (actor_type IN ('seller','admin','system')),
        actor_id TEXT NOT NULL,
        action TEXT NOT NULL,
        application_id TEXT,
        details_json TEXT
      );
      CREATE INDEX audit_application ON audit_log(application_id);
      CREATE TABLE counters (name TEXT PRIMARY KEY, value INTEGER NOT NULL);
      CREATE TABLE workspace (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        data_json TEXT NOT NULL CHECK (json_valid(data_json)),
        updated_at TEXT NOT NULL
      );
    `,
  },
];

export function openDatabase(dataDir) {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(join(dataDir, 'seller-portal.sqlite'));
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)');
  const applied = new Set(db.prepare('SELECT version FROM schema_migrations').all().map((r) => r.version));
  for (const m of MIGRATIONS) {
    if (applied.has(m.version)) continue;
    db.exec('BEGIN');
    try {
      db.exec(m.sql);
      db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(m.version, new Date().toISOString());
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }
  return db;
}
