import { SucceedEntirely, SegmentSuccess, type FinalizedTxData, type PublicDataProvider } from '@midnight-ntwrk/midnight-js-types';
import { ledger, PassStatus } from './generated/contract/index.js';
import { equalBytes, publicHex, publicBytes, publicAddress } from './bytes.js';

export type Network = 'preview' | 'preprod' | 'undeployed';
export type Action = 'deploy' | 'issue' | 'redeem' | 'revoke';
export interface PublicStateSnapshot {
  eventId: string;
  issuerCommitment: string;
  issuedCount: string;
  redeemedCount: string;
  revokedCount: string;
  passStatus?: 'NEVER_ISSUED' | 'ACTIVE' | 'USED' | 'REVOKED';
}
/** No transaction, private state, signing key, or proof preimage is included. */
export interface PublicReceipt {
  schema: 'midnight-event-pass-receipt-v1';
  network: Network;
  action: Action;
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
  commitment?: string;
  publicState: PublicStateSnapshot;
}
export function assertAccepted(data: Pick<FinalizedTxData, 'status' | 'segmentStatusMap'>): void {
  if (data.status !== SucceedEntirely ||
      (data.segmentStatusMap && [...data.segmentStatusMap.values()].some((status) => status !== SegmentSuccess))) {
    throw new Error('Transaction was finalized without complete successful execution; do not admit');
  }
}
export async function readPublicState(
  provider: PublicDataProvider,
  contractAddress: string,
  commitment?: Uint8Array,
  blockHash?: string,
): Promise<PublicStateSnapshot | null> {
  const state = await provider.queryContractState(publicAddress(contractAddress), blockHash ? { type: 'blockHash', blockHash } : undefined);
  if (!state) return null;
  const decoded = ledger(state.data);
  const status = commitment ? (decoded.passes.member(commitment) ? decoded.passes.lookup(commitment) : undefined) : undefined;
  return {
    eventId: publicHex(decoded.eventId),
    issuerCommitment: publicHex(decoded.issuerCommitment),
    issuedCount: decoded.issuedCount.toString(),
    redeemedCount: decoded.redeemedCount.toString(),
    revokedCount: decoded.revokedCount.toString(),
    ...(commitment ? { passStatus: status === undefined ? 'NEVER_ISSUED' : status === PassStatus.ACTIVE ? 'ACTIVE' : status === PassStatus.USED ? 'USED' : 'REVOKED' } : {}),
  };
}
export async function verifyReceipt(
  provider: PublicDataProvider,
  data: FinalizedTxData,
  intent: { network: Network; action: Action; contractAddress: string; eventId: Uint8Array; issuerCommitment: Uint8Array; commitment?: Uint8Array },
): Promise<PublicReceipt> {
  throw new Error('Legacy Node receipt verification is retired; use browser-integration transaction attribution');
}
