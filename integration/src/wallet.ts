import type { ConnectedAPI, InitialAPI } from '@midnight-ntwrk/dapp-connector-api';
import { MidnightBech32m, ShieldedCoinPublicKey, ShieldedEncryptionPublicKey } from '@midnight-ntwrk/wallet-sdk-address-format';
import { Transaction } from '@midnight-ntwrk/midnight-js-protocol/ledger';
import type { WalletProvider, MidnightProvider } from '@midnight-ntwrk/midnight-js-types';
import { selectNetwork, assertNetwork } from './providers.js';
import type { Network } from './receipts.js';

export function discoverWallets(injected: Record<string, InitialAPI> | undefined): Array<{ id: string; api: InitialAPI }> {
  // UUID keys are not a fixed wallet name. Render names/icons safely; require user selection.
  return injected ? Object.entries(injected).map(([id, api]) => ({ id, api })) : [];
}
export async function connectOwnerSelectedWallet(api: InitialAPI, network: Network,
  authorizeConnection: (wallet: { name: string; rdns: string; network: Network }) => Promise<boolean>,
): Promise<ConnectedAPI> {
  throw new Error('Legacy Node wallet integration is retired; use browser-integration API-4 providers');
  if (!/^4\./.test(api.apiVersion)) throw new Error('A DApp Connector API 4.x wallet is required');
  if (!await authorizeConnection({ name: api.name, rdns: api.rdns, network })) throw new Error('Owner wallet connection approval was not granted');
  selectNetwork(network);
  const connected = await api.connect(network);
  await assertWalletNetwork(connected, network);
  return connected;
}
async function assertWalletNetwork(wallet: ConnectedAPI, network: Network): Promise<void> {
  assertNetwork(network);
  const status = await wallet.getConnectionStatus();
  const configuration = await wallet.getConfiguration();
  if (status.status !== 'connected' || status.networkId !== network || configuration.networkId !== network) {
    throw new Error('Wallet is disconnected or connected to a different network');
  }
}
/** Create providers only after the owner connects a chosen wallet. No seed or keys are created. */
export async function connectorWalletProviders(wallet: ConnectedAPI, network: Network): Promise<{ walletProvider: WalletProvider; midnightProvider: MidnightProvider }> {
  throw new Error('Legacy Node wallet integration is retired; use browser-integration API-4 providers');
  await assertWalletNetwork(wallet, network);
  const addresses = await wallet.getShieldedAddresses();
  const coinPublicKey = ShieldedCoinPublicKey.codec.decode(network, MidnightBech32m.parse(addresses.shieldedCoinPublicKey)).toHexString();
  const encryptionPublicKey = ShieldedEncryptionPublicKey.codec.decode(network, MidnightBech32m.parse(addresses.shieldedEncryptionPublicKey)).toHexString();
  return {
    walletProvider: {
      getCoinPublicKey: () => coinPublicKey,
      getEncryptionPublicKey: () => encryptionPublicKey,
      balanceTx: async (tx) => {
        await assertWalletNetwork(wallet, network);
        const balanced = await wallet.balanceUnsealedTransaction(Buffer.from(tx.serialize()).toString('hex'));
        return Transaction.deserialize('signature', 'proof', 'binding', Buffer.from(balanced.tx, 'hex'));
      },
    },
    midnightProvider: {
      submitTx: async (tx) => {
        await assertWalletNetwork(wallet, network);
        const identifier = tx.identifiers()[0];
        if (!identifier) throw new Error('Finalized transaction has no identifier');
        await wallet.submitTransaction(Buffer.from(tx.serialize()).toString('hex'));
        return identifier;
      },
    },
  };
}
