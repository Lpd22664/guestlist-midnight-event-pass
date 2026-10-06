import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { createProofProvider, type PrivateStateProvider, type PublicDataProvider, type MidnightProviders, type WalletProvider, type MidnightProvider, type ProofProvider } from '@midnight-ntwrk/midnight-js-types';
import { setNetworkId, getNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import type { ConnectedAPI, Configuration } from '@midnight-ntwrk/dapp-connector-api';
import type { EventPassCircuit, EventPassPrivateState } from './contract.js';
import { BrowserZkConfigProvider } from './zk-assets.js';
import { connectorWalletProviders } from './wallet.js';
import type { Network } from './receipts.js';

export interface BrowserGuardedEffects {
  proveTx(tx: Parameters<ProofProvider['proveTx']>[0], config: Parameters<ProofProvider['proveTx']>[1], beforeEffect: () => void): ReturnType<ProofProvider['proveTx']>;
  balanceTx(tx: Parameters<WalletProvider['balanceTx']>[0], beforeEffect: () => void): ReturnType<WalletProvider['balanceTx']>;
  submitTx(tx: Parameters<MidnightProvider['submitTx']>[0], beforeEffect: () => void): ReturnType<MidnightProvider['submitTx']>;
}
export type EventPassProviders = MidnightProviders<EventPassCircuit, string, EventPassPrivateState> & { guardedEffects: BrowserGuardedEffects };
export function selectNetwork(network: Network): void {
  if (!['preview', 'preprod', 'undeployed'].includes(network)) throw new Error('Only test networks are supported');
  setNetworkId(network);
}
export function assertNetwork(network: Network): void {
  if (getNetworkId() !== network) throw new Error('Global Midnight.js network changed; use one network per browser realm');
}
export function validateServiceConfiguration(configuration: Configuration, network: Network): Configuration {
  // Do not retain a wallet-owned object as the approved service baseline. A
  // connector fixture or implementation may reuse and mutate the same object.
  const snapshot = { ...configuration };
  if (snapshot.networkId !== network) throw new Error('Wallet service network mismatch');
  for (const [name, value, protocols] of [
    ['indexer', snapshot.indexerUri, ['https:', 'http:']],
    ['indexer WebSocket', snapshot.indexerWsUri, ['wss:', 'ws:']],
    ['node', snapshot.substrateNodeUri, ['https:', 'http:', 'wss:', 'ws:']],
  ] as const) {
    const url = new URL(value);
    if (url.username || url.password || !protocols.some((p) => p === url.protocol)) throw new Error(`Invalid ${name} service URL`);
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (!loopback && ['http:', 'ws:'].includes(url.protocol)) throw new Error('Remote services must use encrypted connections');
  }
  return Object.freeze(snapshot);
}
export function createReadOnlyPublicProvider(network: Network, indexerUri: string, indexerWsUri: string, webSocketImpl: typeof WebSocket = globalThis.WebSocket): PublicDataProvider {
  selectNetwork(network);
  if (!webSocketImpl) throw new Error('A native browser WebSocket implementation is required');
  // Avoid isomorphic-ws namespace defaults that do not expose .WebSocket in browsers.
  return indexerPublicDataProvider(indexerUri, indexerWsUri, webSocketImpl);
}
/** Obtains a real API-4 wallet proving provider only after the host approves its permissions/private destination. */
export async function createBrowserProviders(options: {
  network: Network;
  wallet: ConnectedAPI;
  compiledAssetsBaseUrl: string;
  privateStateProvider: PrivateStateProvider<string, EventPassPrivateState>;
  proofDestination: string;
  authorizeWalletProver: (request: { action: 'use-wallet-prover'; network: Network; proofDestination: string; privatePreimagesLeavePage: true }) => Promise<boolean>;
  webSocketImpl?: typeof WebSocket;
}): Promise<{ providers: EventPassProviders; configuration: Configuration }> {
  if (!options.proofDestination.trim()) throw new Error('Identify the owner-controlled local prover selected in Lace');
  selectNetwork(options.network);
  const configuration = validateServiceConfiguration(await options.wallet.getConfiguration(), options.network);
  const bridge = await connectorWalletProviders(options.wallet, options.network);
  const zkConfigProvider = new BrowserZkConfigProvider(options.compiledAssetsBaseUrl);
  if (!await options.authorizeWalletProver({ action: 'use-wallet-prover', network: options.network, proofDestination: options.proofDestination, privatePreimagesLeavePage: true })) throw new Error('Wallet proving permission was not approved');
  assertNetwork(options.network);
  await bridge.assertOwnerIdentity();
  const provingProvider = await options.wallet.getProvingProvider(zkConfigProvider.asKeyMaterialProvider());
  const checkOwnerServices = async () => {
    await bridge.assertOwnerIdentity();
    const current = validateServiceConfiguration(await options.wallet.getConfiguration(), options.network);
    if (current.indexerUri !== configuration.indexerUri || current.indexerWsUri !== configuration.indexerWsUri || current.substrateNodeUri !== configuration.substrateNodeUri || current.proverServerUri !== configuration.proverServerUri) throw new Error('Wallet services changed; review a new owner-scoped session before proving');
  };
  const proveTxWithGuard: BrowserGuardedEffects['proveTx'] = async (tx, config, guard) => {
    guard(); await checkOwnerServices(); guard();
    // A multi-circuit transaction may call the prover repeatedly. Check before every external call.
    const guardedProver = {
      check: async (...args: Parameters<typeof provingProvider.check>) => { guard(); return provingProvider.check(...args); },
      prove: async (...args: Parameters<typeof provingProvider.prove>) => { guard(); return provingProvider.prove(...args); },
    };
    return createProofProvider(guardedProver).proveTx(tx, config);
  };
  return { configuration, providers: {
    privateStateProvider: options.privateStateProvider,
    publicDataProvider: createReadOnlyPublicProvider(options.network, configuration.indexerUri, configuration.indexerWsUri, options.webSocketImpl),
    zkConfigProvider,
    proofProvider: { proveTx: (tx, config) => proveTxWithGuard(tx, config, () => {}) },
    guardedEffects: { proveTx: proveTxWithGuard, balanceTx: bridge.balanceTxWithGuard, submitTx: bridge.submitTxWithGuard },
    walletProvider: bridge.walletProvider, midnightProvider: bridge.midnightProvider,
  } };
}
