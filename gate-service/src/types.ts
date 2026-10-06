/** Browser-safe public-only wire types. Importing this module never imports Node or a wallet. */
export type GateNetwork = 'preview' | 'preprod' | 'undeployed';
export interface GateEvent {
  network: GateNetwork;
  contractAddress: string;
  eventId: string;
  issuerCommitment: string;
}
export interface OpenRedemptionRequest extends GateEvent {
  requestId: string;
  commitment: string;
}
export interface ClaimRedemptionRequest { requestId: string; txId: string }
export interface GateReceipt {
  schema: 'midnight-event-pass-receipt-v1';
  network: GateNetwork;
  action: 'redeem';
  contractAddress: string;
  txId: string;
  identifiers: string[];
  txHash: string;
  blockHash: string;
  blockHeight: number;
  blockTimestamp: number;
  transactionStatus: 'SucceedEntirely';
  stateCheck: 'verified-at-finalized-block';
  eventId: string;
  commitment: string;
  publicState: {
    eventId: string; issuerCommitment: string;
    issuedCount: string; redeemedCount: string; revokedCount: string;
    passStatus: 'USED';
  };
}
export interface GateAttempt extends OpenRedemptionRequest {
  gateId: string;
  openedAt: number;
  expiresAt: number;
  baselineBlockHash: string;
  baselineBlockHeight: number;
  status: 'open' | 'bound' | 'claimed' | 'expired';
  txId?: string;
}
export interface OpenRedemptionResult { code: 'opened'; admit: false; attempt: GateAttempt }
export interface ClaimRedemptionResult {
  code: 'admitted' | 'already-claimed';
  admit: boolean;
  requestId: string;
  receipt: GateReceipt;
}
export interface ReadRedemptionRequest { requestId: string }
export interface ReadRedemptionResult {
  admit: false;
  code: 'pending' | 'claimed' | 'expired';
  attempt: GateAttempt;
  receipt?: GateReceipt;
}
export interface GateHealth {
  schema: 'guestlist-gate-health-v1';
  policy: 'active-before-redemption-v1';
  storage: 'durable-shared';
  events: GateEvent[];
}
export type GateErrorCode = 'invalid-request' | 'unauthorized' | 'event-not-configured' |
  'not-active' | 'attempt-conflict' | 'attempt-not-found' | 'attempt-expired' |
  'transaction-conflict' | 'verification-failed' | 'verification-timeout' |
  'verification-capacity' | 'storage-unavailable' | 'service-unavailable';
export class GateError extends Error {
  constructor(readonly code: GateErrorCode, readonly status: number, message = code) {
    super(message); this.name = 'GateError';
  }
}
