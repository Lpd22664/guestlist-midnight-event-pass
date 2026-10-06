import type { Action, Network, PublicReceipt } from './receipts.js';

export interface Attempt {
  requestId: string;
  network: Network;
  action: Action;
  /** Undefined until a deployment's address is known. */
  contractAddress?: string;
  eventId: string;
  issuerCommitment: string;
  commitment?: string;
  state: 'started' | 'submitting' | 'submitted' | 'unknown' | 'verified' | 'failed-before-submit';
  expiresAt: number;
  candidateTxIds?: string[];
  txId?: string;
  receipt?: PublicReceipt;
}
/** Owner-provided durable, account-scoped journal. Persist before any submission.
 * create must atomically reject duplicate requestId and unresolved same-event attempts.
 * update must be atomic. The adapter never records private material here.
 */
export interface AttemptJournal {
  create(attempt: Attempt): Promise<void>;
  get(requestId: string): Promise<Attempt | null>;
  update(attempt: Attempt): Promise<void>;
}
export class OutcomeUnknownError extends Error {
  constructor(readonly requestId: string) {
    super('Operation outcome is unresolved. Do not resubmit or admit. Reconcile the existing transaction read-only.');
  }
}
export class ReadTimeoutError extends Error {
  constructor() { super('Read-only query timed out; no success is inferred'); }
}
export function withReadTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('Positive timeout required');
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new ReadTimeoutError()), timeoutMs);
    promise.then((value) => { clearTimeout(timer); resolve(value); }, () => { clearTimeout(timer); reject(new Error('Read-only provider query failed')); });
  });
}
