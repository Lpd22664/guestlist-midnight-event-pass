import { ContractState as CompactContractState } from '@midnight-ntwrk/midnight-js-protocol/compact-runtime';
import type { AlignedValue, Op } from '@midnight-ntwrk/midnight-js-protocol/ledger';
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
type ReceiptIntent = { network: Network; action: Action; contractAddress: string; eventId: Uint8Array; issuerCommitment: Uint8Array; commitment?: Uint8Array };
function atom(value: AlignedValue, bytes: Uint8Array, declaredLength: number): boolean {
  if (value.value.length !== 1 || value.alignment.length !== 1) return false;
  const alignment = value.alignment[0];
  return !!alignment && alignment.tag === 'atom' && alignment.value.tag === 'bytes' && alignment.value.length === declaredLength && value.value[0] instanceof Uint8Array && equalBytes(value.value[0], bytes);
}
function exactMapWrite(program: Op<AlignedValue>[], commitment: Uint8Array, status: number, counterField: number): boolean {
  for (let index = 0; index + 7 < program.length; index++) {
    const path = program[index], key = program[index + 1], value = program[index + 2], write = program[index + 3], parent = program[index + 4], counter = program[index + 5], increment = program[index + 6], save = program[index + 7];
    if (!path || typeof path !== 'object' || !('idx' in path) || path.idx.cached || !path.idx.pushPath || path.idx.path.length !== 1) continue;
    const mapField = path.idx.path[0];
    if (!mapField || mapField.tag !== 'value' || !atom(mapField.value, Uint8Array.of(2), 1)) continue;
    if (!key || typeof key !== 'object' || !('push' in key) || key.push.storage || key.push.value.tag !== 'cell' || !atom(key.push.value.content, commitment, 32)) continue;
    if (!value || typeof value !== 'object' || !('push' in value) || !value.push.storage || value.push.value.tag !== 'cell' || !atom(value.push.value.content, status === 0 ? new Uint8Array() : Uint8Array.of(status), 1)) continue;
    if (!write || typeof write !== 'object' || !('ins' in write) || write.ins.cached || write.ins.n !== 1 || !parent || typeof parent !== 'object' || !('ins' in parent) || !parent.ins.cached || parent.ins.n !== 1) continue;
    if (!counter || typeof counter !== 'object' || !('idx' in counter) || counter.idx.cached || !counter.idx.pushPath || counter.idx.path.length !== 1) continue;
    const field = counter.idx.path[0];
    if (!field || field.tag !== 'value' || !atom(field.value, Uint8Array.of(counterField), 1) || !increment || typeof increment !== 'object' || !('addi' in increment) || increment.addi.immediate !== 1 || !save || typeof save !== 'object' || !('ins' in save) || !save.ins.cached || save.ins.n !== 1) continue;
    return true;
  }
  return false;
}
/** Bind the successful finalized transaction to this exact event-pass operation, not merely a later block state. */
export function assertTransactionAttribution(data: FinalizedTxData, intent: ReceiptIntent): void {
  if (!data.tx || !(data.tx.intents instanceof Map) || typeof data.tx.identifiers !== 'function') throw new Error('Finalized public transaction is missing; cannot attribute this receipt');
  const identifiers = data.tx.identifiers();
  if (!identifiers.includes(data.txId)) throw new Error('Finalized public transaction identifier mismatch');
  const address = publicAddress(intent.contractAddress);
  for (const transactionIntent of data.tx.intents.values()) {
    for (const action of transactionIntent.actions) {
      if (action.address !== address) continue;
      if (intent.action === 'deploy') {
        if (!('initialState' in action)) continue;
        const initial = ledger(CompactContractState.deserialize(action.initialState.serialize()).data);
        if (equalBytes(initial.eventId, intent.eventId) && equalBytes(initial.issuerCommitment, intent.issuerCommitment)) return;
      } else {
        if (!('entryPoint' in action) || !intent.commitment) continue;
        const call = action;
        const entry = typeof call.entryPoint === 'string' ? call.entryPoint : new TextDecoder('utf-8', { fatal: true }).decode(call.entryPoint);
        if (entry !== intent.action) continue;
        const status = { issue: 0, redeem: 1, revoke: 2 }[intent.action];
        const counter = { issue: 3, redeem: 4, revoke: 5 }[intent.action];
        if (call.guaranteedTranscript && exactMapWrite(call.guaranteedTranscript.program, intent.commitment, status, counter) || call.fallibleTranscript && exactMapWrite(call.fallibleTranscript.program, intent.commitment, status, counter)) return;
      }
    }
  }
  throw new Error('Finalized transaction does not contain the expected contract/circuit/commitment transition; do not admit');
}
export async function verifyReceipt(
  provider: PublicDataProvider,
  data: FinalizedTxData,
  intent: { network: Network; action: Action; contractAddress: string; eventId: Uint8Array; issuerCommitment: Uint8Array; commitment?: Uint8Array },
): Promise<PublicReceipt> {
  assertAccepted(data);
  assertTransactionAttribution(data, intent);
  if (!data.txId || !data.blockHash || !Number.isSafeInteger(data.blockHeight) || data.blockHeight < 0) {
    throw new Error('Finalized transaction identifiers are incomplete');
  }
  const publicState = await readPublicState(provider, intent.contractAddress, intent.commitment, data.blockHash);
  if (!publicState || !equalBytes(publicBytes(publicState.eventId), intent.eventId) ||
      !equalBytes(publicBytes(publicState.issuerCommitment), intent.issuerCommitment)) {
    throw new Error('Independent public state check failed: wrong event or issuer');
  }
  const expected = { issue: 'ACTIVE', redeem: 'USED', revoke: 'REVOKED' } as const;
  if (intent.action !== 'deploy' && publicState.passStatus !== expected[intent.action]) {
    throw new Error('Finalized receipt does not match the independently queried pass state; do not admit');
  }
  return {
    schema: 'midnight-event-pass-receipt-v1',
    network: intent.network,
    action: intent.action,
    contractAddress: publicAddress(intent.contractAddress),
    txId: data.txId,
    identifiers: [...data.identifiers],
    txHash: data.txHash,
    blockHash: data.blockHash,
    blockHeight: data.blockHeight,
    blockTimestamp: data.blockTimestamp,
    transactionStatus: 'SucceedEntirely',
    stateCheck: 'verified-at-finalized-block',
    eventId: publicHex(intent.eventId),
    ...(intent.commitment ? { commitment: publicHex(intent.commitment) } : {}),
    publicState,
  };
}
