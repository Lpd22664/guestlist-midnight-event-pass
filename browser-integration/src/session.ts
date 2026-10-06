import type { InitialAPI, Configuration } from '@midnight-ntwrk/dapp-connector-api';
import { EventPassAdapter, type Authorize } from './adapter.js';
import { connectOwnerSelectedWallet } from './wallet.js';
import { createBrowserProviders, assertNetwork } from './providers.js';
import { openOwnerStorage, type OwnerScope, type StorageApproval } from './owner-storage.js';
import { publicBytes } from './bytes.js';
import type { PublicReceipt } from './receipts.js';
import type { Attempt } from './journal.js';

export interface BrowserSessionOptions {
  scope: OwnerScope;
  /** Owner-selected window.midnight UUID instance. There is no assumed `lace` key. */
  initialApi: InitialAPI;
  compiledAssetsBaseUrl: string;
  /** Existing owner-provisioned key from secure handoff; this library never generates/derives it. */
  encryptionKey: CryptoKey;
  proofDestination: string;
  authorizeConnection: Parameters<typeof connectOwnerSelectedWallet>[2];
  authorizeStorage: (request: StorageApproval) => Promise<boolean>;
  authorizeWalletProver: Parameters<typeof createBrowserProviders>[0]['authorizeWalletProver'];
  authorizeOperation: Authorize;
  timeoutMs?: number;
}
export interface BrowserSession {
  adapter: EventPassAdapter;
  configuration: Configuration;
  /** Public-only durable attempt lookup, including interruptions before submission. */
  readAttempt(requestId: string): Promise<Attempt | null>;
  /** Read-only wallet/network/account guard; closes on disconnect or identity change. */
  checkConnection(): Promise<void>;
  scope: OwnerScope;
  /** Read-only pinned verification. It never retries a network submission. */
  reconcile(requestId: string, recoveredDeploymentAddress?: string): Promise<PublicReceipt | null>;
  /** Close storage and discard this session/key references before switching accounts/networks. */
  close(): void;
}
/** Actual SDK browser factory. Nothing connects, proves or transacts merely by importing it. */
export async function createBrowserSession(options: BrowserSessionOptions): Promise<BrowserSession> {
  if (options.timeoutMs !== undefined && (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0)) throw new Error('Positive operation timeout required before browser setup');
  const storage = await openOwnerStorage({ scope: options.scope, encryptionKey: options.encryptionKey, authorize: options.authorizeStorage });
  try {
    const wallet = await connectOwnerSelectedWallet(options.initialApi, storage.scope.network, options.authorizeConnection);
    const { providers, configuration } = await createBrowserProviders({
      network: storage.scope.network, wallet, compiledAssetsBaseUrl: options.compiledAssetsBaseUrl,
      privateStateProvider: storage.privateStateProvider, proofDestination: options.proofDestination,
      authorizeWalletProver: options.authorizeWalletProver,
    });
    const expectedAddresses = { ...await wallet.getShieldedAddresses() };
    const baselineConfiguration = { ...configuration };
    const adapter = new EventPassAdapter({
      network: storage.scope.network, ownerRole: storage.scope.role, expectedEventId: publicBytes(storage.scope.eventId), providers, compiledAssetsBaseUrl: options.compiledAssetsBaseUrl,
      journal: storage.journal, authorize: options.authorizeOperation, proofDestination: options.proofDestination,
      privateStateId: `${storage.scope.ownerAccountId}:${storage.scope.eventId}:${storage.scope.role}:v1`,
      ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
    });
    let closed = false;
    const close = () => { closed = true; adapter.close(); storage.close(); };
    const checkConnection = async () => {
      if (closed) throw new Error('Owner browser session is closed');
      try {
        assertNetwork(storage.scope.network);
        const [status, currentConfig, currentAddresses] = await Promise.all([wallet.getConnectionStatus(), wallet.getConfiguration(), wallet.getShieldedAddresses()]);
        if (status.status !== 'connected' || status.networkId !== storage.scope.network || currentConfig.networkId !== storage.scope.network ||
          currentAddresses.shieldedCoinPublicKey !== expectedAddresses.shieldedCoinPublicKey || currentAddresses.shieldedEncryptionPublicKey !== expectedAddresses.shieldedEncryptionPublicKey ||
          currentConfig.indexerUri !== baselineConfiguration.indexerUri || currentConfig.indexerWsUri !== baselineConfiguration.indexerWsUri || currentConfig.substrateNodeUri !== baselineConfiguration.substrateNodeUri || currentConfig.proverServerUri !== baselineConfiguration.proverServerUri) throw new Error('Changed session');
      } catch { close(); throw new Error('Wallet disconnected or account/network/services changed. Session locked; preserve and reconcile pending request IDs.'); }
    };
    return { adapter, configuration: Object.freeze({ ...configuration }), scope: storage.scope, readAttempt: id => storage.journal.get(id), checkConnection, reconcile: (id, address) => adapter.reconcile(id, address), close };
  } catch {
    storage.close();
    throw new Error('Owner browser session setup failed; check the approval, wallet/network, local prover and private custody prerequisites');
  }
}
