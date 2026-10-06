import { DatabaseSync } from 'node:sqlite';
import { isAbsolute } from 'node:path';
import { assertDatabaseIdentity, type StorageFileIdentity } from './owner-files.js';
import { GateError, type GateAttempt, type GateReceipt, type OpenRedemptionRequest } from './types.js';
import { admissionKey, sameRequest } from './validation.js';

type Row = { request_id: string; gate_id: string; public_json: string; opened_at: number; expires_at: number; baseline_hash: string; baseline_height: number; status: GateAttempt['status']; tx_id: string | null };
/** Backend-only storage primitive. All gates/processes MUST use the same local durable SQLite file.
 * No raw client receipt reaches this object; GateService independently verifies before commit.
 */
export class GateStore {
  #db: DatabaseSync;
  #maxAttempts: number;
  constructor(path: string, options: { busyTimeoutMs?: number; maxAttempts?: number; expectedIdentity?: StorageFileIdentity } = {}) {
    if (!isAbsolute(path) || path === ':memory:') throw new Error('An absolute durable SQLite file is required');
    this.#maxAttempts = options.maxAttempts ?? 50_000;
    if (!Number.isSafeInteger(this.#maxAttempts) || this.#maxAttempts < 1 || this.#maxAttempts > 1_000_000) throw new Error('Invalid bounded admission capacity');
    const timeout = options.busyTimeoutMs ?? 2_000;
    if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 10_000) throw new Error('Invalid SQLite busy timeout');
    if (options.expectedIdentity) assertDatabaseIdentity(path, options.expectedIdentity);
    this.#db = new DatabaseSync(path, { timeout, enableForeignKeyConstraints: true, allowExtension: false });
    try {
      const version = String(this.#db.prepare('SELECT sqlite_version() AS v').get()?.v ?? '').split('.').map(Number);
      // Multi-process WAL must include the official WAL-reset corruption fix.
      if (version.length !== 3 || version.some(value => !Number.isSafeInteger(value)) || version[0]! < 3 || version[0] === 3 && (version[1]! < 51 || version[1] === 51 && version[2]! < 3)) throw new Error('SQLite 3.51.3 or newer required for shared WAL');
      this.#db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;
        CREATE TABLE IF NOT EXISTS gate_meta(version INTEGER NOT NULL) STRICT;
        INSERT INTO gate_meta SELECT 1 WHERE NOT EXISTS(SELECT 1 FROM gate_meta);
        CREATE TABLE IF NOT EXISTS gate_attempts(
          request_id TEXT PRIMARY KEY, gate_id TEXT NOT NULL, admission_key TEXT NOT NULL,
          public_json TEXT NOT NULL, opened_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
          baseline_hash TEXT NOT NULL, baseline_height INTEGER NOT NULL,
          status TEXT NOT NULL CHECK(status IN ('open','bound','claimed','expired')), tx_id TEXT
        ) STRICT;
        CREATE UNIQUE INDEX IF NOT EXISTS gate_one_live_attempt ON gate_attempts(admission_key)
          WHERE status IN ('open','bound','claimed');
        CREATE TABLE IF NOT EXISTS gate_claims(
          admission_key TEXT PRIMARY KEY, request_id TEXT NOT NULL UNIQUE REFERENCES gate_attempts(request_id),
          gate_id TEXT NOT NULL, claimed_at INTEGER NOT NULL, receipt_json TEXT NOT NULL
        ) STRICT;`);
      if (this.#db.prepare('PRAGMA journal_mode').get()?.journal_mode !== 'wal' ||
          this.#db.prepare('PRAGMA synchronous').get()?.synchronous !== 2 ||
          this.#db.prepare('PRAGMA foreign_keys').get()?.foreign_keys !== 1) throw new Error('Durable shared SQLite configuration unavailable');
      const schema = this.#db.prepare('SELECT version FROM gate_meta').all();
      if (schema.length !== 1 || schema[0]?.version !== 1) throw new Error('Unsupported gate database schema');
      const check = this.#db.prepare('PRAGMA quick_check').get();
      if (!check || Object.values(check)[0] !== 'ok') throw new Error('Gate database integrity check failed');
      // The owner launcher binds its reserved database; creation/substitution races fail before listening.
      if (options.expectedIdentity) assertDatabaseIdentity(path, options.expectedIdentity);
    } catch (error) { this.#db.close(); throw error; }
  }
  close(): void { this.#db.close(); }
  #transaction<T>(body: () => T): T {
    try {
      this.#db.exec('BEGIN IMMEDIATE');
      try { const result = body(); this.#db.exec('COMMIT'); return result; }
      catch (error) { this.#db.exec('ROLLBACK'); throw error; }
    } catch (error) {
      if (error instanceof GateError) throw error;
      // Never return admit=true when COMMIT, disk, locking or corruption fails.
      throw new GateError('storage-unavailable', 503);
    }
  }
  #decode(row: Row): GateAttempt {
    return { ...(JSON.parse(row.public_json) as OpenRedemptionRequest), gateId: row.gate_id,
      openedAt: row.opened_at, expiresAt: row.expires_at, baselineBlockHash: row.baseline_hash,
      baselineBlockHeight: row.baseline_height, status: row.status, ...(row.tx_id ? { txId: row.tx_id } : {}) };
  }
  #row(requestId: string): Row | undefined {
    return this.#db.prepare('SELECT * FROM gate_attempts WHERE request_id=?').get(requestId) as Row | undefined;
  }
  get(requestId: string, gateId: string): GateAttempt | undefined {
    try { const row = this.#row(requestId); return row?.gate_id === gateId ? this.#decode(row) : undefined; }
    catch { throw new GateError('storage-unavailable', 503); }
  }
  open(request: OpenRedemptionRequest, gateId: string, baseline: { hash: string; height: number }, now: number, lifetimeMs: number): GateAttempt {
    return this.#transaction(() => {
      this.#db.prepare("UPDATE gate_attempts SET status='expired' WHERE status='open' AND expires_at<=?").run(now);
      const previous = this.#row(request.requestId);
      if (previous) {
        const existing = this.#decode(previous);
        if (existing.gateId !== gateId || !sameRequest(existing, request)) throw new GateError('attempt-conflict', 409);
        if (existing.status === 'expired') throw new GateError('attempt-expired', 409);
        if (existing.status !== 'open') throw new GateError('transaction-conflict', 409);
        return existing;
      }
      if (this.#db.prepare('SELECT 1 FROM gate_attempts WHERE admission_key=? AND status<>?').get(admissionKey(request), 'expired')) throw new GateError('attempt-conflict', 409);
      const count = this.#db.prepare('SELECT count(*) AS n FROM gate_attempts').get()?.n;
      if (typeof count !== 'number' || count >= this.#maxAttempts) throw new GateError('storage-unavailable', 503);
      this.#db.prepare(`INSERT INTO gate_attempts(request_id,gate_id,admission_key,public_json,opened_at,expires_at,baseline_hash,baseline_height,status)
        VALUES(?,?,?,?,?,?,?,?,'open')`).run(request.requestId, gateId, admissionKey(request), JSON.stringify(request), now, now + lifetimeMs, baseline.hash, baseline.height);
      return this.#decode(this.#row(request.requestId)!);
    });
  }
  bind(requestId: string, gateId: string, txId: string, now: number): GateAttempt {
    return this.#transaction(() => {
      const row = this.#row(requestId);
      if (!row || row.gate_id !== gateId) throw new GateError('attempt-not-found', 404);
      if (row.status === 'expired' || row.status === 'open' && row.expires_at <= now) throw new GateError('attempt-expired', 409);
      if (row.tx_id && row.tx_id !== txId) throw new GateError('transaction-conflict', 409);
      if (row.status === 'open') this.#db.prepare("UPDATE gate_attempts SET tx_id=?,status='bound' WHERE request_id=? AND status='open'").run(txId, requestId);
      return this.#decode(this.#row(requestId)!);
    });
  }
  /** Single linearization point. Only a successful durable COMMIT can return admit=true. */
  commit(attempt: GateAttempt, receipt: GateReceipt, now: number): { admit: boolean; receipt: GateReceipt } {
    return this.#transaction(() => {
      const row = this.#row(attempt.requestId);
      if (!row || row.gate_id !== attempt.gateId || !sameRequest(this.#decode(row), attempt) || row.tx_id !== receipt.txId && !receipt.identifiers.includes(row.tx_id ?? '')) throw new GateError('transaction-conflict', 409);
      const key = admissionKey(attempt);
      const existing = this.#db.prepare('SELECT receipt_json FROM gate_claims WHERE admission_key=?').get(key);
      if (existing) return { admit: false, receipt: JSON.parse(existing.receipt_json as string) as GateReceipt };
      if (row.status !== 'bound') throw new GateError('transaction-conflict', 409);
      this.#db.prepare('INSERT INTO gate_claims(admission_key,request_id,gate_id,claimed_at,receipt_json) VALUES(?,?,?,?,?)')
        .run(key, attempt.requestId, attempt.gateId, now, JSON.stringify(receipt));
      this.#db.prepare("UPDATE gate_attempts SET status='claimed' WHERE request_id=? AND status='bound'").run(attempt.requestId);
      return { admit: true, receipt };
    });
  }
  /** Recovery is read-only; never reissues an admission grant after a lost HTTP response. */
  claimed(requestId: string, gateId: string): GateReceipt | undefined {
    try {
      const row = this.#db.prepare('SELECT receipt_json FROM gate_claims WHERE request_id=? AND gate_id=?').get(requestId, gateId);
      return row ? JSON.parse(row.receipt_json as string) as GateReceipt : undefined;
    } catch { throw new GateError('storage-unavailable', 503); }
  }
}
