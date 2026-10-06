import { GateError, type GateEvent, type OpenRedemptionRequest, type ClaimRedemptionRequest } from './types.js';
export function record(input: unknown, keys: string[]): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
      Object.keys(input).length !== keys.length || keys.some(key => !Object.hasOwn(input, key))) {
    throw new GateError('invalid-request', 400);
  }
  return input as Record<string, unknown>;
}
export function publicHex(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value) || /^0+$/.test(value)) throw new GateError('invalid-request', 400);
  return value;
}
export function transactionId(value: unknown): string {
  // The pinned ledger's genuine tagged transaction identifiers are 33 bytes; synthetic hash fixtures may be 32.
  if (typeof value !== 'string' || !/^(?:[0-9a-f]{64}|[0-9a-f]{66})$/.test(value) || /^0+$/.test(value)) throw new GateError('invalid-request', 400);
  return value;
}
export function blockHash(value: unknown): string {
  if (typeof value !== 'string' || !/^(?:0x)?[0-9a-fA-F]{64}$/.test(value)) throw new GateError('verification-failed', 503);
  return value.replace(/^0x/, '').toLowerCase();
}
export function publicId(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{8,96}$/.test(value)) throw new GateError('invalid-request', 400);
  return value;
}
export function gateId(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(value)) throw new GateError('unauthorized', 401);
  return value;
}
export function event(input: unknown): GateEvent {
  const value = record(input, ['network', 'contractAddress', 'eventId', 'issuerCommitment']);
  if (!['preview', 'preprod', 'undeployed'].includes(value.network as string)) throw new GateError('invalid-request', 400);
  return { network: value.network as GateEvent['network'], contractAddress: publicHex(value.contractAddress), eventId: publicHex(value.eventId), issuerCommitment: publicHex(value.issuerCommitment) };
}
export function openRequest(input: unknown): OpenRedemptionRequest {
  const value = record(input, ['requestId', 'network', 'contractAddress', 'eventId', 'issuerCommitment', 'commitment']);
  return { ...event({ network: value.network, contractAddress: value.contractAddress, eventId: value.eventId, issuerCommitment: value.issuerCommitment }), requestId: publicId(value.requestId), commitment: publicHex(value.commitment) };
}
export function claimRequest(input: unknown): ClaimRedemptionRequest {
  const value = record(input, ['requestId', 'txId']);
  return { requestId: publicId(value.requestId), txId: transactionId(value.txId) };
}
export const eventKey = (value: GateEvent): string => `${value.network}:${value.contractAddress}:${value.eventId}:${value.issuerCommitment}`;
export const admissionKey = (value: OpenRedemptionRequest): string => `${value.network}:${value.contractAddress}:${value.commitment}`;
export function sameRequest(left: OpenRedemptionRequest, right: OpenRedemptionRequest): boolean {
  return left.requestId === right.requestId && admissionKey(left) === admissionKey(right) && eventKey(left) === eventKey(right);
}
