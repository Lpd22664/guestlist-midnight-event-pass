import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createUnprovenDeployTx, createUnprovenCallTxFromInitialStates } from '@midnight-ntwrk/midnight-js-contracts';
import { LedgerParameters, ZswapChainState } from '@midnight-ntwrk/midnight-js-protocol/ledger';
import { ContractState } from '@midnight-ntwrk/midnight-js-protocol/compact-runtime';
import { ChargedState } from '@midnight-ntwrk/midnight-js-protocol/onchain-runtime';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { EventPassAdapter, BrowserZkConfigProvider, compiledEventPass, derivePassCommitment, deriveIssuerCommitment } from '../dist/index.js';

// Real local SDK construction from public synthetic fixtures. No actual proof,
// balance/signature, submission, random authority creation or network access.
const base = 'https://synthetic.invalid/midnight/event-pass/', initialNow = 1_800_000_000_000;
const fetchAsset = async url => new Response(await readFile(new URL('../public/midnight/event-pass/' + new URL(url).pathname.replace('/midnight/event-pass/', ''), import.meta.url)));
async function source() {
  setNetworkId('preview'); const zkConfigProvider = new BrowserZkConfigProvider(base, fetchAsset), compiledContract = compiledEventPass(base);
  const eventId = new Uint8Array(32).fill(1), issuerSecret = new Uint8Array(32).fill(2), bearerSecret = new Uint8Array(32).fill(3);
  const coinPublicKey = '01'.repeat(32), walletEncryptionPublicKey = '02'.repeat(32);
  const deployed = await createUnprovenDeployTx({ zkConfigProvider, walletProvider: { getCoinPublicKey: () => coinPublicKey, getEncryptionPublicKey: () => walletEncryptionPublicKey } }, { compiledContract, initialPrivateState: { issuerSecret }, args: [eventId, issuerSecret], signingKey: '11'.repeat(32) });
  const commitment = derivePassCommitment(eventId, bearerSecret), contractAddress = deployed.public.contractAddress;
  const issued = await createUnprovenCallTxFromInitialStates(zkConfigProvider, { compiledContract, circuitId: 'issue', contractAddress, args: [commitment], coinPublicKey, initialContractState: deployed.public.initialContractState, initialZswapChainState: new ZswapChainState(), ledgerParameters: LedgerParameters.initialParameters(), initialPrivateState: { issuerSecret } }, walletEncryptionPublicKey);
  const active = ContractState.deserialize(deployed.public.initialContractState.serialize()); active.data = new ChargedState(issued.public.nextContractState);
  return { eventId, issuerCommitment: deriveIssuerCommitment(eventId, issuerSecret), bearerSecret, commitment, contractAddress, activeBytes: active.serialize(), zkConfigProvider, coinPublicKey, walletEncryptionPublicKey };
}
let sourcePromise; const fixtureSource = () => sourcePromise ??= source();
async function fixture(t, hooks = {}) {
  const s = await fixtureSource(); setNetworkId('preview'); let now = initialNow;
  const active = ContractState.deserialize(s.activeBytes);
  t.mock.method(Date, 'now', () => now);
  const rows = new Map(), counts = { proof: 0, balance: 0, submit: 0, approvals: 0 }; let joined = false;
  const control = { advance: value => { now = value; }, counts, rows };
  const providers = {
    publicDataProvider: { queryContractState: async () => { if (joined) hooks.preflight?.(control); return active; }, queryZSwapAndContractState: async () => [new ZswapChainState(), active, LedgerParameters.initialParameters()] },
    privateStateProvider: { setContractAddress: () => {}, get: async () => ({ bearerSecret: s.bearerSecret }), set: async () => {} },
    zkConfigProvider: s.zkConfigProvider, proofProvider: {},
    walletProvider: { getCoinPublicKey: () => s.coinPublicKey, getEncryptionPublicKey: () => s.walletEncryptionPublicKey }, midnightProvider: {},
    guardedEffects: {
      proveTx: async (tx, _config, guard) => { await hooks.beforeProof?.(control); guard(); counts.proof++; await hooks.afterProof?.(control); return tx; },
      balanceTx: async (tx, guard) => { await hooks.beforeBalance?.(control); guard(); counts.balance++; await hooks.afterBalance?.(control); return tx; },
      submitTx: async (_tx, guard) => { await hooks.beforeSubmit?.(control); guard(); counts.submit++; await hooks.afterSubmit?.(control); throw new Error('Synthetic lost response; no actual submission'); },
    },
  };
  const adapter = new EventPassAdapter({ network: 'preview', ownerRole: 'bearer', providers, compiledAssetsBaseUrl: base, proofDestination: 'synthetic owner prover', privateStateId: 'synthetic-owner:event:bearer', timeoutMs: hooks.timeoutMs ?? 120_000,
    journal: { create: async row => { assert.ok(!rows.has(row.requestId)); rows.set(row.requestId, structuredClone(row)); hooks.reserved?.(control); }, update: async row => { rows.set(row.requestId, structuredClone(row)); }, get: async id => rows.get(id) ?? null },
    authorize: async request => { if (request.action === 'redeem') { counts.approvals++; await hooks.approval?.(control); } return true; },
  });
  await adapter.join({ contractAddress: s.contractAddress, eventId: s.eventId, issuerCommitment: s.issuerCommitment, initialPrivateState: { bearerSecret: s.bearerSecret } }); joined = true;
  return { ...control, adapter, commitment: s.commitment, deadline: initialNow + 60_000 };
}
test('SDK gate deadline rejects expired and malformed values before consent, journal or effects', async t => {
  const f = await fixture(t);
  for (const expiresAt of [initialNow, initialNow - 1, -1, NaN, Infinity, 1.5]) await assert.rejects(f.adapter.redeem('synthetic-expired', f.commitment, { expiresAt }), /expired/);
  assert.deepEqual(f.counts, { proof: 0, balance: 0, submit: 0, approvals: 0 }); assert.equal(f.rows.size, 0);
});
test('SDK rechecks gate expiry after slow public preflight and after transaction consent', async t => {
  for (const hook of ['preflight', 'approval']) {
    const f = await fixture(t, { [hook]: control => control.advance(initialNow + 60_000) });
    await assert.rejects(f.adapter.redeem('synthetic-consent-expiry', f.commitment, { expiresAt: f.deadline }), /expired/);
    assert.equal(f.counts.proof, 0); assert.equal(f.counts.balance, 0); assert.equal(f.counts.submit, 0); assert.equal(f.rows.size, 0);
  }
});
test('SDK rechecks gate expiry after journal reservation before private effects', async t => {
  const f = await fixture(t, { reserved: control => control.advance(initialNow + 60_000) });
  await assert.rejects(f.adapter.redeem('synthetic-reserve-expiry', f.commitment, { expiresAt: f.deadline }));
  assert.equal(f.counts.proof, 0); assert.equal(f.counts.balance, 0); assert.equal(f.counts.submit, 0);
  assert.equal(f.rows.get('synthetic-reserve-expiry').expiresAt, f.deadline);
});
for (const [hook, expected] of [['beforeProof', [0, 0, 0]], ['beforeBalance', [1, 0, 0]], ['beforeSubmit', [1, 1, 0]]]) {
  test(`SDK current-time guard blocks ${hook} after delayed external identity check without waiting for a timer`, async t => {
    const f = await fixture(t, { [hook]: control => control.advance(initialNow + 60_000) });
    await assert.rejects(f.adapter.redeem(`synthetic-${hook}`, f.commitment, { expiresAt: f.deadline }));
    assert.deepEqual([f.counts.proof, f.counts.balance, f.counts.submit], expected);
    assert.equal(f.rows.get(`synthetic-${hook}`).expiresAt, f.deadline);
    assert.notEqual(f.rows.get(`synthetic-${hook}`).state, 'verified');
  });
}
test('proof already started before expiry may finish but cannot start balancing afterward', async t => {
  const f = await fixture(t, { afterProof: control => control.advance(initialNow + 60_000) });
  await assert.rejects(f.adapter.redeem('synthetic-proof-expiry', f.commitment, { expiresAt: f.deadline }));
  assert.equal(f.counts.proof, 1); assert.equal(f.counts.balance, 0); assert.equal(f.counts.submit, 0);
});
test('gate deadline never extends a shorter existing SDK operation timeout', async t => {
  const f = await fixture(t, { timeoutMs: 500, beforeProof: control => { control.advance(initialNow + 500); } });
  await assert.rejects(f.adapter.redeem('synthetic-shorter-timeout', f.commitment, { expiresAt: f.deadline }));
  assert.equal(f.rows.get('synthetic-shorter-timeout').expiresAt, initialNow + 500); assert.equal(f.counts.proof, 0);
});
test('submission started before expiry stays unknown after lost response and cannot imply cancellation', async t => {
  const f = await fixture(t, { afterSubmit: control => control.advance(initialNow + 60_000) });
  await assert.rejects(f.adapter.redeem('synthetic-submitted-unknown', f.commitment, { expiresAt: f.deadline }));
  assert.equal(f.counts.submit, 1); assert.equal(f.rows.get('synthetic-submitted-unknown').state, 'unknown');
  assert.ok(f.rows.get('synthetic-submitted-unknown').candidateTxIds.length > 0);
  await assert.rejects(f.adapter.redeem('synthetic-submitted-unknown', f.commitment, { expiresAt: f.deadline }), /expired/);
  assert.equal(f.counts.submit, 1);
});
