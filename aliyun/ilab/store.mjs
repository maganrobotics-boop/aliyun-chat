import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { chmodSync, closeSync, constants, existsSync, lstatSync, mkdirSync, openSync } from 'node:fs';
import { dirname, parse, resolve, sep } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const ATTEMPT_STATES = new Set(['collecting', 'ready', 'submitting', 'sent', 'rejected', 'uncertain']);
const REPORT_STATES = new Set(['none', 'pending', 'submitting', 'sent', 'rejected', 'uncertain']);
const NONCE_TTL_MS = 10 * 60 * 1000;
const PATCH_COLUMNS = Object.freeze({
  tokens: 'token_box', state: 'state', steps: 'steps_json', aiCalls: 'ai_calls_json',
  result: 'result_json', resultHash: 'result_hash', receipt: 'receipt_json',
  errorCode: 'error_code', reportBytes: 'report_bytes', reportMeta: 'report_meta_json',
  reportState: 'report_state', reportReceipt: 'report_receipt_json',
});

function failure(message, statusCode = 400) {
  return Object.assign(new Error(message), { statusCode });
}

function nonempty(value, name) {
  if (typeof value !== 'string' || value.length === 0) throw failure(`${name} must be a nonempty string`);
  return value;
}

function timestamp(value, name) {
  if (!Number.isSafeInteger(value) || value < 0) throw failure(`${name} must be a nonnegative integer`);
  return value;
}

function json(value, name, nullable = false) {
  if (nullable && value === null) return null;
  try {
    const encoded = JSON.stringify(value);
    if (encoded === undefined) throw new Error('undefined');
    return encoded;
  } catch {
    throw failure(`${name} must be JSON serializable`);
  }
}

// Refuse symlinks in the existing path, and create files with private permissions
// before SQLite opens them (including its WAL and shared-memory companions).
function prepareDatabasePath(databasePath) {
  if (databasePath === ':memory:') return databasePath;
  nonempty(databasePath, 'databasePath');
  const absolute = resolve(databasePath);
  const root = parse(absolute).root;
  let current = root;
  for (const component of absolute.slice(root.length).split(sep)) {
    current = resolve(current, component);
    try {
      if (lstatSync(current).isSymbolicLink()) throw failure('databasePath must not contain symbolic links');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  mkdirSync(dirname(absolute), { recursive: true, mode: 0o700 });
  if (!existsSync(absolute)) {
    const descriptor = openSync(absolute, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
    closeSync(descriptor);
  } else if (!lstatSync(absolute).isFile()) {
    throw failure('databasePath must be a regular file');
  }
  chmodSync(absolute, 0o600);
  return absolute;
}

/** Private, synchronous persistence for iLAB sessions and delivery state. */
export function createIlabStore({ databasePath, storageKey, now = Date.now } = {}) {
  if (!Buffer.isBuffer(storageKey) || storageKey.length !== 32) throw failure('storageKey must be a 32-byte Buffer');
  if (typeof now !== 'function') throw failure('now must be a function');
  const key = Buffer.from(storageKey);
  const dbPath = prepareDatabasePath(databasePath);
  const db = new DatabaseSync(dbPath);
  let closed = false;

  function encrypt(id, value) {
    const plaintext = json(value, 'tokens');
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(Buffer.from(`ilab-attempt:${id}`, 'utf8'));
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return JSON.stringify({ v: 1, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: ciphertext.toString('base64') });
  }

  function decrypt(id, box) {
    try {
      const parsed = JSON.parse(box);
      if (parsed.v !== 1) throw new Error('unsupported envelope');
      const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(parsed.iv, 'base64'));
      decipher.setAAD(Buffer.from(`ilab-attempt:${id}`, 'utf8'));
      decipher.setAuthTag(Buffer.from(parsed.tag, 'base64'));
      const plaintext = Buffer.concat([decipher.update(Buffer.from(parsed.data, 'base64')), decipher.final()]);
      return JSON.parse(plaintext.toString('utf8'));
    } catch {
      throw failure('Stored iLAB credentials could not be decrypted', 500);
    }
  }

  function decode(row) {
    if (!row) return null;
    return {
      id: row.id, sessionHash: row.session_hash, ticketHash: row.ticket_hash,
      username: row.username, displayName: row.display_name, tokens: decrypt(row.id, row.token_box),
      state: row.state, createdAt: row.created_at, expiresAt: row.expires_at,
      steps: JSON.parse(row.steps_json), aiCalls: JSON.parse(row.ai_calls_json),
      result: row.result_json === null ? null : JSON.parse(row.result_json), resultHash: row.result_hash,
      receipt: row.receipt_json === null ? null : JSON.parse(row.receipt_json), errorCode: row.error_code,
      reportBytes: row.report_bytes === null ? null : Buffer.from(row.report_bytes),
      reportMeta: row.report_meta_json === null ? null : JSON.parse(row.report_meta_json),
      reportState: row.report_state,
      reportReceipt: row.report_receipt_json === null ? null : JSON.parse(row.report_receipt_json),
    };
  }

  function transaction(operation) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const result = operation();
      db.exec('COMMIT');
      return result;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }

  function get(id) {
    return decode(db.prepare('SELECT * FROM ilab_attempts WHERE id = ?').get(id));
  }

  function patchValues(id, fields) {
    if (fields === null || typeof fields !== 'object' || Array.isArray(fields)) throw failure('Attempt patch must be an object');
    const entries = Object.entries(fields);
    const values = entries.map(([field, value]) => {
      if (!Object.hasOwn(PATCH_COLUMNS, field)) throw failure(`Unsupported attempt field: ${field}`);
      if (field === 'tokens') return encrypt(id, value);
      if (field === 'state' || field === 'reportState') {
        if (!(field === 'state' ? ATTEMPT_STATES : REPORT_STATES).has(value)) throw failure(`Invalid ${field}`);
        return value;
      }
      if (field === 'steps' || field === 'aiCalls') {
        if (!Array.isArray(value)) throw failure(`${field} must be an array`);
        return json(value, field);
      }
      if (['result', 'receipt', 'reportMeta', 'reportReceipt'].includes(field)) return json(value, field, true);
      if (field === 'reportBytes') {
        if (value === null) return null;
        if (!(value instanceof Uint8Array)) throw failure('reportBytes must be bytes or null');
        return Buffer.from(value);
      }
      if (value !== null && typeof value !== 'string') throw failure(`${field} must be a string or null`);
      return value;
    });
    if (entries.length) {
      const setters = entries.map(([field]) => `${PATCH_COLUMNS[field]} = ?`).join(', ');
      db.prepare(`UPDATE ilab_attempts SET ${setters} WHERE id = ?`).run(...values, id);
    }
  }

  try {
    db.exec(`
      PRAGMA busy_timeout = 5000;
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS ilab_attempts (
        id TEXT PRIMARY KEY NOT NULL,
        session_hash TEXT NOT NULL UNIQUE,
        ticket_hash TEXT NOT NULL UNIQUE,
        username TEXT NOT NULL,
        display_name TEXT,
        token_box TEXT NOT NULL,
        state TEXT NOT NULL DEFAULT 'collecting' CHECK (state IN ('collecting','ready','submitting','sent','rejected','uncertain')),
        created_at INTEGER NOT NULL CHECK (created_at >= 0),
        expires_at INTEGER NOT NULL CHECK (expires_at > created_at),
        steps_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(steps_json) AND json_type(steps_json) = 'array'),
        ai_calls_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(ai_calls_json) AND json_type(ai_calls_json) = 'array'),
        result_json TEXT CHECK (result_json IS NULL OR json_valid(result_json)),
        result_hash TEXT,
        receipt_json TEXT CHECK (receipt_json IS NULL OR json_valid(receipt_json)),
        error_code TEXT,
        report_bytes BLOB,
        report_meta_json TEXT CHECK (report_meta_json IS NULL OR json_valid(report_meta_json)),
        report_state TEXT NOT NULL DEFAULT 'none' CHECK (report_state IN ('none','pending','submitting','sent','rejected','uncertain')),
        report_receipt_json TEXT CHECK (report_receipt_json IS NULL OR json_valid(report_receipt_json))
      );
      CREATE INDEX IF NOT EXISTS ilab_attempts_expiry ON ilab_attempts(expires_at);
      CREATE INDEX IF NOT EXISTS ilab_attempts_username ON ilab_attempts(username);
      CREATE TABLE IF NOT EXISTS ilab_events (
        attempt_id TEXT NOT NULL REFERENCES ilab_attempts(id) ON DELETE CASCADE,
        event_id TEXT NOT NULL,
        body_hash TEXT NOT NULL,
        PRIMARY KEY (attempt_id, event_id)
      );
      CREATE TABLE IF NOT EXISTS ilab_nonces (
        nonce TEXT PRIMARY KEY NOT NULL,
        created_at INTEGER NOT NULL CHECK (created_at >= 0)
      );
      CREATE INDEX IF NOT EXISTS ilab_nonces_created_at ON ilab_nonces(created_at);
      UPDATE ilab_attempts SET state = 'uncertain' WHERE state = 'submitting';
      UPDATE ilab_attempts SET report_state = 'uncertain' WHERE report_state = 'submitting';
    `);
    if (dbPath !== ':memory:') chmodSync(dbPath, 0o600);
  } catch (error) {
    db.close();
    key.fill(0);
    throw error;
  }

  return {
    createAttempt({ id, sessionHash, ticketHash, username, displayName = null, tokens, createdAt, expiresAt }) {
      for (const [name, value] of Object.entries({ id, sessionHash, ticketHash, username })) nonempty(value, name);
      timestamp(createdAt, 'createdAt');
      timestamp(expiresAt, 'expiresAt');
      if (expiresAt <= createdAt) throw failure('expiresAt must be after createdAt');
      if (displayName !== null && typeof displayName !== 'string') throw failure('displayName must be a string or null');
      const tokenBox = encrypt(id, tokens);
      try {
        db.prepare(`INSERT INTO ilab_attempts
          (id, session_hash, ticket_hash, username, display_name, token_box, created_at, expires_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(id, sessionHash, ticketHash, username, displayName, tokenBox, createdAt, expiresAt);
      } catch (error) {
        if (error.errcode === 1555 || error.errcode === 2067 || /UNIQUE constraint failed/.test(error.message)) {
          throw failure('Attempt, session, or ticket already exists', 409);
        }
        throw error;
      }
      return get(id);
    },
    get,
    bySessionHash(hash) {
      return decode(db.prepare('SELECT * FROM ilab_attempts WHERE session_hash = ?').get(hash));
    },
    ticketUsed(hash) {
      return Boolean(db.prepare('SELECT 1 FROM ilab_attempts WHERE ticket_hash = ?').get(hash));
    },
    useNonce(nonce, at = now()) {
      nonempty(nonce, 'nonce');
      timestamp(at, 'at');
      const cutoff = timestamp(now(), 'now') - NONCE_TTL_MS;
      return transaction(() => {
        db.prepare('DELETE FROM ilab_nonces WHERE created_at < ?').run(cutoff);
        return db.prepare('INSERT OR IGNORE INTO ilab_nonces (nonce, created_at) VALUES (?, ?)').run(nonce, at).changes === 1;
      });
    },
    applyEvent(id, eventId, bodyHash, mutate) {
      nonempty(eventId, 'eventId');
      nonempty(bodyHash, 'bodyHash');
      if (typeof mutate !== 'function') throw failure('mutate must be a function');
      if (mutate.constructor?.name === 'AsyncFunction') throw failure('Event mutation must be synchronous');
      return transaction(() => {
        const attempt = get(id);
        if (!attempt) throw failure('Attempt not found', 404);
        const event = db.prepare('SELECT body_hash FROM ilab_events WHERE attempt_id = ? AND event_id = ?').get(id, eventId);
        if (event) {
          if (event.body_hash !== bodyHash) throw failure('Event identifier has already been used with a different body', 409);
          return { attempt, idempotent: true };
        }
        if (attempt.state !== 'collecting') throw failure('Attempt is no longer collecting events', 409);
        const fields = mutate(attempt);
        if (fields?.then && typeof fields.then === 'function') {
          // Consume a returned rejected promise without allowing it to commit.
          Promise.resolve(fields).catch(() => {});
          throw failure('Event mutation must be synchronous');
        }
        patchValues(id, fields);
        db.prepare('INSERT INTO ilab_events (attempt_id, event_id, body_hash) VALUES (?, ?, ?)').run(id, eventId, bodyHash);
        return { attempt: get(id), idempotent: false };
      });
    },
    patch(id, fields) {
      if (!get(id)) throw failure('Attempt not found', 404);
      patchValues(id, fields);
      return get(id);
    },
    compareAndSetState(id, fromArray, to) {
      return compareAndSet(id, 'state', ATTEMPT_STATES, fromArray, to);
    },
    compareAndSetReportState(id, fromArray, to) {
      return compareAndSet(id, 'report_state', REPORT_STATES, fromArray, to);
    },
    close() {
      if (closed) return;
      db.close();
      key.fill(0);
      closed = true;
    },
  };

  function compareAndSet(id, column, allowed, fromArray, to) {
    if (!Array.isArray(fromArray) || fromArray.length === 0 || !fromArray.every((state) => allowed.has(state)) || !allowed.has(to)) {
      throw failure('Invalid state transition');
    }
    const placeholders = fromArray.map(() => '?').join(', ');
    return db.prepare(`UPDATE ilab_attempts SET ${column} = ? WHERE id = ? AND ${column} IN (${placeholders})`).run(to, id, ...fromArray).changes === 1;
  }
}
