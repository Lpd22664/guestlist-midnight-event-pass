import { isUnresolved, loadPublicAttempts, publicAttemptCopy, PUBLIC_STORAGE_KEY, type PublicAttempt } from './model';
export type PublicHistoryStorage = Pick<Storage, 'getItem' | 'setItem'>;
/** Production uses native same-origin Web Locks. Tests must supply an explicit shared implementation. */
export interface PublicHistoryLock {
  request<T>(name: string, operation: () => T | Promise<T>): Promise<T>;
}
export const PUBLIC_HISTORY_LOCK_NAME = `${PUBLIC_STORAGE_KEY}:atomic-history`;
export class PublicHistoryError extends Error {
  constructor(message: string, readonly marksHistoryUnusable = true) { super(message); this.name = 'PublicHistoryError'; }
}
/** An obsolete owner session is an expected cancellation, never evidence of storage corruption. */
export class PublicHistoryCancelledError extends PublicHistoryError {
  constructor() { super('Public history operation was cancelled for an obsolete owner session.', false); this.name = 'PublicHistoryCancelledError'; }
}
function nativeLock(): PublicHistoryLock {
  const manager = globalThis.navigator?.locks;
  if (!manager || typeof manager.request !== 'function') throw new PublicHistoryError('Public request history requires same-origin Web Locks. Live submissions are locked; no unsafe storage fallback is available.');
  return { request: async (name, operation) => await manager.request(name, { mode: 'exclusive' }, async () => await operation()) };
}
function identity(attempt: PublicAttempt): string {
  return JSON.stringify([attempt.requestId, attempt.ownerAccountId, attempt.eventId, attempt.role, attempt.action, attempt.commitment ?? null]);
}
function canonicalReceipt(attempt: PublicAttempt): string {
  const receipt = attempt.receipt;
  return JSON.stringify(receipt ? { ...receipt, identifiers: [...receipt.identifiers].sort() } : null);
}
/** Immutable identity and monotonic uncertainty/finality. Terminal rejection comes only from the owning operation/SDK journal. */
export function mergePublicAttempt(existing: PublicAttempt, incoming: PublicAttempt): PublicAttempt {
  const current = publicAttemptCopy(existing), next = publicAttemptCopy(incoming);
  if (identity(current) !== identity(next)) throw new PublicHistoryError('Public request ID identity collision. Preserve the SDK journal and do not resubmit.', false);
  if (current.status === 'verified') {
    if (next.status === 'verified' && canonicalReceipt(current) !== canonicalReceipt(next)) throw new PublicHistoryError('Public verified receipt collision. Preserve the original finalized evidence.', false);
    return current;
  }
  if (next.status === 'verified') return next;
  if (current.status === 'unknown' && next.status === 'pending') return current;
  if (current.status === 'rejected' && next.status === 'pending') return current;
  return next;
}
function validatedRows(storage: PublicHistoryStorage): PublicAttempt[] {
  const rows = loadPublicAttempts(storage), ids = new Set<string>();
  for (const row of rows) {
    if (ids.has(row.requestId)) throw new PublicHistoryError('Public request history contains duplicate or colliding request IDs. Keep the SDK journal and recover read-only.');
    ids.add(row.requestId);
  }
  return rows;
}
export class PublicHistory {
  constructor(readonly storage: PublicHistoryStorage, readonly suppliedLock?: PublicHistoryLock | null) {}
  async #atomic<T>(operation: () => T): Promise<T> {
    const lock = this.suppliedLock === undefined ? nativeLock() : this.suppliedLock;
    if (!lock) throw new PublicHistoryError('Public request history requires same-origin Web Locks. Live submissions are locked; no unsafe storage fallback is available.');
    try { return await lock.request(PUBLIC_HISTORY_LOCK_NAME, operation); }
    catch (error) {
      if (error instanceof PublicHistoryError) throw error;
      throw new PublicHistoryError('Public request history could not be read or durably persisted under its atomic lock. Keep the original request ID and SDK journal; no success or permission to resubmit is inferred.');
    }
  }
  async read(): Promise<PublicAttempt[]> { return this.#atomic(() => validatedRows(this.storage)); }
  async merge(incoming: PublicAttempt[], assertActive?: () => void): Promise<PublicAttempt[]> {
    return this.#atomic(() => {
      assertActive?.();
      const rows = validatedRows(this.storage);
      for (const input of incoming) {
        const next = publicAttemptCopy(input), index = rows.findIndex(row => row.requestId === next.requestId);
        if (index < 0) rows.push(next); else rows[index] = mergePublicAttempt(rows[index], next);
      }
      const encoded = JSON.stringify(rows);
      this.storage.setItem(PUBLIC_STORAGE_KEY, encoded);
      if (this.storage.getItem(PUBLIC_STORAGE_KEY) !== encoded) throw new PublicHistoryError('Public request persistence was not acknowledged. Keep the original request ID; no SDK effect is authorized.');
      return rows;
    });
  }
  /** Refresh, duplicate/unresolved checks and durable reservation are one critical section. */
  async reserve(input: PublicAttempt, assertActive: () => void): Promise<PublicAttempt[]> {
    return this.#atomic(() => {
      assertActive();
      const rows = validatedRows(this.storage), next = publicAttemptCopy(input);
      if (next.status !== 'pending' || next.receipt) throw new PublicHistoryError('Public transaction reservation must start pending without a receipt.', false);
      const duplicate = rows.find(row => row.requestId === next.requestId);
      if (duplicate) {
        if (identity(duplicate) !== identity(next)) throw new PublicHistoryError('Public request ID identity collision. Preserve the SDK journal and do not resubmit.', false);
        throw new PublicHistoryError('Public request ID was already used. Reconcile the existing request; never resubmit it.', false);
      }
      if (rows.some(row => row.ownerAccountId === next.ownerAccountId && row.eventId === next.eventId && row.role === next.role && isUnresolved(row))) throw new PublicHistoryError('Public owner/event/role has an unresolved request. Reconcile it read-only; do not submit again.', false);
      rows.push(next);
      const encoded = JSON.stringify(rows);
      this.storage.setItem(PUBLIC_STORAGE_KEY, encoded);
      if (this.storage.getItem(PUBLIC_STORAGE_KEY) !== encoded) throw new PublicHistoryError('Public request persistence was not acknowledged. Keep the original request ID; no SDK effect is authorized.');
      return rows;
    });
  }
}
