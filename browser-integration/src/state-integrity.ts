import { ContractState } from '@midnight-ntwrk/midnight-js-protocol/compact-runtime';
import { verifyContractState } from '@midnight-ntwrk/midnight-js-contracts';
import type { PublicDataProvider } from '@midnight-ntwrk/midnight-js-types';
import { BrowserZkConfigProvider } from './zk-assets.js';

export type PublicContractState = NonNullable<Awaited<ReturnType<PublicDataProvider['queryContractState']>>>;
/** The gate reuses the pinned runtime and public verifier-key integrity boundary.
 * This contains no wallet, proving, signing, submission or private-state access. */
export function deserializePublicContractState(hex: string): PublicContractState {
  if (typeof hex !== 'string' || !/^(?:[0-9a-fA-F]{2})+$/.test(hex)) throw new Error('Invalid public contract state encoding');
  return ContractState.deserialize(Uint8Array.from(hex.match(/../g)!, pair => Number.parseInt(pair, 16)));
}
export function createPinnedStateVerifier(assets: BrowserZkConfigProvider): (state: PublicContractState) => Promise<void> {
  let keys: ReturnType<BrowserZkConfigProvider['getVerifierKeys']> | undefined;
  return async state => {
    // Immutable build-pinned keys may be shared, but a failed load can be retried.
    const pending = keys ??= assets.getVerifierKeys(['issue', 'redeem', 'revoke']);
    try {
      const loaded = await pending;
      const expected = 'issue,redeem,revoke';
      if (loaded.map(([name]) => name).sort().join(',') !== expected) throw new Error('Incomplete pinned verifier keys');
      const operations = state.operations().map(name => typeof name === 'string' ? name : new TextDecoder('utf-8', { fatal: true }).decode(name));
      if (operations.sort().join(',') !== expected) throw new Error('Unexpected contract operations');
      verifyContractState(loaded, state);
    }
    catch (error) { if (keys === pending) keys = undefined; throw error; }
  };
}
