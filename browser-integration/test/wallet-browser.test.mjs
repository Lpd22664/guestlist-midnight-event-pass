import test from 'node:test';
import assert from 'node:assert/strict';
import { ShieldedCoinPublicKey, ShieldedEncryptionPublicKey } from '@midnight-ntwrk/wallet-sdk-address-format';
import { createUnprovenDeployTx } from '@midnight-ntwrk/midnight-js-contracts';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { readFile } from 'node:fs/promises';
import { connectorWalletProviders, createBrowserProviders, validateServiceConfiguration, readChainStatus, compiledEventPass, BrowserZkConfigProvider, EventPassAdapter, deriveIssuerCommitment, encodeLiveCredential, decodeLiveCredential } from '../dist/index.js';
const base = 'https://synthetic.local/midnight/event-pass/';
const zk = () => new BrowserZkConfigProvider(base, async url => new Response(await readFile(new URL('../public/midnight/event-pass/' + new URL(url).pathname.replace('/midnight/event-pass/', ''), import.meta.url))));
const config = { networkId: 'preview', indexerUri: 'https://synthetic.local/graphql', indexerWsUri: 'wss://synthetic.local/graphql', substrateNodeUri: 'wss://synthetic.local/node' };
const cpk = ShieldedCoinPublicKey.codec.encode('preview', ShieldedCoinPublicKey.fromHexString('01'.repeat(32))).asString();
const epk = ShieldedEncryptionPublicKey.codec.encode('preview', ShieldedEncryptionPublicKey.fromHexString('02'.repeat(32))).asString();
function walletFixture() {
  let calls = 0, changed = false;
  return { getConnectionStatus: async () => ({ status: 'connected', networkId: 'preview' }), getConfiguration: async () => config,
    getShieldedAddresses: async () => ({ shieldedCoinPublicKey: changed ? epk : cpk, shieldedEncryptionPublicKey: epk }),
    balanceUnsealedTransaction: async () => { calls++; throw new Error('Synthetic blocked balance'); }, submitTransaction: async () => { calls++; throw new Error('Synthetic blocked submit'); },
    getProvingProvider: async keyMaterial => { calls++; assert.equal(typeof keyMaterial.getZKIR, 'function'); return { check: async () => [], prove: async () => { throw new Error('Synthetic blocked proof'); } }; },
    get calls() { return calls; }, set changed(value) { changed = value; } };
}
test('API4 key bridge blocks account changes before balance and submission', async () => {
  setNetworkId('preview'); const wallet = walletFixture(), bridge = await connectorWalletProviders(wallet, 'preview');
  assert.equal(bridge.walletProvider.getCoinPublicKey(), '01'.repeat(32)); assert.equal(bridge.walletProvider.getEncryptionPublicKey(), '02'.repeat(32)); wallet.changed = true;
  await assert.rejects(bridge.walletProvider.balanceTx({}), /account changed/); await assert.rejects(bridge.midnightProvider.submitTx({}), /account changed/); assert.equal(wallet.calls, 0);
});
test('denied wallet prover grant never obtains a proving provider', async () => {
  const wallet = walletFixture(); await assert.rejects(createBrowserProviders({ network: 'preview', wallet, compiledAssetsBaseUrl: base, privateStateProvider: {}, proofDestination: 'synthetic-owner-local-prover', authorizeWalletProver: async () => false }), /not approved/); assert.equal(wallet.calls, 0);
});
test('genuine browser provider factory uses API4 delegated proving and native WebSocket', async () => {
  const wallet = walletFixture(), result = await createBrowserProviders({ network: 'preview', wallet, compiledAssetsBaseUrl: base, privateStateProvider: {}, proofDestination: 'synthetic-owner-local-prover', authorizeWalletProver: async () => true, webSocketImpl: WebSocket });
  assert.equal(wallet.calls, 1); assert.equal(typeof result.providers.proofProvider.proveTx, 'function'); assert.equal(result.configuration.substrateNodeUri, config.substrateNodeUri);
});
test('wallet services reject wrong networks, credentials and insecure remote transport', () => {
  assert.throws(() => validateServiceConfiguration({ ...config, networkId: 'preprod' }, 'preview'), /network/);
  const credentialUrl = new URL(config.indexerUri); credentialUrl.username = 'synthetic-user'; credentialUrl.password = 'synthetic-password';
  assert.throws(() => validateServiceConfiguration({ ...config, indexerUri: credentialUrl.href }, 'preview'), /Invalid/);
  assert.throws(() => validateServiceConfiguration({ ...config, indexerWsUri: 'ws://synthetic.local/' }, 'preview'), /encrypted/);
});
test('validated service configuration is an immutable independent snapshot', () => {
  const original = { ...config };
  const approved = validateServiceConfiguration(original, 'preview');
  assert.notEqual(approved, original); assert.equal(Object.isFrozen(approved), true);
  original.indexerUri = 'https://changed.synthetic.local/graphql';
  assert.equal(approved.indexerUri, config.indexerUri);
  assert.throws(() => { approved.substrateNodeUri = 'wss://changed.synthetic.local/node'; }, TypeError);
});
test('in-place service drift cannot move the provider baseline before private proving', async () => {
  const current = { ...config }, wallet = walletFixture();
  wallet.getConfiguration = async () => current;
  const result = await createBrowserProviders({ network: 'preview', wallet, compiledAssetsBaseUrl: base, privateStateProvider: {}, proofDestination: 'synthetic-owner-local-prover', authorizeWalletProver: async () => true, webSocketImpl: WebSocket });
  current.indexerUri = 'https://changed.synthetic.local/graphql';
  let sent = false;
  await assert.rejects(result.providers.guardedEffects.proveTx({ prove: async () => { sent = true; throw new Error('Forbidden private transmission'); } }, undefined, () => {}), /Wallet services changed/);
  assert.equal(sent, false); assert.equal(result.configuration.indexerUri, config.indexerUri);
});
test('bearer joins real locally-built SDK contract without generating maintenance authority', async () => {
  setNetworkId('preview'); const zkConfigProvider = zk(), eventId = new Uint8Array(32).fill(1), issuerSecret = new Uint8Array(32).fill(2);
  const local = await createUnprovenDeployTx({ zkConfigProvider, walletProvider: { getCoinPublicKey: () => '01'.repeat(32), getEncryptionPublicKey: () => '02'.repeat(32) } }, { compiledContract: compiledEventPass(base), initialPrivateState: { issuerSecret }, args: [eventId, issuerSecret], signingKey: '11'.repeat(32) });
  let keyWrites = 0, stateWrites = 0, requests = [];
  const providers = { privateStateProvider: { setContractAddress: () => {}, set: async () => { stateWrites++; }, setSigningKey: async () => { keyWrites++; throw new Error('Forbidden key write'); } }, publicDataProvider: { queryContractState: async () => local.public.initialContractState }, zkConfigProvider, proofProvider: {}, walletProvider: {}, midnightProvider: {}, guardedEffects: {} };
  const adapter = new EventPassAdapter({ network: 'preview', ownerRole: 'bearer', compiledAssetsBaseUrl: base, providers, journal: {}, privateStateId: 'synthetic-bearer:event:role', proofDestination: 'synthetic-offline', authorize: async request => { requests.push(request); return true; } });
  await adapter.join({ contractAddress: local.public.contractAddress, eventId, issuerCommitment: deriveIssuerCommitment(eventId, issuerSecret), initialPrivateState: { bearerSecret: new Uint8Array(32).fill(3) } });
  assert.equal(keyWrites, 0); assert.equal(stateWrites, 1); assert.equal(requests[0].persistsMaintenanceKey, false);
  const issuerAdapter = new EventPassAdapter({ network: 'preview', ownerRole: 'issuer', compiledAssetsBaseUrl: base, providers, journal: {}, privateStateId: 'synthetic-issuer:event:role', proofDestination: 'synthetic-offline', authorize: async () => true });
  await issuerAdapter.join({ contractAddress: local.public.contractAddress, eventId, issuerCommitment: deriveIssuerCommitment(eventId, issuerSecret), initialPrivateState: { issuerSecret } });
  await assert.rejects(issuerAdapter.deploy({ requestId: 'duplicate-deployment', eventId, issuerSecret, signingKey: '11'.repeat(32) }), /already bound/);

});
test('WebSocket read-only node status queries the exact finalized header and rejects response ID mismatch', async () => {
  const requests = [], finalized = '0x' + 'b'.repeat(64);
  class FixtureSocket extends EventTarget { constructor() { super(); queueMicrotask(() => this.dispatchEvent(new Event('open'))); } send(body) { const request = JSON.parse(body); requests.push(request); queueMicrotask(() => this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ jsonrpc: '2.0', id: request.id, result: request.method === 'system_version' ? 'synthetic-node8' : request.method === 'chain_getFinalizedHead' ? finalized : { number: '0x2a' } }) }))); } close() { this.dispatchEvent(new Event('close')); } }
  const status = await readChainStatus({ network: 'preview', nodeRpcUri: 'wss://synthetic.local/', webSocketImpl: FixtureSocket });
  assert.equal(status.finalizedBlockHeight, 42); assert.deepEqual(requests.find(r => r.method === 'chain_getHeader').params, [finalized]);
  await assert.rejects(readChainStatus({ network: 'preview', nodeRpcUri: 'https://synthetic.local/', fetchImpl: async () => ({ ok: true, json: async () => ({ jsonrpc: '2.0', id: -1, result: finalized }) }) }), /Invalid/);
});
test('live credential uses real commitment and rejects demo/cross-network/event/contract inputs', () => {
  const expected = { network: 'preview', contractAddress: 'a'.repeat(64), eventId: '01'.repeat(32) }, bearerSecret = new Uint8Array(32).fill(3);
  const raw = encodeLiveCredential({ ...expected, bearerSecret }); const credential = decodeLiveCredential(raw, expected);
  assert.equal(credential.commitment, '5185c8debf55209fd26c57deed732812eba45a0081c735acd7d9a73f1ef3a038'); assert.deepEqual(credential.bearerSecret, bearerSecret);
  for (const replacement of [{ network: 'preprod' }, { contractAddress: 'b'.repeat(64) }, { eventId: '02'.repeat(32) }]) assert.throws(() => decodeLiveCredential(raw, { ...expected, ...replacement }), /wrong trusted/);
  assert.throws(() => decodeLiveCredential('guestlist-demo:anything', expected), /Invalid/);
  const envelope = JSON.parse(atob(raw.split(':')[1])); envelope.commitment = '05'.repeat(32);
  assert.throws(() => decodeLiveCredential('guestlist-midnight-v1:' + btoa(JSON.stringify(envelope)), expected), /Invalid/);
});
test('owner account changes stop the delegated proof before any preimage is sent', async () => {
  const wallet = walletFixture(), result = await createBrowserProviders({ network: 'preview', wallet, compiledAssetsBaseUrl: base, privateStateProvider: {}, proofDestination: 'synthetic-owner-local-prover', authorizeWalletProver: async () => true, webSocketImpl: WebSocket });
  wallet.changed = true;
  let sent = false;
  await assert.rejects(result.providers.proofProvider.proveTx({ prove: async () => { sent = true; throw new Error('Forbidden private transmission'); } }), /account changed/);
  assert.equal(sent, false);
});
test('expired guard blocks a new wallet balance/submit after delayed identity reads', async () => {
  setNetworkId('preview'); const wallet = walletFixture(), bridge = await connectorWalletProviders(wallet, 'preview');
  const addresses = await wallet.getShieldedAddresses();
  for (const method of ['balanceTxWithGuard', 'submitTxWithGuard']) {
    let release, entered;
    const hasEntered = new Promise(resolve => { entered = resolve; });
    wallet.getShieldedAddresses = async () => { entered(); return new Promise(resolve => { release = resolve; }); };
    let active = true;
    const operation = bridge[method]({ serialize: () => new Uint8Array([1]), identifiers: () => ['synthetic-id'] }, () => { if (!active) throw new Error('Synthetic expired operation guard'); });
    const rejected = assert.rejects(operation, /expired operation guard/);
    await hasEntered; active = false; release(addresses); await rejected;
  }
  assert.equal(wallet.calls, 0);
});
test('expired guard blocks private transaction proving after delayed owner identity check', async () => {
  const wallet = walletFixture(), result = await createBrowserProviders({ network: 'preview', wallet, compiledAssetsBaseUrl: base, privateStateProvider: {}, proofDestination: 'synthetic-owner-local-prover', authorizeWalletProver: async () => true, webSocketImpl: WebSocket });
  const addresses = await wallet.getShieldedAddresses(); let release, entered, sent = false, active = true;
  const hasEntered = new Promise(resolve => { entered = resolve; });
  wallet.getShieldedAddresses = async () => { entered(); return new Promise(resolve => { release = resolve; }); };
  const operation = result.providers.guardedEffects.proveTx({ prove: async () => { sent = true; throw new Error('Forbidden private transmission'); } }, undefined, () => { if (!active) throw new Error('Synthetic expired operation guard'); });
  const rejected = assert.rejects(operation, /expired operation guard/); await hasEntered; active = false; release(addresses); await rejected; assert.equal(sent, false);
});
