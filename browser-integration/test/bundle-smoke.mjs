import assert from 'node:assert/strict';
import { Buffer as HostBuffer } from 'node:buffer';
import { readFile, writeFile } from 'node:fs/promises';
import { ShieldedCoinPublicKey, ShieldedEncryptionPublicKey } from '@midnight-ntwrk/wallet-sdk-address-format';
const cpk = ShieldedCoinPublicKey.codec.encode('preview', ShieldedCoinPublicKey.fromHexString('01'.repeat(32))).asString();
const epk = ShieldedEncryptionPublicKey.codec.encode('preview', ShieldedEncryptionPublicKey.fromHexString('02'.repeat(32))).asString();
// Node lazily exposes these browser constructors through Undici. Resolve their
// host getters before removing Node globals; bundle initialization reads them.
// No constructor/fetch is invoked and no SDK code runs until both globals vanish.
const browserConstructors = ['Headers', 'Request', 'Response', 'FormData', 'WebSocket'];
for (const name of browserConstructors) assert.equal(typeof globalThis[name], 'function');
// Node's native fetch lazily loads Undici, which needs Node globals. This fixture
// serves only the two WASM data URLs embedded in this exact browser artifact.
// Its module-local host Buffer never becomes an SDK/global polyfill. The pinned
// vite-plugin-wasm helper uses arrayBuffer + real WebAssembly.instantiate for
// non-WASM MIME types, as browsers do when a server omits application/wasm.
const artifact = await readFile(new URL('../bundle/event-pass.js', import.meta.url), 'utf8');
const wasmUrls = [...new Set(Array.from(artifact.matchAll(/"(data:application\/wasm;base64,[A-Za-z0-9+/]+={0,2})"/g), match => match[1]))];
assert.equal(wasmUrls.length, 2, 'expected the pinned onchain and ledger WASM assets');
const wasmBodies = new Map(wasmUrls.map(url => {
  assert.ok(url.length <= 16 * 1024 * 1024, 'bounded embedded WASM data URL');
  const bytes = Uint8Array.from(HostBuffer.from(url.slice(url.indexOf(',') + 1), 'base64'));
  assert.ok(bytes.length <= 12 * 1024 * 1024, 'bounded decoded WASM body');
  assert.deepEqual(Array.from(bytes.subarray(0, 8)), [0, 97, 115, 109, 1, 0, 0, 0]);
  return [url, bytes];
}));
let wasmFetches = 0;
const assertNoNodeGlobals = () => {
  assert.equal(typeof globalThis.Buffer, 'undefined');
  assert.equal(typeof globalThis.process, 'undefined');
};
const offlineWasmFetch = async (url, options) => {
  assertNoNodeGlobals();
  assert.equal(options, undefined, 'WASM fixture does not accept request options');
  assert.ok(typeof url === 'string' && wasmBodies.has(url), 'Offline WASM fixture rejected an unrecognized URL');
  wasmFetches++;
  let bodyUsed = false;
  return {
    ok: true, status: 200,
    headers: { get: name => String(name).toLowerCase() === 'content-type' ? 'application/octet-stream' : null },
    get bodyUsed() { return bodyUsed; },
    arrayBuffer: async () => {
      assertNoNodeGlobals();
      if (bodyUsed) throw new TypeError('Body has already been consumed');
      bodyUsed = true;
      return wasmBodies.get(url).slice().buffer;
    },
  };
};
// Exercise the browser-built artifact without BOTH Node globals throughout SDK
// execution. This is a Node-host smoke; the separate Chromium harness uses fetch.
const originalBuffer = globalThis.Buffer;
const originalProcess = globalThis.process;
const originalFetch = globalThis.fetch;
try {
  delete globalThis.Buffer;
  delete globalThis.process;
  globalThis.fetch = offlineWasmFetch;
  assertNoNodeGlobals();
  // Controls run under the same missing-global conditions as the SDK. No URI
  // outside the exact embedded allowlist can reach Node fetch or the network.
  for (const url of ['https://example.invalid/runtime.wasm', 'file:///runtime.wasm', 'data:text/plain;base64,AA==', 'data:application/wasm;base64,AGFzbQEAAAA=']) {
    await assert.rejects(() => fetch(url), /rejected an unrecognized URL/);
  }
  await assert.rejects(() => fetch(wasmUrls[0], { method: 'POST' }), /does not accept request options/);
  const response = await fetch(wasmUrls[0]);
  assert.equal(response.headers.get('Content-Type'), 'application/octet-stream');
  assert.equal(response.headers.get('content-type'), 'application/octet-stream');
  assert.equal(response.headers.get('missing'), null);
  assert.equal(response.bodyUsed, false);
  assert.ok(WebAssembly.validate(await response.arrayBuffer()), 'fixture returns genuine WASM bytes');
  assert.equal(response.bodyUsed, true);
  await assert.rejects(() => response.arrayBuffer(), /already been consumed/);
  wasmFetches = 0;
  const sdk = await import('../bundle/event-pass.js');
  assertNoNodeGlobals();
  const commitment = Array.from(sdk.derivePassCommitment(new Uint8Array(32).fill(1), new Uint8Array(32).fill(3)), b => b.toString(16).padStart(2, '0')).join('');
  assert.equal(commitment, '5185c8debf55209fd26c57deed732812eba45a0081c735acd7d9a73f1ef3a038');
  assertNoNodeGlobals();
  sdk.selectNetwork('preview');
  const bridge = await sdk.connectorWalletProviders({ getConnectionStatus: async () => ({ status: 'connected', networkId: 'preview' }), getConfiguration: async () => ({ networkId: 'preview' }), getShieldedAddresses: async () => ({ shieldedCoinPublicKey: cpk, shieldedEncryptionPublicKey: epk }) }, 'preview');
  assert.equal(bridge.walletProvider.getCoinPublicKey(), '01'.repeat(32));
  assertNoNodeGlobals();
  const report = { schema: 'midnight-browser-built-artifact-node-smoke-v3', checkedAt: new Date().toISOString(), checks: ['bounded offline WASM fetch host fixture and rejected non-artifact URLs', 'actual browser-conditioned WASM/ESM imports', 'genuine Compact commitment', 'API4 Bech32m bridge with no global Buffer or process'], hostFixture: { initializedBrowserConstructors: browserConstructors, allowedEmbeddedWasmAssets: wasmUrls.length, responseContentType: 'application/octet-stream', sdkFetches: wasmFetches, nativeFetchUsed: false }, browserRuntimeExercised: false, walletConnections: 0, credentialsCreated: 0, proofsGenerated: 0, networkTransactions: 0 };
  await writeFile(new URL('../evidence/bundle-smoke.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} finally { globalThis.Buffer = originalBuffer; globalThis.process = originalProcess; globalThis.fetch = originalFetch; }
