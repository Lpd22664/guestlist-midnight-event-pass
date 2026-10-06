import type { BrowserSession, PublicReceipt, PublicStateSnapshot, LiveEventIdentity } from '../../browser-integration/dist/index.js';
export type { BrowserSession, PublicReceipt, PublicStateSnapshot, LiveEventIdentity };
export type Sdk = typeof import('../../browser-integration/dist/index.js');
export type WalletApi = Parameters<Sdk['connectOwnerSelectedWallet']>[0];
export type Role = 'issuer' | 'bearer';
export interface TrustedEvent extends LiveEventIdentity {
  network: 'preview';
  issuerCommitment: string;
  trust: 'owner-reviewed' | 'finalized-deployment';
  deploymentReceipt?: PublicReceipt;
}
export interface Custody {
  role: Role;
  ownerAccountId: string;
  eventId: string;
  encryptionKey: CryptoKey;
  capability: Uint8Array;
  maintenanceSigningKey?: string;
}
export interface PublicAttempt {
  requestId: string;
  action: 'deploy' | 'issue' | 'revoke' | 'redeem';
  ownerAccountId: string;
  eventId: string;
  role: Role;
  commitment?: string;
  status: 'pending' | 'unknown' | 'rejected' | 'verified';
  receipt?: PublicReceipt;
}
export interface GateContext { requestId: string; network: 'preview'; contractAddress: string; eventId: string; issuerCommitment: string; commitment: string; baselineBlockHash?: string; baselineBlockHeight?: number; expiresAt?: number; txId?: string; status: 'opening' | 'open' | 'claiming' | 'unknown' | 'closed'; }
export const PUBLIC_GATE_STORAGE_KEY = 'guestlist.midnight-preview.gate-public.v1';
export interface LiveView {
  loaded: boolean;
  busy: boolean;
  connected: boolean;
  joined: boolean;
  role?: Role;
  custodyReady: boolean;
  event?: TrustedEvent;
  state?: PublicStateSnapshot;
  chain?: { nodeVersion: string; finalizedBlockHash: string; finalizedBlockHeight: number; checkedAt: string };
  attempts: PublicAttempt[];
  message: string;
  error: string;
  credential?: string;
  commitment?: string;
  gateContext?: GateContext;
  admission?: { admit: boolean; requestId: string; code?: string };
}
export const PUBLIC_EVENT_STORAGE_KEY = 'guestlist.midnight-preview.trusted-event.v1';
export const PUBLIC_STORAGE_KEY = 'guestlist.midnight-preview.public.v1';
export const HEX32 = /^[0-9a-f]{64}$/;
export function publicHex32(value: string, name = 'Public value'): string {
  if (!HEX32.test(value) || /^0+$/.test(value)) throw new Error(`${name} must be 64 lowercase hexadecimal characters and nonzero`);
  return value;
}
export function bytesFromHex(value: string): Uint8Array {
  publicHex32(value);
  return Uint8Array.from(value.match(/../g)!, byte => parseInt(byte, 16));
}
export function hexFromBytes(value: Uint8Array): string { return Array.from(value, byte => byte.toString(16).padStart(2, '0')).join(''); }
export function ownerId(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(value)) throw new Error('Use a nonsecret owner/account identifier with letters, numbers, dots, colons or dashes');
  return value;
}
export function trustedEvent(input: unknown): TrustedEvent {
  if (!input || typeof input !== 'object') throw new Error('A public event manifest is required');
  const v = input as Record<string, unknown>;
  if (v.network !== 'preview' || typeof v.contractAddress !== 'string' || typeof v.eventId !== 'string' || typeof v.issuerCommitment !== 'string') throw new Error('Expected a trusted Preview event manifest');
  return { network: 'preview', contractAddress: publicHex32(v.contractAddress.toLowerCase(), 'Contract address'), eventId: publicHex32(v.eventId, 'Event ID'), issuerCommitment: publicHex32(v.issuerCommitment, 'Issuer commitment'), trust: 'owner-reviewed' };
}
export function isUnresolved(attempt: PublicAttempt): boolean { return attempt.status === 'pending' || attempt.status === 'unknown'; }
export function receiptIsFinal(receipt: PublicReceipt, attempt: PublicAttempt, event?: TrustedEvent): boolean {
  return receipt.schema === 'midnight-event-pass-receipt-v1' && receipt.network === 'preview' &&
    receipt.action === attempt.action && receipt.eventId === attempt.eventId && receipt.commitment === attempt.commitment &&
    receipt.transactionStatus === 'SucceedEntirely' && receipt.stateCheck === 'verified-at-finalized-block' &&
    Boolean(receipt.txId && receipt.txHash && receipt.blockHash) && Number.isSafeInteger(receipt.blockHeight) &&
    receipt.publicState.eventId === attempt.eventId && (!event || receipt.contractAddress === event.contractAddress && receipt.publicState.issuerCommitment === event.issuerCommitment);
}
/** Deliberately copy an exact public allowlist. No capabilities, labels or arbitrary SDK errors can be persisted. */
export function publicAttemptCopy(attempt: PublicAttempt): PublicAttempt {
  const copy: PublicAttempt = { requestId: ownerId(attempt.requestId), action: attempt.action, ownerAccountId: ownerId(attempt.ownerAccountId), eventId: publicHex32(attempt.eventId), role: attempt.role, status: attempt.status };
  if (!['deploy', 'issue', 'revoke', 'redeem'].includes(copy.action) || !['issuer', 'bearer'].includes(copy.role) || !['pending', 'unknown', 'rejected', 'verified'].includes(copy.status)) throw new Error('Invalid public attempt');
  if (attempt.commitment) copy.commitment = publicHex32(attempt.commitment, 'Commitment');
  if (attempt.receipt) {
    if (!receiptIsFinal(attempt.receipt, attempt)) throw new Error('Unverified receipt cannot be persisted as success');
    const r = attempt.receipt;
    copy.receipt = { schema: r.schema, network: r.network, action: r.action, contractAddress: r.contractAddress, txId: r.txId, identifiers: [...r.identifiers], txHash: r.txHash, blockHash: r.blockHash, blockHeight: r.blockHeight, blockTimestamp: r.blockTimestamp, transactionStatus: r.transactionStatus, stateCheck: r.stateCheck, eventId: r.eventId, ...(r.commitment ? { commitment: r.commitment } : {}), publicState: { eventId: r.publicState.eventId, issuerCommitment: r.publicState.issuerCommitment, issuedCount: r.publicState.issuedCount, redeemedCount: r.publicState.redeemedCount, revokedCount: r.publicState.revokedCount, ...(r.publicState.passStatus ? { passStatus: r.publicState.passStatus } : {}) } };
  }
  if (copy.status === 'verified' && !copy.receipt) throw new Error('Missing final receipt');
  return copy;
}
export function loadPublicAttempts(storage: Pick<Storage, 'getItem'>): PublicAttempt[] {
  const raw = storage.getItem(PUBLIC_STORAGE_KEY);
  if (!raw) return [];
  const value: unknown = JSON.parse(raw);
  if (!Array.isArray(value) || value.length > 10000) throw new Error('Invalid public request history; keep the SDK journal and reconcile');
  return value.map(attempt => publicAttemptCopy(attempt as PublicAttempt));
}

export function gateContextCopy(input: unknown): GateContext {
  if (!input || typeof input !== 'object') throw new Error('Invalid public gate context');
  const c = input as GateContext;
  const event = trustedEvent(c);
  if (!['opening','open','claiming','unknown','closed'].includes(c.status)) throw new Error('Invalid gate status');
  return { requestId: ownerId(c.requestId), network: 'preview', contractAddress: event.contractAddress, eventId: event.eventId, issuerCommitment: event.issuerCommitment, commitment: publicHex32(c.commitment), status: c.status,
    ...(typeof c.txId === 'string' && c.txId.length <= 512 && !/\s/.test(c.txId) ? { txId: c.txId } : {}),
    ...(typeof c.baselineBlockHash === 'string' ? { baselineBlockHash: c.baselineBlockHash } : {}),
    ...(Number.isSafeInteger(c.baselineBlockHeight) ? { baselineBlockHeight: c.baselineBlockHeight } : {}),
    ...(Number.isFinite(c.expiresAt) ? { expiresAt: c.expiresAt } : {}) };
}

/** Public owner-reviewed registry. It does not unlock custody or establish live readiness on reload. */
export function eventRegistryCopy(input: unknown): TrustedEvent {
  const event = trustedEvent(input);
  const value = input as TrustedEvent;
  if (value.trust === 'finalized-deployment') {
    const receipt = value.deploymentReceipt;
    const attempt: PublicAttempt = { requestId: 'public-deployment-registry', action: 'deploy', ownerAccountId: 'public-registry', eventId: event.eventId, role: 'issuer', status: 'pending' };
    if (!receipt || !receiptIsFinal(receipt, attempt, event)) throw new Error('Missing verified public deployment evidence');
    return { ...event, trust: 'finalized-deployment', deploymentReceipt: publicAttemptCopy({ ...attempt, status: 'verified', receipt }).receipt };
  }
  return event;
}
