import { CompiledContract } from '@midnight-ntwrk/midnight-js-protocol/compact-js';
import { Contract, pureCircuits, type Witnesses } from './generated/contract/index.js';
import { bytes32 } from './bytes.js';

export type EventPassPrivateState = Readonly<{
  /** Issuer-only private capability. Omit from a bearer-only store. */
  issuerSecret?: Uint8Array;
  /** A single bearer's capability. Never persist on a shared gate server. */
  bearerSecret?: Uint8Array;
}>;
export type EventPassContract = Contract<EventPassPrivateState>;
export type EventPassCircuit = 'issue' | 'redeem' | 'revoke';
export const PRIVATE_STATE_ID = 'event-pass-private-state-v1';
export const witnesses: Witnesses<EventPassPrivateState> = {
  issuerSecret: ({ privateState }) => {
    if (!privateState.issuerSecret) throw new Error('Issuer capability is absent from this private store');
    return [privateState, bytes32(privateState.issuerSecret, 'Issuer secret')];
  },
  bearerSecret: ({ privateState }) => {
    if (!privateState.bearerSecret) throw new Error('Bearer capability is absent from this private store');
    return [privateState, bytes32(privateState.bearerSecret, 'Bearer secret')];
  },
};
export function compiledEventPass(compiledAssetsBaseUrl: string): CompiledContract.CompiledContract<EventPassContract, EventPassPrivateState> {
  if (!compiledAssetsBaseUrl) throw new Error('The full browser compiled assets URL is required');
  const bound = CompiledContract.withWitnesses<EventPassContract, EventPassPrivateState, CompiledContract.CompiledContract.Context<EventPassContract>>(
    CompiledContract.make<EventPassContract>('event-pass', Contract), witnesses,
  );
  return CompiledContract.withCompiledFileAssets<EventPassContract, EventPassPrivateState, { readonly compiledAssetsPath: string }>(bound, compiledAssetsBaseUrl);
}
/** The generated Compact pure circuit, including its real runtime serialization/hash. */
export function derivePassCommitment(eventId: Uint8Array, bearerSecret: Uint8Array): Uint8Array {
  return pureCircuits.derivePassCommitment(bytes32(eventId, 'Event ID'), bytes32(bearerSecret, 'Bearer secret'));
}
export function deriveIssuerCommitment(eventId: Uint8Array, issuerSecret: Uint8Array): Uint8Array {
  return pureCircuits.deriveIssuerCommitment(bytes32(eventId, 'Event ID'), bytes32(issuerSecret, 'Issuer secret'));
}
export function validatePrivateState(state: EventPassPrivateState): EventPassPrivateState {
  return {
    ...(state.issuerSecret ? { issuerSecret: bytes32(state.issuerSecret, 'Issuer secret') } : {}),
    ...(state.bearerSecret ? { bearerSecret: bytes32(state.bearerSecret, 'Bearer secret') } : {}),
  };
}
