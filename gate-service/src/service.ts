import { GateAuth } from './auth.js';
import type { GateChainReader, FinalizedBaseline } from './chain.js';
import { GateStore } from './store.js';
import { GateError, type GateEvent, type GateHealth, type GateReceipt, type GateAttempt, type ClaimRedemptionResult, type OpenRedemptionResult, type ReadRedemptionResult } from './types.js';
import { event, eventKey, openRequest, claimRequest, sameRequest, blockHash, publicHex, publicId, record, transactionId } from './validation.js';

export interface GateServiceOptions {
  store: GateStore;
  auth: GateAuth;
  events: { event: GateEvent; reader: GateChainReader }[];
  verificationTimeoutMs?: number;
  attemptLifetimeMs?: number;
  maxConcurrentVerifications?: number;
  now?: () => number;
}
function positive(value: number, max: number): number {
  if (!Number.isSafeInteger(value) || value <= 0 || value > max) throw new Error('Invalid bounded gate policy');
  return value;
}
export class GateService {
  #events = new Map<string, { event: GateEvent; reader: GateChainReader }>();
  #pending = new Map<string, Promise<GateReceipt>>();
  #baselines = new Map<string, Promise<FinalizedBaseline>>();
  #timeout: number;
  #lifetime: number;
  #capacity: number;
  #now: () => number;
  #stopped = false;
  constructor(readonly options: GateServiceOptions) {
    this.#timeout = positive(options.verificationTimeoutMs ?? 30_000, 120_000);
    this.#lifetime = positive(options.attemptLifetimeMs ?? 300_000, 900_000);
    this.#capacity = positive(options.maxConcurrentVerifications ?? 32, 128);
    this.#now = options.now ?? Date.now;
    if (!options.events.length || options.events.length > 128) throw new Error('Explicit bounded trusted event registry required');
    for (const item of options.events) {
      const trusted = event(item.event), key = eventKey(trusted);
      if (this.#events.has(key)) throw new Error('Duplicate trusted event');
      this.#events.set(key, { event: trusted, reader: item.reader });
    }
    if (new Set([...this.#events.values()].map(item => item.event.network)).size !== 1) throw new Error('One pinned Midnight network per gate process is required');
  }
  /** Revokes late admissions; does not pretend to cancel an already started SDK read. */
  stop(): void { this.#stopped = true; }
  #guard(): void { if (this.#stopped) throw new GateError('service-unavailable', 503); }
  #authenticate(gateId: unknown, authorization: unknown): string {
    this.#guard(); return this.options.auth.authenticate(gateId, authorization);
  }
  async #bounded<T>(promise: Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([promise, new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new GateError('verification-timeout', 504)), this.#timeout);
      })]);
    } finally { if (timer) clearTimeout(timer); }
  }
  health(gateId: unknown, authorization: unknown): GateHealth {
    this.#authenticate(gateId, authorization);
    return { schema: 'guestlist-gate-health-v1', policy: 'active-before-redemption-v1', storage: 'durable-shared', events: [...this.#events.values()].map(item => ({ ...item.event })) };
  }
  readRedemption(gateId: unknown, authorization: unknown, input: unknown): ReadRedemptionResult {
    const ownerGate = this.#authenticate(gateId, authorization);
    const value = record(input, ['requestId']), requestId = publicId(value.requestId);
    const attempt = this.options.store.get(requestId, ownerGate);
    if (!attempt) throw new GateError('attempt-not-found', 404);
    const receipt = this.options.store.claimed(requestId, ownerGate);
    return { admit: false, code: receipt ? 'claimed' : attempt.status === 'expired' || attempt.status === 'open' && attempt.expiresAt <= this.#now() ? 'expired' : 'pending', attempt, ...(receipt ? { receipt } : {}) };
  }
  async openRedemption(gateId: unknown, authorization: unknown, input: unknown): Promise<OpenRedemptionResult> {
    const ownerGate = this.#authenticate(gateId, authorization), request = openRequest(input);
    const configured = this.#events.get(eventKey(request));
    if (!configured) throw new GateError('event-not-configured', 403);
    const previous = this.options.store.get(request.requestId, ownerGate);
    if (previous && sameRequest(previous, request) && previous.status === 'open' && previous.expiresAt > this.#now()) return { code: 'opened', admit: false, attempt: previous };
    const readKey = `${ownerGate}:${eventKey(request)}:${request.requestId}:${request.commitment}`;
    let read = this.#baselines.get(readKey);
    if (!read) {
      if (this.#pending.size + this.#baselines.size >= this.#capacity) throw new GateError('verification-capacity', 503);
      read = Promise.resolve().then(() => configured.reader.readActiveBaseline(request));
      this.#baselines.set(readKey, read);
      const owned = read;
      const remove = () => { if (this.#baselines.get(readKey) === owned) this.#baselines.delete(readKey); };
      void read.then(remove, remove);
    }
    let baseline;
    try { baseline = await this.#bounded(read); }
    catch (error) { if (error instanceof GateError) throw error; throw new GateError('verification-failed', 503); }
    this.#guard();
    const hash = blockHash(baseline.hash);
    if (!Number.isSafeInteger(baseline.height) || baseline.height < 0) throw new GateError('verification-failed', 503);
    // Durable reservation is created only after successful independent ACTIVE read.
    const attempt = this.options.store.open(request, ownerGate, { hash, height: baseline.height }, this.#now(), this.#lifetime);
    return { code: 'opened', admit: false, attempt };
  }
  async claimRedemption(gateId: unknown, authorization: unknown, input: unknown): Promise<ClaimRedemptionResult> {
    const ownerGate = this.#authenticate(gateId, authorization), request = claimRequest(input);
    const attempt = this.options.store.bind(request.requestId, ownerGate, request.txId, this.#now());
    const configured = this.#events.get(eventKey(attempt));
    if (!configured) throw new GateError('event-not-configured', 403);
    const existing = this.options.store.claimed(request.requestId, ownerGate);
    if (existing) return { code: 'already-claimed', admit: false, requestId: request.requestId, receipt: existing };
    // Reuse the SAME unresolved read after timeout; no unbounded orphan subscriptions per retry.
    let verification = this.#pending.get(request.requestId);
    if (!verification) {
      if (this.#pending.size + this.#baselines.size >= this.#capacity) throw new GateError('verification-capacity', 503);
      verification = Promise.resolve().then(() => configured.reader.verifyRedemption(attempt, request.txId)).then(receipt => this.#safeReceipt(receipt, attempt, request.txId));
      this.#pending.set(request.requestId, verification);
      const owned = verification;
      const remove = () => { if (this.#pending.get(request.requestId) === owned) this.#pending.delete(request.requestId); };
      void verification.then(remove, remove);
    }
    let receipt: GateReceipt;
    try { receipt = await this.#bounded(verification); }
    catch (error) { if (error instanceof GateError) throw error; throw new GateError('verification-failed', 503); }
    this.#guard();
    const committed = this.options.store.commit(attempt, receipt, this.#now());
    return { code: committed.admit ? 'admitted' : 'already-claimed', admit: committed.admit, requestId: request.requestId, receipt: committed.receipt };
  }
  #safeReceipt(receipt: GateReceipt, attempt: GateAttempt, txId: string): GateReceipt {
    if (!receipt || receipt.schema !== 'midnight-event-pass-receipt-v1' || receipt.action !== 'redeem' ||
        receipt.network !== attempt.network || receipt.contractAddress !== attempt.contractAddress || receipt.eventId !== attempt.eventId ||
        receipt.commitment !== attempt.commitment || receipt.txId !== txId && !receipt.identifiers?.includes(txId) || receipt.transactionStatus !== 'SucceedEntirely' ||
        receipt.stateCheck !== 'verified-at-finalized-block' || !receipt.publicState || receipt.publicState.passStatus !== 'USED' ||
        receipt.publicState.eventId !== attempt.eventId || receipt.publicState.issuerCommitment !== attempt.issuerCommitment ||
        !Number.isSafeInteger(receipt.blockHeight) || receipt.blockHeight <= attempt.baselineBlockHeight ||
        !Number.isFinite(receipt.blockTimestamp) || receipt.blockTimestamp < 0 || !Array.isArray(receipt.identifiers) ||
        !receipt.identifiers.includes(txId) || receipt.identifiers.length > 256 ||
        [receipt.publicState.issuedCount, receipt.publicState.redeemedCount, receipt.publicState.revokedCount].some(value => typeof value !== 'string' || !/^(?:0|[1-9][0-9]{0,38})$/.test(value))) {
      throw new GateError('verification-failed', 503);
    }
    try { transactionId(receipt.txId); publicHex(receipt.txHash); blockHash(receipt.blockHash); receipt.identifiers.forEach(transactionId); }
    catch { throw new GateError('verification-failed', 503); }
    // Whitelist public fields: never serialize the raw SDK transaction or an extra field from a provider.
    return { schema: 'midnight-event-pass-receipt-v1', network: receipt.network, action: 'redeem',
      contractAddress: receipt.contractAddress, eventId: receipt.eventId, commitment: receipt.commitment,
      txId: receipt.txId, identifiers: [...receipt.identifiers], txHash: receipt.txHash,
      blockHash: blockHash(receipt.blockHash), blockHeight: receipt.blockHeight, blockTimestamp: receipt.blockTimestamp,
      transactionStatus: 'SucceedEntirely', stateCheck: 'verified-at-finalized-block', publicState: {
        eventId: receipt.publicState.eventId, issuerCommitment: receipt.publicState.issuerCommitment,
        issuedCount: receipt.publicState.issuedCount, redeemedCount: receipt.publicState.redeemedCount,
        revokedCount: receipt.publicState.revokedCount, passStatus: 'USED',
      } };
  }
}
export { GateAuth } from './auth.js';
export { GateStore } from './store.js';
export * from './types.js';
