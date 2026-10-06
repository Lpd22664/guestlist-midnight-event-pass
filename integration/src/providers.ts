import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { setNetworkId, getNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import type { MidnightProviders, PrivateStateProvider, MidnightProvider, WalletProvider, PublicDataProvider } from '@midnight-ntwrk/midnight-js-types';
import type { EventPassCircuit, EventPassPrivateState } from './contract.js';
import type { Network } from './receipts.js';

export type EventPassProviders = MidnightProviders<EventPassCircuit, string, EventPassPrivateState>;
export function selectNetwork(network: Network): void {
  if (!['preview', 'preprod', 'undeployed'].includes(network)) throw new Error('Only test networks are supported by this prototype');
  setNetworkId(network);
}
export function assertNetwork(network: Network): void {
  if (getNetworkId() !== network) throw new Error('Global Midnight.js network changed. Use one network per process.');
}
export function createReadOnlyPublicProvider(network: Network, indexerUri: string, indexerWsUri: string): PublicDataProvider {
  selectNetwork(network);
  return indexerPublicDataProvider(indexerUri, indexerWsUri);
}
/** No default wallet, password, account, maintenance key or network endpoint. */
export function createNodeProviders(options: {
  network: Network;
  indexerUri: string;
  indexerWsUri: string;
  trustedProofServerUri: string;
  compiledAssetsPath: string;
  privateStateProvider: PrivateStateProvider<string, EventPassPrivateState>;
  walletProvider: WalletProvider;
  midnightProvider: MidnightProvider;
}): EventPassProviders {
  selectNetwork(options.network);
  const zkConfigProvider = new NodeZkConfigProvider<EventPassCircuit>(options.compiledAssetsPath);
  return {
    privateStateProvider: options.privateStateProvider,
    publicDataProvider: indexerPublicDataProvider(options.indexerUri, options.indexerWsUri),
    zkConfigProvider,
    proofProvider: httpClientProofProvider(options.trustedProofServerUri, zkConfigProvider),
    walletProvider: options.walletProvider,
    midnightProvider: options.midnightProvider,
  };
}
