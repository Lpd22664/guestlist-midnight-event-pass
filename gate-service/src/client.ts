import { GateError, type OpenRedemptionRequest, type ClaimRedemptionRequest, type OpenRedemptionResult, type ClaimRedemptionResult, type GateHealth, type ReadRedemptionRequest, type ReadRedemptionResult, type GateEvent, type GateAttempt, type GateReceipt } from './types.js';
import { event, eventKey, openRequest, publicHex, publicId, transactionId, sameRequest } from './validation.js';
export * from './types.js';
export interface AdmissionClientOptions {
  serviceUrl: string;
  gateId: string;
  /** Existing owner-provisioned authority; secure owner handoff is required. Memory-only, never localStorage/env in browser bundles. */
  apiSecret: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}
const ERROR_CODES = new Set([
  'invalid-request', 'unauthorized', 'event-not-configured', 'not-active', 'attempt-conflict',
  'attempt-not-found', 'attempt-expired', 'transaction-conflict', 'verification-failed',
  'verification-timeout', 'verification-capacity', 'storage-unavailable', 'service-unavailable',
]);
const MAX_RESPONSE_BYTES = 128 * 1024;
const invalidResponse = (): never => { throw new GateError('service-unavailable', 503); };
function exact(value: unknown, required: string[], optional: string[] = []): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalidResponse();
  const result = value as Record<string, unknown>, allowed = new Set([...required, ...optional]);
  if (required.some(key => !Object.hasOwn(result, key)) || Object.keys(result).some(key => !allowed.has(key))) return invalidResponse();
  return result;
}
function safeInteger(value: unknown): value is number { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0; }
function publicEvent(value: Record<string, unknown>): GateEvent {
  try { return event({ network: value.network, contractAddress: value.contractAddress, eventId: value.eventId, issuerCommitment: value.issuerCommitment }); }
  catch { return invalidResponse(); }
}
function receipt(value: unknown, expected?: GateAttempt, candidate?: string): GateReceipt {
  const data = exact(value, ['schema','network','action','contractAddress','txId','identifiers','txHash','blockHash','blockHeight','blockTimestamp','transactionStatus','stateCheck','eventId','commitment','publicState']);
  const state = exact(data.publicState, ['eventId','issuerCommitment','issuedCount','redeemedCount','revokedCount','passStatus']);
  const identity = publicEvent({ ...data, issuerCommitment: state.issuerCommitment });
  if (data.schema !== 'midnight-event-pass-receipt-v1' || data.action !== 'redeem' || data.transactionStatus !== 'SucceedEntirely' ||
      data.stateCheck !== 'verified-at-finalized-block' || state.passStatus !== 'USED' || state.eventId !== identity.eventId ||
      !safeInteger(data.blockHeight) || typeof data.blockTimestamp !== 'number' || !Number.isFinite(data.blockTimestamp) || data.blockTimestamp < 0 ||
      !Array.isArray(data.identifiers) || !data.identifiers.length || data.identifiers.length > 256 ||
      [state.issuedCount,state.redeemedCount,state.revokedCount].some(item => typeof item !== 'string' || !/^(?:0|[1-9][0-9]{0,38})$/.test(item))) return invalidResponse();
  try { publicHex(data.commitment); publicHex(data.txHash); publicHex(data.blockHash); transactionId(data.txId); data.identifiers.forEach(transactionId); }
  catch { return invalidResponse(); }
  if (!data.identifiers.includes(data.txId) || new Set(data.identifiers).size !== data.identifiers.length ||
      candidate !== undefined && !data.identifiers.includes(candidate) ||
      expected && (eventKey(identity) !== eventKey(expected) || data.commitment !== expected.commitment || Number(data.blockHeight) <= expected.baselineBlockHeight)) return invalidResponse();
  return data as unknown as GateReceipt;
}
function attempt(value: unknown, expectedGateId: string, expectedRequestId: string): GateAttempt {
  const data = exact(value, ['requestId','network','contractAddress','eventId','issuerCommitment','commitment','gateId','openedAt','expiresAt','baselineBlockHash','baselineBlockHeight','status'], ['txId']);
  publicEvent(data);
  try { publicId(data.requestId); publicHex(data.commitment); publicHex(data.baselineBlockHash); if (Object.hasOwn(data,'txId')) transactionId(data.txId); }
  catch { return invalidResponse(); }
  if (data.requestId !== expectedRequestId || data.gateId !== expectedGateId || !safeInteger(data.openedAt) || !safeInteger(data.expiresAt) ||
      data.expiresAt <= data.openedAt || data.expiresAt - data.openedAt > 900_000 || !safeInteger(data.baselineBlockHeight) ||
      !['open','bound','claimed','expired'].includes(data.status as string) ||
      (data.status === 'bound' || data.status === 'claimed') !== Object.hasOwn(data,'txId')) return invalidResponse();
  return data as unknown as GateAttempt;
}
async function boundedJson(response: Response): Promise<unknown> {
  const contentType = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase();
  const length = response.headers.get('content-length');
  if (contentType !== 'application/json' || length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_RESPONSE_BYTES) || !response.body) return invalidResponse();
  const reader = response.body.getReader(), chunks: Uint8Array[] = []; let total = 0;
  try {
    while (true) {
      const next = await reader.read(); if (next.done) break;
      total += next.value.byteLength;
      if (total > MAX_RESPONSE_BYTES) { await reader.cancel().catch(() => {}); return invalidResponse(); }
      chunks.push(next.value);
    }
    const bytes = new Uint8Array(total); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown;
  } finally { reader.releaseLock(); }
}
/** Browser-only public identifier client. Strict JSON validation; never accepts an issuer/bearer capability or raw SDK tx. */
export function createAdmissionClient(options: AdmissionClientOptions) {
  const { serviceUrl, gateId, apiSecret, timeoutMs, fetchImpl = fetch } = options;
  const url = new URL(serviceUrl);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash ||
      !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && url.protocol !== 'https:') throw new Error('Trusted HTTPS or loopback gate service required');
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(gateId) || apiSecret.length < 32 || apiSecret.length > 512 || !/^[\x21-\x7e]+$/.test(apiSecret)) throw new Error('Explicit existing owner-provisioned gate authority required');
  const timeout = timeoutMs ?? 35_000;
  if (!Number.isSafeInteger(timeout) || timeout <= 0 || timeout > 180_000) throw new Error('Invalid gate request timeout');
  let secret: string | undefined = apiSecret;
  const base = url.href.replace(/\/$/, ''), session = new AbortController();
  const contexts = new Map<string, GateAttempt>(); let registry: Set<string> | undefined;
  const remember = (context: GateAttempt) => {
    if (contexts.size >= 128 && !contexts.has(context.requestId)) contexts.delete(contexts.keys().next().value!);
    contexts.set(context.requestId, { ...context });
  };
  const checkRegistry = (identity: GateEvent) => { if (registry && !registry.has(eventKey(identity))) invalidResponse(); };
  async function request(path: string, body?: unknown): Promise<unknown> {
    if (!secret) throw new GateError('service-unavailable', 503);
    const signal = AbortSignal.any([session.signal, AbortSignal.timeout(timeout)]);
    try {
      const response = await fetchImpl(`${base}${path}`, {
        method: body === undefined ? 'GET' : 'POST', credentials: 'omit', redirect: 'error', cache: 'no-store',
        headers: { Authorization: `Bearer ${secret}`, 'X-Gate-Id': gateId, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}), signal,
      });
      const value = await boundedJson(response);
      if (!secret || signal.aborted || response.redirected) return invalidResponse();
      if (!response.ok) {
        const data = exact(value, ['admit','code']);
        if (data.admit !== false || typeof data.code !== 'string' || !ERROR_CODES.has(data.code)) return invalidResponse();
        throw new GateError(data.code as GateError['code'], response.status);
      }
      return value;
    } catch (error) {
      if (error instanceof GateError) throw error;
      // A remote error/JSON fragment may contain credentials. Never surface its wording or arbitrary code.
      throw new GateError(signal.aborted && !session.signal.aborted ? 'verification-timeout' : 'service-unavailable', signal.aborted && !session.signal.aborted ? 504 : 503);
    }
  }
  return {
    async health(): Promise<GateHealth> {
      const data = exact(await request('/v1/health'), ['schema','policy','storage','events']);
      if (data.schema !== 'guestlist-gate-health-v1' || data.policy !== 'active-before-redemption-v1' || data.storage !== 'durable-shared' || !Array.isArray(data.events) || !data.events.length || data.events.length > 128) return invalidResponse();
      const events = data.events.map(item => publicEvent(exact(item, ['network','contractAddress','eventId','issuerCommitment'])));
      const keys = new Set(events.map(eventKey));
      if (keys.size !== events.length || new Set(events.map(item => item.network)).size !== 1) return invalidResponse();
      registry = keys;
      return { schema: 'guestlist-gate-health-v1', policy: 'active-before-redemption-v1', storage: 'durable-shared', events };
    },
    async readRedemption(input: ReadRedemptionRequest): Promise<ReadRedemptionResult> {
      const id = publicId(input.requestId), data = exact(await request(`/v1/redemptions/${id}`), ['admit','code','attempt'], ['receipt']);
      if (data.admit !== false || !['pending','expired','claimed'].includes(data.code as string)) return invalidResponse();
      const context = attempt(data.attempt, gateId, id); checkRegistry(context);
      if (contexts.has(id) && !sameRequest(contexts.get(id)!,context)) return invalidResponse();
      if (data.code === 'claimed') {
        if (context.status !== 'claimed' || !Object.hasOwn(data,'receipt')) return invalidResponse();
        const verified = receipt(data.receipt, context, context.txId); remember(context);
        return { admit: false, code: 'claimed', attempt: context, receipt: verified };
      }
      if (Object.hasOwn(data,'receipt') || data.code === 'pending' && !['open','bound'].includes(context.status) || data.code === 'expired' && !['open','expired'].includes(context.status)) return invalidResponse();
      remember(context); return { admit: false, code: data.code as 'pending' | 'expired', attempt: context };
    },
    async openRedemption(input: OpenRedemptionRequest): Promise<OpenRedemptionResult> {
      const publicInput = openRequest({ requestId: input.requestId, network: input.network, contractAddress: input.contractAddress, eventId: input.eventId, issuerCommitment: input.issuerCommitment, commitment: input.commitment });
      const data = exact(await request('/v1/redemptions/open', publicInput), ['admit','code','attempt']);
      if (data.admit !== false || data.code !== 'opened') return invalidResponse();
      const context = attempt(data.attempt, gateId, publicInput.requestId); checkRegistry(context);
      if (context.status !== 'open' || !sameRequest(context,publicInput)) return invalidResponse();
      remember(context); return { admit: false, code: 'opened', attempt: context };
    },
    async claimRedemption(input: ClaimRedemptionRequest): Promise<ClaimRedemptionResult> {
      const id = publicId(input.requestId), candidate = transactionId(input.txId);
      const data = exact(await request('/v1/redemptions/claim', { requestId: id, txId: candidate }), ['admit','code','requestId','receipt']);
      if (data.requestId !== id || data.admit !== true && data.admit !== false ||
          data.admit === true && data.code !== 'admitted' || data.admit === false && data.code !== 'already-claimed') return invalidResponse();
      const verified = receipt(data.receipt, contexts.get(id), candidate);
      checkRegistry({ network: verified.network, contractAddress: verified.contractAddress, eventId: verified.eventId, issuerCommitment: verified.publicState.issuerCommitment });
      return { admit: data.admit, code: data.code as 'admitted' | 'already-claimed', requestId: id, receipt: verified };
    },
    close: () => { secret = undefined; session.abort(); contexts.clear(); registry = undefined; },
  };
}
export type AdmissionClient = ReturnType<typeof createAdmissionClient>;
