import type { ConnectedAPI, InitialAPI } from '@midnight-ntwrk/dapp-connector-api';
import { MidnightBech32m, ShieldedCoinPublicKey, ShieldedEncryptionPublicKey } from '@midnight-ntwrk/wallet-sdk-address-format';
import { Transaction } from '@midnight-ntwrk/midnight-js-protocol/ledger';
import type { WalletProvider, MidnightProvider } from '@midnight-ntwrk/midnight-js-types';
import { selectNetwork, assertNetwork } from './providers.js';
import { publicHex, transactionBytes } from './bytes.js';
import type { Network } from './receipts.js';

export function discoverWallets(injected: Record<string, InitialAPI> | undefined): Array<{ id: string; api: InitialAPI }> {
  // UUID keys are not a fixed wallet name. Render names/icons safely; require user selection.
  return injected ? Object.entries(injected).map(([id, api]) => ({ id, api })) : [];
}
export async function connectOwnerSelectedWallet(api: InitialAPI, network: Network,
  authorizeConnection: (wallet: { name: string; rdns: string; network: Network }) => Promise<boolean>,
): Promise<ConnectedAPI> {
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
export async function connectorWalletProviders(wallet: ConnectedAPI, network: Network): Promise<{ walletProvider: WalletProvider; midnightProvider: MidnightProvider; balanceTxWithGuard: (tx: Parameters<WalletProvider['balanceTx']>[0], guard: () => void) => ReturnType<WalletProvider['balanceTx']>; submitTxWithGuard: (tx: Parameters<MidnightProvider['submitTx']>[0], guard: () => void) => ReturnType<MidnightProvider['submitTx']>; assertOwnerIdentity: () => Promise<void> }> {
  await assertWalletNetwork(wallet, network);
  const addresses = await wallet.getShieldedAddresses();
  const coinPublicKey = ShieldedCoinPublicKey.codec.decode(network, MidnightBech32m.parse(addresses.shieldedCoinPublicKey)).toHexString();
  const encryptionPublicKey = ShieldedEncryptionPublicKey.codec.decode(network, MidnightBech32m.parse(addresses.shieldedEncryptionPublicKey)).toHexString();
  const expectedKeys = [addresses.shieldedCoinPublicKey, addresses.shieldedEncryptionPublicKey];
  const checkIdentity = async () => {
    await assertWalletNetwork(wallet, network);
    const current = await wallet.getShieldedAddresses();
    if (current.shieldedCoinPublicKey !== expectedKeys[0] || current.shieldedEncryptionPublicKey !== expectedKeys[1]) throw new Error('Wallet account changed; close this owner-scoped session');
  };
  const balanceTxWithGuard = async (tx: Parameters<WalletProvider['balanceTx']>[0], guard: () => void): ReturnType<WalletProvider['balanceTx']> => {
    guard(); await checkIdentity(); guard();
    const serialized = publicHex(tx.serialize());
    guard(); const balanced = await wallet.balanceUnsealedTransaction(serialized);
    guard(); return Transaction.deserialize('signature', 'proof', 'binding', transactionBytes(balanced.tx));
  };
  const submitTxWithGuard = async (tx: Parameters<MidnightProvider['submitTx']>[0], guard: () => void): ReturnType<MidnightProvider['submitTx']> => {
    guard(); await checkIdentity(); guard();
    const identifier = tx.identifiers()[0];
    if (!identifier) throw new Error('Finalized transaction has no identifier');
    const serialized = publicHex(tx.serialize());
    guard(); await wallet.submitTransaction(serialized);
    return identifier;
  };
  return {
    assertOwnerIdentity: checkIdentity, balanceTxWithGuard, submitTxWithGuard,
    walletProvider: { getCoinPublicKey: () => coinPublicKey, getEncryptionPublicKey: () => encryptionPublicKey,
      balanceTx: tx => balanceTxWithGuard(tx, () => {}) },
    midnightProvider: { submitTx: tx => submitTxWithGuard(tx, () => {}) },
  };
}
