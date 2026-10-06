import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { ShieldedCoinPublicKey, ShieldedEncryptionPublicKey } from '@midnight-ntwrk/wallet-sdk-address-format';
const cpk = ShieldedCoinPublicKey.codec.encode('preview', ShieldedCoinPublicKey.fromHexString('01'.repeat(32))).asString();
const epk = ShieldedEncryptionPublicKey.codec.encode('preview', ShieldedEncryptionPublicKey.fromHexString('02'.repeat(32))).asString();
// Exercise the browser-built artifact without Node Buffer global. This is NOT a Chromium test.
const originalBuffer = globalThis.Buffer;
const originalProcess = globalThis.process;
try {
  delete globalThis.Buffer;
  delete globalThis.process;
  const sdk = await import('../bundle/event-pass.js');
  const commitment = Array.from(sdk.derivePassCommitment(new Uint8Array(32).fill(1), new Uint8Array(32).fill(3)), b => b.toString(16).padStart(2, '0')).join('');
  assert.equal(commitment, '5185c8debf55209fd26c57deed732812eba45a0081c735acd7d9a73f1ef3a038');
  sdk.selectNetwork('preview');
  const bridge = await sdk.connectorWalletProviders({ getConnectionStatus: async () => ({ status: 'connected', networkId: 'preview' }), getConfiguration: async () => ({ networkId: 'preview' }), getShieldedAddresses: async () => ({ shieldedCoinPublicKey: cpk, shieldedEncryptionPublicKey: epk }) }, 'preview');
  assert.equal(bridge.walletProvider.getCoinPublicKey(), '01'.repeat(32));
  assert.equal(typeof globalThis.Buffer, 'undefined');
  assert.equal(typeof globalThis.process, 'undefined');
  const report = { schema: 'midnight-browser-built-artifact-node-smoke-v2', checkedAt: new Date().toISOString(), checks: ['actual browser-conditioned WASM/ESM imports', 'genuine Compact commitment', 'API4 Bech32m bridge with no global Buffer or process'], browserRuntimeExercised: false, walletConnections: 0, credentialsCreated: 0, proofsGenerated: 0, networkTransactions: 0 };
  await writeFile(new URL('../evidence/bundle-smoke.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} finally { globalThis.Buffer = originalBuffer; globalThis.process = originalProcess; }
