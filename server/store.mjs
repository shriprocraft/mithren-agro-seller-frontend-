// SQLite implementation of ApplicationStore, plus persistence of the business
// workspace that src/api-core.ts operates on.

import { _internal } from '../dist/api-core.js';
import { createEmptySeed } from '../dist/data/seed.js';
import { newId } from './security.mjs';

const json = (v) => JSON.stringify(v);
const parse = (s, fallback) => {
  try {
    return s == null ? fallback : JSON.parse(s);
  } catch {
    return fallback;
  }
};

function rowToApp(r) {
  return r
    ? {
        id: r.id,
        userId: r.user_id,
        sellerId: r.seller_id,
        referenceId: r.reference_id,
        status: r.status,
        currentStep: r.current_step,
        data: parse(r.data_json, {}),
        createdAt: r.created_at,
        submittedAt: r.submitted_at,
        lastSubmittedAt: r.last_submitted_at,
        updatedAt: r.updated_at,
        reviewerMessage: r.reviewer_message,
        requestedItems: parse(r.requested_items_json, []),
        reviewedAt: r.reviewed_at,
        previousStatus: r.previous_status,
      }
    : null;
}

function rowToDoc(r) {
  return r
    ? {
        id: r.id,
        applicationId: r.application_id,
        kind: r.kind,
        fileName: r.file_name,
        mimeType: r.mime_type,
        sizeBytes: r.size_bytes,
        uploadedAt: r.uploaded_at,
        status: r.status,
        ...(r.reviewer_note ? { reviewerNote: r.reviewer_note } : {}),
        supersededAt: r.superseded_at,
      }
    : null;
}

export function rowToAccount(u) {
  return u
    ? {
        userId: u.id,
        sellerId: u.seller_id,
        fullName: u.full_name,
        email: u.email,
        phone: u.phone,
        emailVerified: !!u.email_verified_at,
        phoneVerified: !!u.phone_verified_at,
      }
    : null;
}

export function createStore(db, cipher) {
  let depth = 0;

  // Load the business workspace into the shared rules module.
  const ws = db.prepare('SELECT data_json FROM workspace WHERE id = 1').get();
  if (ws) _internal.replaceDb(JSON.parse(ws.data_json));
  else {
    const empty = { ...createEmptySeed(), sellers: [], documents: [] };
    _internal.replaceDb(empty);
    db.prepare('INSERT INTO workspace (id, data_json, updated_at) VALUES (1, ?, ?)').run(json(empty), new Date().toISOString());
  }
  const saveWorkspace = db.prepare('UPDATE workspace SET data_json = ?, updated_at = ? WHERE id = 1');
  const q = (sql) => db.prepare(sql);

  const store = {
    db,
    /** Runs fn atomically across SQLite and the in-memory workspace. fn may be async if it never yields to I/O. */
    async transactionAsync(fn) {
      if (depth > 0) return fn();
      depth++;
      const snapshot = structuredClone(_internal.getDb());
      db.exec('BEGIN IMMEDIATE');
      try {
        const out = await fn();
        saveWorkspace.run(json(_internal.getDb()), new Date().toISOString());
        db.exec('COMMIT');
        return out;
      } catch (e) {
        db.exec('ROLLBACK');
        _internal.replaceDb(snapshot);
        throw e;
      } finally {
        depth--;
      }
    },
    transaction(fn) {
      if (depth > 0) return fn();
      depth++;
      const snapshot = structuredClone(_internal.getDb());
      db.exec('BEGIN IMMEDIATE');
      try {
        const out = fn();
        saveWorkspace.run(json(_internal.getDb()), new Date().toISOString());
        db.exec('COMMIT');
        return out;
      } catch (e) {
        db.exec('ROLLBACK');
        _internal.replaceDb(snapshot);
        throw e;
      } finally {
        depth--;
      }
    },
    getApplicationByUser: (userId) => rowToApp(q('SELECT * FROM seller_applications WHERE user_id = ?').get(userId)),
    getApplicationById: (id) => rowToApp(q('SELECT * FROM seller_applications WHERE id = ?').get(id)),
    insertApplication(a) {
      q(`INSERT INTO seller_applications (id, user_id, seller_id, reference_id, status, previous_status, current_step, data_json, reviewer_message,
          requested_items_json, reviewed_at, created_at, submitted_at, last_submitted_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        a.id, a.userId, a.sellerId, a.referenceId, a.status, a.previousStatus, a.currentStep, json(a.data), a.reviewerMessage,
        json(a.requestedItems), a.reviewedAt, a.createdAt, a.submittedAt, a.lastSubmittedAt, a.updatedAt,
      );
    },
    updateApplication(a) {
      // user_id and seller_id are never updated: ownership is fixed at creation.
      q(`UPDATE seller_applications SET reference_id = ?, status = ?, previous_status = ?, current_step = ?, data_json = ?, reviewer_message = ?,
          requested_items_json = ?, reviewed_at = ?, submitted_at = ?, last_submitted_at = ?, updated_at = ? WHERE id = ?`).run(
        a.referenceId, a.status, a.previousStatus, a.currentStep, json(a.data), a.reviewerMessage,
        json(a.requestedItems), a.reviewedAt, a.submittedAt, a.lastSubmittedAt, a.updatedAt, a.id,
      );
    },
    getSubmitKey: (appId) => q('SELECT submit_key FROM seller_applications WHERE id = ?').get(appId)?.submit_key ?? null,
    setSubmitKey: (appId, key) => q('UPDATE seller_applications SET submit_key = ? WHERE id = ?').run(key, appId),
    listDocuments: (appId) => q('SELECT * FROM application_documents WHERE application_id = ? ORDER BY uploaded_at').all(appId).map(rowToDoc),
    getDocument: (id) => rowToDoc(q('SELECT * FROM application_documents WHERE id = ?').get(id)),
    insertDocument(d) {
      q(`INSERT INTO application_documents (id, application_id, kind, file_name, mime_type, size_bytes, sha256, status, reviewer_note, uploaded_at, superseded_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(d.id, d.applicationId, d.kind, d.fileName, d.mimeType, d.sizeBytes, d.sha256 ?? store.pendingSha.get(d.id) ?? '', d.status, d.reviewerNote ?? null, d.uploadedAt, d.supersededAt);
      store.pendingSha.delete(d.id);
    },
    updateDocument(d) {
      q('UPDATE application_documents SET status = ?, reviewer_note = ?, superseded_at = ? WHERE id = ?').run(d.status, d.reviewerNote ?? null, d.supersededAt, d.id);
    },
    /** sha256 of uploaded bytes, recorded by the upload handler before insertDocument runs. */
    pendingSha: new Map(),
    getBank(appId) {
      const r = q('SELECT holder_name, account_last4, ifsc, bank_name, updated_at FROM bank_accounts WHERE application_id = ?').get(appId);
      return r ? { holderName: r.holder_name, last4: r.account_last4, ifsc: r.ifsc, bankName: r.bank_name, updatedAt: r.updated_at } : null;
    },
    saveBank(appId, view, fullAccountNumber) {
      const enc = cipher.encrypt(fullAccountNumber, `bank:${appId}`);
      q(`INSERT INTO bank_accounts (application_id, holder_name, account_number_enc, account_last4, ifsc, bank_name, key_version, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(application_id) DO UPDATE SET holder_name = excluded.holder_name, account_number_enc = excluded.account_number_enc,
           account_last4 = excluded.account_last4, ifsc = excluded.ifsc, bank_name = excluded.bank_name, key_version = excluded.key_version, updated_at = excluded.updated_at`).run(
        appId, view.holderName, enc, view.last4, view.ifsc, view.bankName, cipher.keyVersion, view.updatedAt,
      );
    },
    /** Admin-only: full account number for payout processing. */
    revealBankAccount(appId) {
      const r = q('SELECT account_number_enc FROM bank_accounts WHERE application_id = ?').get(appId);
      return r ? cipher.decrypt(r.account_number_enc, `bank:${appId}`) : null;
    },
    getOrganic(appId) {
      const r = q('SELECT * FROM organic_certifications WHERE application_id = ?').get(appId);
      return r ? { status: r.status, documentId: r.document_id, reviewerNote: r.reviewer_note, reviewedAt: r.reviewed_at } : null;
    },
    saveOrganic(appId, o) {
      q(`INSERT INTO organic_certifications (application_id, status, document_id, reviewer_note, reviewed_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(application_id) DO UPDATE SET status = excluded.status, document_id = excluded.document_id, reviewer_note = excluded.reviewer_note,
           reviewed_at = excluded.reviewed_at, updated_at = excluded.updated_at`).run(appId, o.status, o.documentId, o.reviewerNote, o.reviewedAt, new Date().toISOString());
    },
    nextReferenceId() {
      const year = new Date().getFullYear();
      const name = `application_ref_${year}`;
      q('INSERT INTO counters (name, value) VALUES (?, 1) ON CONFLICT(name) DO UPDATE SET value = value + 1').run(name);
      const { value } = q('SELECT value FROM counters WHERE name = ?').get(name);
      return `MA-${year}-${String(value).padStart(6, '0')}`;
    },
    getAccount: (userId) => rowToAccount(q('SELECT * FROM users WHERE id = ?').get(userId)),
    audit(e) {
      q('INSERT INTO audit_log (at, actor_type, actor_id, action, application_id, details_json) VALUES (?, ?, ?, ?, ?, ?)').run(
        new Date().toISOString(), e.actorType, e.actorId, e.action, e.applicationId ?? null, e.details ? json(e.details) : null,
      );
    },
    newId,
  };
  return store;
}
