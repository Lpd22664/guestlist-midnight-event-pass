import type { PublicReceipt } from './model';

/** Public transport only. Parsing is never event trust, chain verification or admission.
 * Review organiser identity separately and independently verify the chain/verifier keys.
 * No account namespace, endpoint, gate authority or private capability belongs here.
 */
export interface PublicEventManifest {
  network: 'preview';
  contractAddress: string;
  eventId: string;
  issuerCommitment: string;
}
export interface PublicPassRequest extends PublicEventManifest {
  schema: 'guestlist-pass-request-v1';
  commitment: string;
}
export interface PublicCheckInRequest extends PublicEventManifest {
  schema: 'guestlist-check-in-v1';
  commitment: string;
}
export interface PublicGateRequestContext extends PublicEventManifest {
  commitment: string;
  requestId: string;
  expiresAt: number;
  baselineBlockHash: string;
  baselineBlockHeight: number;
}
export interface PublicGateRequest extends PublicGateRequestContext { schema: 'guestlist-gate-request-v1' }
/** A candidate reference to a finalized redemption, not a proof or an entry grant. */
export interface PublicRedemptionReceipt extends PublicGateRequestContext {
  schema: 'guestlist-redemption-receipt-v1';
  txId: string;
}

export const MAX_HANDOFF_BYTES = 4096;
const EVENT_KEYS = ['network', 'contractAddress', 'eventId', 'issuerCommitment'] as const;
const CONTEXT_KEYS = [...EVENT_KEYS, 'commitment', 'requestId', 'expiresAt', 'baselineBlockHash', 'baselineBlockHeight'] as const;
const fail = (): never => { throw new Error('Invalid public Guestlist handoff; check its format and exact Preview event context'); };
const mismatch = (): never => { throw new Error('Public handoff does not match the separately selected event, pass or gate request'); };
const bytes = (value: string) => new TextEncoder().encode(value).byteLength;

/** Flat, bounded JSON only. Reject duplicate (including escaped) keys rather than
 * allowing JSON.parse's last-key-wins behavior at a trust boundary.
 */
function decode(input: unknown): unknown {
  if (typeof input !== 'string') return input;
  if (input.length > MAX_HANDOFF_BYTES || bytes(input) > MAX_HANDOFF_BYTES) return fail();
  let position = 0;
  const whitespace = () => { while (position < input.length && /[\t\r\n ]/.test(input[position])) position++; };
  const token = (pattern: RegExp): string => {
    pattern.lastIndex = position;
    const found = pattern.exec(input);
    if (!found) return fail();
    position = pattern.lastIndex;
    return found[0];
  };
  const string = () => JSON.parse(token(/"(?:[^"\\\u0000-\u001f]|\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4}))*"/y)) as string;
  whitespace(); if (input[position++] !== '{') return fail(); whitespace();
  const result: Record<string, unknown> = Object.create(null);
  if (input[position] !== '}') {
    for (;;) {
      const key = string(); if (Object.hasOwn(result, key)) return fail();
      whitespace(); if (input[position++] !== ':') return fail(); whitespace();
      result[key] = input[position] === '"' ? string() : Number(token(/-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/y));
      whitespace();
      if (input[position] !== ',') break;
      position++; whitespace();
    }
  }
  if (input[position++] !== '}') return fail(); whitespace();
  if (position !== input.length) return fail();
  return result;
}
function exact(input: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return fail();
  const prototype = Object.getPrototypeOf(input);
  if (prototype !== Object.prototype && prototype !== null) return fail();
  const own = Reflect.ownKeys(input);
  if (own.length !== keys.length || own.some(key => typeof key !== 'string' || !keys.includes(key))) return fail();
  const output: Record<string, unknown> = Object.create(null);
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) return fail();
    output[key] = descriptor.value;
  }
  return output;
}
function hex(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value) || /^0+$/.test(value)) return fail();
  return value;
}
function transactionId(value: unknown): string {
  if (typeof value !== 'string' || !/^(?:[0-9a-f]{64}|[0-9a-f]{66})$/.test(value) || /^0+$/.test(value)) return fail();
  return value;
}
function integer(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || Object.is(value, -0)) return fail();
  return value;
}
function identity(value: Record<string, unknown>): PublicEventManifest {
  if (value.network !== 'preview') return fail();
  return { network: 'preview', contractAddress: hex(value.contractAddress), eventId: hex(value.eventId), issuerCommitment: hex(value.issuerCommitment) };
}
function sameEvent(actual: PublicEventManifest, expected: PublicEventManifest): void {
  const checked = parsePublicEventManifest(expected);
  if (EVENT_KEYS.some(key => actual[key] !== checked[key])) mismatch();
}
export function parsePublicEventManifest(input: unknown): PublicEventManifest {
  return identity(exact(decode(input), EVENT_KEYS));
}
export function encodePublicEventManifest(input: PublicEventManifest): string {
  return JSON.stringify(parsePublicEventManifest(input));
}

function safeAppUrl(input: string): URL {
  if (typeof input !== 'string' || input.length > MAX_HANDOFF_BYTES || bytes(input) > MAX_HANDOFF_BYTES || !/^https?:\/\//.test(input) || /[\u0000-\u0020\u007f\\]/.test(input)) return fail();
  let url: URL; try { url = new URL(input); } catch { return fail(); }
  // Literal ? is also forbidden: URL.search is empty for a trailing question mark.
  if (input.includes('?') || url.username || url.password ||
      url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) return fail();
  // Do not accept URL parser aliases such as 127.1 or an octal IPv4 address as
  // the explicit loopback exception. Remote app links always require HTTPS.
  const authority = /^https?:\/\/([^/#]+)/.exec(input)?.[1];
  if (url.protocol === 'http:' && (!authority || !/^(?:localhost|127\.0\.0\.1|\[::1\])(?::[0-9]{1,5})?$/.test(authority))) return fail();
  return url;
}
/** Fragment transport avoids sending event identity in the HTTP request/query. */
export function buildEventLink(baseUrl: string, event: PublicEventManifest): string {
  const url = safeAppUrl(baseUrl);
  if (url.hash || baseUrl.includes('#')) return fail();
  url.hash = `event=${encodeURIComponent(encodePublicEventManifest(event))}`;
  if (bytes(url.href) > MAX_HANDOFF_BYTES) return fail();
  return url.href;
}
export function parseEventLink(link: string): PublicEventManifest {
  const url = safeAppUrl(link);
  if (!url.hash.startsWith('#event=') || /[&#]/.test(url.hash.slice(1))) return fail();
  try { return parsePublicEventManifest(decodeURIComponent(url.hash.slice('#event='.length))); }
  catch { return fail(); }
}

function pass(input: unknown, schema: PublicPassRequest['schema'] | PublicCheckInRequest['schema'], event: PublicEventManifest) {
  const value = exact(decode(input), ['schema', ...EVENT_KEYS, 'commitment']);
  if (value.schema !== schema) return fail();
  const result = { schema, ...identity(value), commitment: hex(value.commitment) };
  sameEvent(result, event);
  return result;
}
export function encodePassRequest(event: PublicEventManifest, commitment: string): string {
  return JSON.stringify({ schema: 'guestlist-pass-request-v1', ...parsePublicEventManifest(event), commitment: hex(commitment) });
}
export function parsePassRequest(input: unknown, expectedEvent: PublicEventManifest): PublicPassRequest {
  return pass(input, 'guestlist-pass-request-v1', expectedEvent) as PublicPassRequest;
}
export function encodeCheckInRequest(event: PublicEventManifest, commitment: string): string {
  return JSON.stringify({ schema: 'guestlist-check-in-v1', ...parsePublicEventManifest(event), commitment: hex(commitment) });
}
export function parseCheckInRequest(input: unknown, expectedEvent: PublicEventManifest): PublicCheckInRequest {
  return pass(input, 'guestlist-check-in-v1', expectedEvent) as PublicCheckInRequest;
}
function context(value: Record<string, unknown>): PublicGateRequestContext {
  if (typeof value.requestId !== 'string' || !/^[A-Za-z0-9_-]{8,96}$/.test(value.requestId)) return fail();
  const expiresAt = integer(value.expiresAt); if (!expiresAt) return fail();
  return { ...identity(value), commitment: hex(value.commitment), requestId: value.requestId, expiresAt,
    baselineBlockHash: hex(value.baselineBlockHash), baselineBlockHeight: integer(value.baselineBlockHeight) };
}
function checkedContext(input: PublicGateRequestContext): PublicGateRequestContext {
  // A previously parsed gate request can be passed directly, but no local status,
  // authority, arbitrary receipt or private extras can be serialized accidentally.
  const withSchema = Object.hasOwn(input, 'schema');
  const value = exact(input, withSchema ? ['schema', ...CONTEXT_KEYS] : CONTEXT_KEYS);
  if (withSchema && value.schema !== 'guestlist-gate-request-v1') return fail();
  return context(value);
}
function unexpired(value: PublicGateRequestContext, now: number): void {
  if (value.expiresAt <= integer(now)) throw new Error('Gate request expired; ask the gate to review the existing attempt before continuing');
  // The existing authenticated gate service permits at most a 15-minute lifetime.
  if (value.expiresAt - now > 900_000) return fail();
}
export function encodeGateRequest(input: PublicGateRequestContext, now = Date.now()): string {
  const value = checkedContext(input); unexpired(value, now);
  return JSON.stringify({ schema: 'guestlist-gate-request-v1', ...value });
}
/** Restore exact public correlation for historical receipts/read-only recovery.
 * Deliberately does not authorize new redemption, sharing an active request or
 * admission. Re-run parseGateRequest with the current clock before any new action.
 */
export function parsePreservedGateRequest(input: unknown, expectedEvent: PublicEventManifest, expectedCommitment: string): PublicGateRequest {
  const value = exact(decode(input), ['schema', ...CONTEXT_KEYS]);
  if (value.schema !== 'guestlist-gate-request-v1') return fail();
  const result: PublicGateRequest = { schema: 'guestlist-gate-request-v1', ...context(value) };
  sameEvent(result, expectedEvent);
  if (result.commitment !== hex(expectedCommitment)) mismatch();
  return result;
}
export function parseGateRequest(input: unknown, expectedEvent: PublicEventManifest, expectedCommitment: string, now = Date.now()): PublicGateRequest {
  const result = parsePreservedGateRequest(input, expectedEvent, expectedCommitment);
  unexpired(result, now);
  return result;
}

/** Only build from an already independently verified redeem receipt. Structural
 * checks prevent accidental unrelated/non-final serialization; they cannot prove
 * finality themselves. The gate must independently verify and durably claim once.
 */
export function encodeRedemptionReceipt(input: PublicGateRequestContext, receipt: PublicReceipt): string {
  const expected = checkedContext(input);
  const r = exact(receipt, ['schema', 'network', 'action', 'contractAddress', 'txId', 'identifiers', 'txHash', 'blockHash', 'blockHeight', 'blockTimestamp', 'transactionStatus', 'stateCheck', 'eventId', 'commitment', 'publicState']);
  const state = exact(r.publicState, ['eventId', 'issuerCommitment', 'issuedCount', 'redeemedCount', 'revokedCount', 'passStatus']);
  if (r.schema !== 'midnight-event-pass-receipt-v1' || r.action !== 'redeem' || r.transactionStatus !== 'SucceedEntirely' || r.stateCheck !== 'verified-at-finalized-block' || state.passStatus !== 'USED') return fail();
  sameEvent(identity({ ...r, issuerCommitment: state.issuerCommitment }), identity(expected as unknown as Record<string, unknown>));
  if (state.eventId !== expected.eventId || hex(r.commitment) !== expected.commitment || integer(r.blockHeight) <= expected.baselineBlockHeight) mismatch();
  integer(r.blockTimestamp); hex(r.txHash); hex(r.blockHash);
  if ([state.issuedCount, state.redeemedCount, state.revokedCount].some(value => typeof value !== 'string' || !/^(?:0|[1-9][0-9]{0,38})$/.test(value))) return fail();
  const txId = transactionId(r.txId);
  if (!Array.isArray(r.identifiers) || !r.identifiers.length || r.identifiers.length > 256 ||
      r.identifiers.some(value => transactionId(value) !== value) || !r.identifiers.includes(txId) || new Set(r.identifiers).size !== r.identifiers.length) return fail();
  return JSON.stringify({ schema: 'guestlist-redemption-receipt-v1', ...expected, txId });
}
/** Expiry does not invalidate a historical receipt reference. Exact preserved
 * request context is mandatory; this never grants admission or reopens a request.
 */
export function parseRedemptionReceipt(input: unknown, expectedContext: PublicGateRequestContext): PublicRedemptionReceipt {
  const value = exact(decode(input), ['schema', ...CONTEXT_KEYS, 'txId']);
  if (value.schema !== 'guestlist-redemption-receipt-v1') return fail();
  const result: PublicRedemptionReceipt = { schema: 'guestlist-redemption-receipt-v1', ...context(value), txId: transactionId(value.txId) };
  const expected = checkedContext(expectedContext);
  if (CONTEXT_KEYS.some(key => result[key] !== expected[key])) mismatch();
  return result;
}
