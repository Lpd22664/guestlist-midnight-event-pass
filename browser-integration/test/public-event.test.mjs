import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createUnprovenDeployTx, createUnprovenCallTxFromInitialStates } from '@midnight-ntwrk/midnight-js-contracts';
import { LedgerParameters, ZswapChainState } from '@midnight-ntwrk/midnight-js-protocol/ledger';
import { ContractState } from '@midnight-ntwrk/midnight-js-protocol/compact-runtime';
import { ChargedState } from '@midnight-ntwrk/midnight-js-protocol/onchain-runtime';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { compiledEventPass, BrowserZkConfigProvider, derivePassCommitment, deriveIssuerCommitment, verifyPublicEvent } from '../dist/index.js';

// Public synthetic fixture execution only: fixed published test inputs, no live
// wallet, authority creation, proof, signing, submission or finality claim.
const base = 'https://synthetic.invalid/midnight/event-pass/';
const fileFetch = async url => new Response(await readFile(new URL('../public/midnight/event-pass/' + new URL(url).pathname.replace('/midnight/event-pass/', ''), import.meta.url)));
const hex = value => Buffer.from(value).toString('hex');
async function fixture() {
  setNetworkId('preview');
  const zkConfigProvider = new BrowserZkConfigProvider(base, fileFetch);
  const eventId = new Uint8Array(32).fill(1), issuerSecret = new Uint8Array(32).fill(2), bearerSecret = new Uint8Array(32).fill(3);
  const compiledContract = compiledEventPass(base), coinPublicKey = '01'.repeat(32), walletEncryptionPublicKey = '02'.repeat(32);
  const deployed = await createUnprovenDeployTx({ zkConfigProvider, walletProvider: { getCoinPublicKey: () => coinPublicKey, getEncryptionPublicKey: () => walletEncryptionPublicKey } }, { compiledContract, initialPrivateState: { issuerSecret }, args: [eventId, issuerSecret], signingKey: '11'.repeat(32) });
  const contractAddress = deployed.public.contractAddress, commitment = derivePassCommitment(eventId, bearerSecret), issuerCommitment = deriveIssuerCommitment(eventId, issuerSecret);
  const call = (circuitId, initialContractState, initialPrivateState) => createUnprovenCallTxFromInitialStates(zkConfigProvider, { compiledContract, circuitId, contractAddress, args: [commitment], coinPublicKey, initialContractState, initialZswapChainState: new ZswapChainState(), ledgerParameters: LedgerParameters.initialParameters(), initialPrivateState }, walletEncryptionPublicKey);
  const issue = await call('issue', deployed.public.initialContractState, { issuerSecret });
  const active = ContractState.deserialize(deployed.public.initialContractState.serialize()); active.data = new ChargedState(issue.public.nextContractState);
  const stateAfter = result => { const state = ContractState.deserialize(active.serialize()); state.data = new ChargedState(result.public.nextContractState); return state; };
  const used = stateAfter(await call('redeem', active, { bearerSecret })), revoked = stateAfter(await call('revoke', active, { issuerSecret }));
  return { event: { network: 'preview', contractAddress, eventId: hex(eventId), issuerCommitment: hex(issuerCommitment) }, commitment: hex(commitment), never: deployed.public.initialContractState, active, used, revoked };
}
let fixturePromise;
const sdk = () => fixturePromise ??= fixture();
function options(f, state = f.active) {
  const calls = [];
  return { calls, value: { event: f.event, publicDataProvider: { queryContractState: async (...args) => { calls.push(['state', ...args]); return state; } }, compiledAssetsBaseUrl: base, commitment: f.commitment, fetchImpl: async (url, init) => { calls.push(['asset', url, init]); return fileFetch(url); } } };
}
test('walletless helper verifies one exact public state with all three hash-pinned verifier keys', async () => {
  const f = await sdk(), o = options(f), result = await verifyPublicEvent(o.value);
  assert.deepEqual(result, { eventId: f.event.eventId, issuerCommitment: f.event.issuerCommitment, issuedCount: '1', redeemedCount: '0', revokedCount: '0', passStatus: 'ACTIVE' });
  assert.deepEqual(o.calls.filter(row => row[0] === 'state'), [['state', f.event.contractAddress]]);
  const assets = o.calls.filter(row => row[0] === 'asset');
  assert.deepEqual(assets.map(row => new URL(row[1]).pathname).sort(), ['/midnight/event-pass/keys/issue.verifier', '/midnight/event-pass/keys/redeem.verifier', '/midnight/event-pass/keys/revoke.verifier']);
  for (const row of assets) { assert.equal(row[2].credentials, 'omit'); assert.equal(row[2].redirect, 'error'); }
  assert.equal('trust' in result, false); assert.equal('admit' in result, false); assert.equal('stateCheck' in result, false);
  assert.ok(!JSON.stringify(result).includes('Secret'));
});
test('walletless status returns NEVER_ISSUED, ACTIVE, USED and REVOKED without inventing admission', async () => {
  const f = await sdk();
  for (const [state, expected] of [[f.never, 'NEVER_ISSUED'], [f.active, 'ACTIVE'], [f.used, 'USED'], [f.revoked, 'REVOKED']]) assert.equal((await verifyPublicEvent(options(f, state).value)).passStatus, expected);
  const o = options(f); delete o.value.commitment;
  assert.equal('passStatus' in await verifyPublicEvent(o.value), false);
});
test('walletless read rejects missing contract, wrong identity, absent/mismatched verifier and tampered asset', async () => {
  const f = await sdk();
  await assert.rejects(verifyPublicEvent(options(f, null).value), /absent/);
  for (const key of ['eventId', 'issuerCommitment']) await assert.rejects(verifyPublicEvent({ ...options(f).value, event: { ...f.event, [key]: '99'.repeat(32) } }), /identity mismatch/);
  const missing = { data: f.active.data, operation: () => undefined };
  await assert.rejects(verifyPublicEvent(options(f, missing).value));
  const wrong = { data: f.active.data, operation: circuit => f.active.operation(circuit === 'issue' ? 'redeem' : circuit) };
  await assert.rejects(verifyPublicEvent(options(f, wrong).value));
  // The timeout/read boundary deliberately redacts provider-specific failures.
  await assert.rejects(verifyPublicEvent({ ...options(f).value, fetchImpl: async () => new Response(new Uint8Array(2119)) }), /query failed/);
});
test('walletless helper rejects malformed inputs before any public reads', async () => {
  const f = await sdk();
  for (const change of [{ event: { ...f.event, network: 'mainnet' } }, { event: { ...f.event, contractAddress: '00'.repeat(32) } }, { event: { ...f.event, eventId: 'FF'.repeat(32) } }, { commitment: '00'.repeat(32) }, { commitment: 'short' }, { timeoutMs: 0 }, { timeoutMs: Infinity }, { timeoutMs: 120_001 }]) {
    const o = options(f); await assert.rejects(verifyPublicEvent({ ...o.value, ...change })); assert.equal(o.calls.length, 0);
  }
});
test('walletless timeout and realm-network drift fail closed', async () => {
  const f = await sdk();
  await assert.rejects(verifyPublicEvent({ ...options(f).value, timeoutMs: 5, publicDataProvider: { queryContractState: () => new Promise(() => {}) } }), /timed out/);
  setNetworkId('preprod');
  try { await assert.rejects(verifyPublicEvent(options(f).value), /network changed/); } finally { setNetworkId('preview'); }
  try {
    await assert.rejects(verifyPublicEvent({ ...options(f).value, publicDataProvider: { queryContractState: async () => { setNetworkId('preprod'); return f.active; } } }), /network changed/);
  } finally { setNetworkId('preview'); }
});
