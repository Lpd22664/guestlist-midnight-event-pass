import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { BrowserZkConfigProvider } from '../dist/index.js';
import * as RT from '@midnight-ntwrk/compact-runtime';
import { Contract, ledger, pureCircuits } from '../dist/generated/contract/index.js';
const testBytes = (value) => new Uint8Array(32).fill(value);
class LocalContractHarness {
  constructor() {
    this.eventId = testBytes(1);
    this.privateState = { issuerSecret: testBytes(2), bearerSecret: testBytes(3) };
    this.contract = new Contract({ issuerSecret: ({ privateState }) => [privateState, privateState.issuerSecret], bearerSecret: ({ privateState }) => [privateState, privateState.bearerSecret] });
    this.address = 'a'.repeat(64);
    this.state = this.contract.initialState(RT.createConstructorContext(this.privateState, '0'.repeat(64)), this.eventId, this.privateState.issuerSecret).currentContractState;
  }
  get ledger() { return ledger(this.state.data); }
  commitment() { return pureCircuits.derivePassCommitment(this.eventId, this.privateState.bearerSecret); }
  call(name, commitment) {
    const result = this.contract.impureCircuits[name](RT.createCircuitContext(this.address, '0'.repeat(64), this.state, this.privateState), commitment);
    this.state.data = result.context.currentQueryContext.state;
    return result;
  }
}
import {
  EventPassAdapter, derivePassCommitment, deriveIssuerCommitment, witnesses,
  readPublicState, assertAccepted, verifyReceipt, OutcomeUnknownError,
  discoverWallets, connectOwnerSelectedWallet, readChainStatus, withReadTimeout, verifyAndClaimAdmission,
} from '../dist/index.js';

// Entire suite uses synthetic inputs and mock network/proof/wallet providers.
const address = 'a'.repeat(64);
const receiptData = (overrides = {}) => ({
  status: 'SucceedEntirely', segmentStatusMap: new Map([[0, 'SegmentSuccess']]),
  tx: { identifiers: () => ['synthetic-id'], intents: new Map() },
  txId: 'synthetic-id', identifiers: ['synthetic-id'], txHash: 'synthetic-hash',
  blockHash: 'synthetic-block', blockHeight: 42, blockTimestamp: 1_700_000_000,
  // Public transaction attribution is required; network finalization below is synthetic.
  private: { shouldNeverSerialize: 'synthetic-private-fixture' },
  ...overrides,
});
const atom = (bytes, length) => ({ value: [bytes], alignment: [{ tag: 'atom', value: { tag: 'bytes', length } }] });
function callFixture(action, commitment, contractAddress = address) {
  const status = { issue: 0, redeem: 1, revoke: 2 }[action], counter = { issue: 3, redeem: 4, revoke: 5 }[action];
  const index = field => ({ idx: { cached: false, pushPath: true, path: [{ tag: 'value', value: atom(Uint8Array.of(field), 1) }] } });
  return { address: contractAddress, entryPoint: action, guaranteedTranscript: { program: [index(2),
    { push: { storage: false, value: { tag: 'cell', content: atom(commitment, 32) } } },
    { push: { storage: true, value: { tag: 'cell', content: atom(status === 0 ? new Uint8Array() : Uint8Array.of(status), 1) } } },
    { ins: { cached: false, n: 1 } }, { ins: { cached: true, n: 1 } }, index(counter), { addi: { immediate: 1 } }, { ins: { cached: true, n: 1 } }] }, fallibleTranscript: undefined };
}
function finalizedFor(action, commitment, overrides = {}) {
  return receiptData({ tx: { identifiers: () => ['synthetic-id'], intents: new Map([[1, { actions: [callFixture(action, commitment)] }]]) }, ...overrides });
}
const intent = (h, action, commitment) => ({ network: 'preprod', action, contractAddress: address,
  eventId: h.eventId, issuerCommitment: h.ledger.issuerCommitment, ...(commitment ? { commitment } : {}) });
function mockPublicProvider(h) {
  const calls = [];
  return { calls, queryContractState: async (queriedAddress, config) => { calls.push({ queriedAddress, config }); return h.state; } };
}
class SyntheticJournal {
  attempts = new Map();
  async create(attempt) {
    assert.ok(!this.attempts.has(attempt.requestId), 'Duplicate requestId');
    assert.ok(![...this.attempts.values()].some((other) => other.eventId === attempt.eventId && ['started', 'submitting', 'submitted', 'unknown'].includes(other.state)), 'Unresolved same-event operation');
    this.attempts.set(attempt.requestId, structuredClone(attempt));
  }
  async update(attempt) { this.attempts.set(attempt.requestId, structuredClone(attempt)); }
  async get(id) { return this.attempts.get(id) ?? null; }
}
const assets = 'https://synthetic.local/midnight/event-pass/';
const testZkProvider = () => new BrowserZkConfigProvider(assets, async url => {
  const relative = new URL(url).pathname.replace('/midnight/event-pass/', '');
  return new Response(await readFile(new URL('../public/midnight/event-pass/' + relative, import.meta.url)));
});
function mockOptions(overrides = {}) {
  setNetworkId('preprod');
  const options = {
    network: 'preprod', ownerRole: 'issuer', compiledAssetsBaseUrl: assets, proofDestination: 'synthetic-offline-prover', privateStateId: 'synthetic-account:event-1:issuer',
    journal: new SyntheticJournal(), authorize: async () => false, timeoutMs: 150,
    providers: { privateStateProvider: {}, publicDataProvider: {}, zkConfigProvider: testZkProvider(),
      proofProvider: { proveTx: async () => { throw new Error('Mock prover only'); } },
      walletProvider: { getCoinPublicKey: () => '0'.repeat(64), getEncryptionPublicKey: () => '0'.repeat(64), balanceTx: async () => { throw new Error('Must not balance'); } },
      midnightProvider: { submitTx: async () => { throw new Error('Must not submit'); } },
    }, ...overrides,
  };
  options.providers.guardedEffects = { proveTx: (tx, config, guard) => { guard(); return options.providers.proofProvider.proveTx(tx, config); }, balanceTx: (tx, guard) => { guard(); return options.providers.walletProvider.balanceTx(tx); }, submitTx: (tx, guard) => { guard(); return options.providers.midnightProvider.submitTx(tx); } };
  return options;
}

test('adapter commitment helpers equal the actual generated Compact pure circuits', () => {
  assert.deepEqual(derivePassCommitment(testBytes(1), testBytes(3)), pureCircuits.derivePassCommitment(testBytes(1), testBytes(3)));
  assert.deepEqual(deriveIssuerCommitment(testBytes(1), testBytes(2)), pureCircuits.deriveIssuerCommitment(testBytes(1), testBytes(2)));
  assert.notDeepEqual(derivePassCommitment(testBytes(4), testBytes(3)), derivePassCommitment(testBytes(1), testBytes(3)));
  assert.notDeepEqual(deriveIssuerCommitment(testBytes(1), testBytes(3)), derivePassCommitment(testBytes(1), testBytes(3)));
  assert.throws(() => derivePassCommitment(testBytes(0), testBytes(3)), /nonzero/);
  assert.throws(() => derivePassCommitment(testBytes(1), new Uint8Array(31)), /32/);
});
test('explicit witnesses reject absent capabilities and never add an issuer capability to a bearer', () => {
  const state = { bearerSecret: testBytes(3) };
  const [returned, secret] = witnesses.bearerSecret({ privateState: state });
  assert.equal(returned, state); assert.deepEqual(secret, testBytes(3));
  assert.throws(() => witnesses.issuerSecret({ privateState: state }), /absent/);
});
test('reads distinguish a never-issued commitment from active/used/revoked tombstones', async () => {
  const h = new LocalContractHarness(), provider = mockPublicProvider(h), commitment = h.commitment();
  assert.equal((await readPublicState(provider, address, commitment)).passStatus, 'NEVER_ISSUED');
  h.call('issue', commitment);
  assert.equal((await readPublicState(provider, address, commitment)).passStatus, 'ACTIVE');
  h.call('redeem', commitment);
  assert.equal((await readPublicState(provider, address, commitment)).passStatus, 'USED');
  const h2 = new LocalContractHarness(); h2.call('issue', commitment); h2.call('revoke', commitment);
  assert.equal((await readPublicState(mockPublicProvider(h2), address, commitment)).passStatus, 'REVOKED');
});
for (const status of ['FailEntirely', 'FailFallible', 'pending', 'confirmed', 'unknown']) {
  test(`gate rejects ${status}, including partial success`, () => assert.throws(() => assertAccepted(receiptData({ status })), /do not admit/));
}
test('gate also rejects a failed execution segment despite an overall success string', () => {
  assert.throws(() => assertAccepted(receiptData({ segmentStatusMap: new Map([[1, 'SegmentFail']]) })), /do not admit/);
});
for (const action of ['issue', 'redeem', 'revoke']) {
  test(`${action} receipt requires an independent state query pinned to the finalized block`, async () => {
    const h = new LocalContractHarness(), commitment = h.commitment();
    h.call('issue', commitment);
    if (action !== 'issue') h.call(action, commitment);
    const provider = mockPublicProvider(h);
    const receipt = await verifyReceipt(provider, finalizedFor(action, commitment), intent(h, action, commitment));
    assert.equal(receipt.transactionStatus, 'SucceedEntirely');
    assert.deepEqual(provider.calls[0].config, { type: 'blockHash', blockHash: 'synthetic-block' });
    const serialized = JSON.stringify(receipt);
    assert.ok(!serialized.includes('synthetic-private-fixture'));
    assert.ok(!serialized.includes('issuerSecret'));
    assert.ok(!serialized.includes(Buffer.from(testBytes(2)).toString('hex')));
    assert.ok(!serialized.includes(Buffer.from(testBytes(3)).toString('hex')));
  });
}
test('a used public state alone is never a successful redemption receipt', async () => {
  const h = new LocalContractHarness(), commitment = h.commitment(); h.call('issue', commitment); h.call('redeem', commitment);
  await assert.rejects(verifyReceipt(mockPublicProvider(h), finalizedFor('redeem', commitment, { status: 'FailFallible' }), intent(h, 'redeem', commitment)), /do not admit/);
});
test('successful-looking receipt with stale ACTIVE public state cannot admit', async () => {
  const h = new LocalContractHarness(), commitment = h.commitment(); h.call('issue', commitment);
  await assert.rejects(verifyReceipt(mockPublicProvider(h), finalizedFor('redeem', commitment), intent(h, 'redeem', commitment)), /does not match/);
});
test('wrong event/issuer and missing contract state fail closed', async () => {
  const h = new LocalContractHarness(), commitment = h.commitment(); h.call('issue', commitment);
  await assert.rejects(verifyReceipt(mockPublicProvider(h), finalizedFor('issue', commitment), { ...intent(h, 'issue', commitment), eventId: testBytes(8) }), /wrong event/);
  await assert.rejects(verifyReceipt({ queryContractState: async () => null }, finalizedFor('issue', commitment), intent(h, 'issue', commitment)), /wrong event/);
});
test('deployment denial stops before SDK/private/prover/wallet/network work', async () => {
  const adapter = new EventPassAdapter(mockOptions());
  await assert.rejects(adapter.deploy({ requestId: 'denied-deploy', eventId: testBytes(1), issuerSecret: testBytes(2), signingKey: '11'.repeat(32) }), /approval/);
});
test('no automatic maintenance key creation and no anonymous private store', async () => {
  assert.throws(() => new EventPassAdapter(mockOptions({ privateStateId: 'event-pass-private-state-v1' })), /owner/);
  const adapter = new EventPassAdapter(mockOptions());
  await assert.rejects(adapter.deploy({ requestId: 'missing-key', eventId: testBytes(1), issuerSecret: testBytes(2) }), /signingKey/);
});
test('a slow mock prover times out without subsequent balance/sign/submit, and blocks concurrent work', async () => {
  let resolveProof, enteredProof;
  const entered = new Promise((resolve) => { enteredProof = resolve; });
  const delayedProof = new Promise((resolve) => { resolveProof = resolve; });
  let balanceCount = 0, submitCount = 0;
  const options = mockOptions({ authorize: async () => true, timeoutMs: 500 });
  options.providers.proofProvider = { proveTx: async () => { enteredProof(); return delayedProof; } };
  options.providers.walletProvider.balanceTx = async () => { balanceCount++; throw new Error('Must never balance'); };
  options.providers.midnightProvider.submitTx = async () => { submitCount++; throw new Error('Must never submit'); };
  const adapter = new EventPassAdapter(options);
  const operation = adapter.deploy({ requestId: 'timeout-fixture', eventId: testBytes(1), issuerSecret: testBytes(2), signingKey: '11'.repeat(32) });
  const rejected = assert.rejects(operation, OutcomeUnknownError);
  await withReadTimeout(entered, 2_000);
  await rejected;
  assert.equal((await options.journal.get('timeout-fixture')).state, 'unknown');
  await assert.rejects(adapter.deploy({ requestId: 'must-not-resubmit', eventId: testBytes(1), issuerSecret: testBytes(2), signingKey: '11'.repeat(32) }), /still running/);
  assert.equal(await adapter.reconcile('timeout-fixture'), null);
  resolveProof({});
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(balanceCount, 0); assert.equal(submitCount, 0);
  await assert.rejects(adapter.deploy({ requestId: 'timeout-fixture', eventId: testBytes(1), issuerSecret: testBytes(2), signingKey: '11'.repeat(32) }), /Duplicate requestId/);
});
test('wallet injection enumeration never chooses/connects a wallet silently', async () => {
  let calls = 0;
  const fake = { name: 'Synthetic wallet', rdns: 'test.invalid', apiVersion: '4.0.1', connect: async () => { calls++; throw new Error('Must not connect'); } };
  assert.deepEqual(discoverWallets(undefined), []);
  assert.equal(discoverWallets({ 'synthetic-uuid': fake })[0].id, 'synthetic-uuid');
  await assert.rejects(connectOwnerSelectedWallet(fake, 'preprod', async () => false), /approval/);
  assert.equal(calls, 0);
});
test('read-only chain helper uses finalized head/header and system_version only', async () => {
  const calls = [], finalized = '0x' + 'b'.repeat(64);
  const status = await readChainStatus({ network: 'preprod', nodeRpcUri: 'https://synthetic.invalid', fetchImpl: async (_, options) => {
    const request = JSON.parse(options.body); calls.push(request);
    return { ok: true, json: async () => ({ jsonrpc: '2.0', id: request.id, result: request.method === 'system_version' ? 'synthetic-node-version' : request.method === 'chain_getFinalizedHead' ? finalized : { number: '0x2a' } }) };
  } });
  assert.equal(status.finalizedBlockHeight, 42);
  assert.equal(status.finalizedBlockHash, finalized);
  assert.deepEqual(calls.map((call) => call.method).sort(), ['chain_getFinalizedHead', 'chain_getHeader', 'system_version'].sort());
});
test('read-only query timeout never produces a success receipt', async () => {
  await assert.rejects(withReadTimeout(new Promise(() => {}), 10), /timed out/);
});
test('all Midnight.js dependencies are exactly pinned at 4.1.1', async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url)));
  for (const [name, version] of Object.entries(pkg.dependencies)) if (name.includes('/midnight-js-')) assert.equal(version, '4.1.1');
  assert.equal(pkg.dependencies['@midnight-ntwrk/dapp-connector-api'], '4.0.1');
});

test('gate receipt replay is claimed at most once, even with a different request id', async () => {
  const h = new LocalContractHarness(), commitment = h.commitment(); h.call('issue', commitment); h.call('redeem', commitment);
  const journal = new SyntheticJournal(), data = finalizedFor('redeem', commitment);
  const eventId = Buffer.from(h.eventId).toString('hex');
  const issuerCommitment = Buffer.from(h.ledger.issuerCommitment).toString('hex');
  const commitmentHex = Buffer.from(commitment).toString('hex');
  const attempt = { network: 'preprod', action: 'redeem', contractAddress: address, eventId, issuerCommitment, commitment: commitmentHex, state: 'verified', txId: data.txId, expiresAt: 0 };
  await journal.create({ ...attempt, requestId: 'gate-first' });
  await journal.create({ ...attempt, requestId: 'gate-replayed' });
  const claimed = new Set();
  const admissions = { claimOnce: async (key) => { if (claimed.has(key)) return false; claimed.add(key); return true; } };
  const options = { network: 'preprod', contractAddress: address, eventId, issuerCommitment, commitment: commitmentHex, journal, admissions,
    publicDataProvider: { ...mockPublicProvider(h), watchForTxData: async () => data } };
  assert.equal((await verifyAndClaimAdmission({ ...options, requestId: 'gate-first' })).admit, true);
  assert.equal((await verifyAndClaimAdmission({ ...options, requestId: 'gate-first' })).admit, false);
  assert.equal((await verifyAndClaimAdmission({ ...options, requestId: 'gate-replayed' })).admit, false);
  await assert.rejects(verifyAndClaimAdmission({ ...options, requestId: 'missing' }), /do not admit/);
});
test('bearer-scoped deployment fails before approval, proving, journal or DUST work', async () => {
  let approvals = 0; const options = mockOptions({ ownerRole: 'bearer', authorize: async () => { approvals++; return true; } });
  const adapter = new EventPassAdapter(options);
  await assert.rejects(adapter.deploy({ requestId: 'bearer-deploy-denied', eventId: testBytes(1), issuerSecret: testBytes(2), signingKey: '11'.repeat(32) }), /issuer-scoped/);
  assert.equal(approvals, 0); assert.equal(await options.journal.get('bearer-deploy-denied'), null);
});
test('fixed owner session event mismatch and missing guarded provider boundary fail closed', async () => {
  const options = mockOptions({ expectedEventId: testBytes(1) }), adapter = new EventPassAdapter(options);
  await assert.rejects(adapter.deploy({ requestId: 'wrong-scope', eventId: testBytes(4), issuerSecret: testBytes(2), signingKey: '11'.repeat(32) }), /owner-scoped/);
  delete options.providers.guardedEffects; assert.throws(() => new EventPassAdapter(options), /guarded external/);
});
test('an unrelated successful transaction after a pass is USED cannot become a redemption receipt', async () => {
  const h = new LocalContractHarness(), commitment = h.commitment(); h.call('issue', commitment); h.call('redeem', commitment);
  await assert.rejects(verifyReceipt(mockPublicProvider(h), receiptData(), intent(h, 'redeem', commitment)), /expected contract\/circuit\/commitment/);
  const differentPass = testBytes(8), wrongTarget = finalizedFor('redeem', differentPass);
  await assert.rejects(verifyReceipt(mockPublicProvider(h), wrongTarget, intent(h, 'redeem', commitment)), /expected contract/);
  const wrongCircuit = finalizedFor('issue', commitment); await assert.rejects(verifyReceipt(mockPublicProvider(h), wrongCircuit, intent(h, 'redeem', commitment)), /expected contract/);
  const wrongAddress = receiptData({ tx: { identifiers: () => ['synthetic-id'], intents: new Map([[1, { actions: [callFixture('redeem', commitment, 'b'.repeat(64))] }]]) } });
  await assert.rejects(verifyReceipt(mockPublicProvider(h), wrongAddress, intent(h, 'redeem', commitment)), /expected contract/);
});
test('arbitrary commitment occurrence and malformed/counter-less public transcripts fail attribution', async () => {
  const h = new LocalContractHarness(), commitment = h.commitment(); h.call('issue', commitment); h.call('redeem', commitment);
  for (const change of [call => call.guaranteedTranscript.program.reverse(), call => call.guaranteedTranscript.program.pop(), call => { call.guaranteedTranscript.program[2].push.storage = false; }, call => { call.guaranteedTranscript.program[6].addi.immediate = 2; }]) {
    const call = callFixture('redeem', commitment); change(call);
    const data = receiptData({ tx: { identifiers: () => ['synthetic-id'], intents: new Map([[1, { actions: [call] }]]) } });
    await assert.rejects(verifyReceipt(mockPublicProvider(h), data, intent(h, 'redeem', commitment)), /expected contract/);
  }
});
test('receipt requires its actual public transaction identifier and rejects missing public tx', async () => {
  const h = new LocalContractHarness(), commitment = h.commitment(); h.call('issue', commitment);
  await assert.rejects(verifyReceipt(mockPublicProvider(h), finalizedFor('issue', commitment, { txId: 'other-id' }), intent(h, 'issue', commitment)), /identifier mismatch/);
  await assert.rejects(verifyReceipt(mockPublicProvider(h), finalizedFor('issue', commitment, { tx: undefined }), intent(h, 'issue', commitment)), /missing/);
});
test('closing an adapter during proof revokes later balance/submit and forbids new operations', async () => {
  let enteredProof, releaseProof, balances = 0, submissions = 0;
  const entered = new Promise(resolve => { enteredProof = resolve; }), pending = new Promise(resolve => { releaseProof = resolve; });
  const options = mockOptions({ authorize: async () => true, timeoutMs: 10_000 });
  options.providers.proofProvider.proveTx = async () => { enteredProof(); return pending; };
  options.providers.walletProvider.balanceTx = async () => { balances++; throw new Error('Forbidden synthetic balance'); };
  options.providers.midnightProvider.submitTx = async () => { submissions++; throw new Error('Forbidden synthetic submit'); };
  const adapter = new EventPassAdapter(options), operation = adapter.deploy({ requestId: 'close-before-wallet', eventId: testBytes(1), issuerSecret: testBytes(2), signingKey: '11'.repeat(32) });
  const rejected = assert.rejects(operation, /failed before submission|unresolved/);
  await entered; adapter.close(); releaseProof({}); await rejected;
  assert.equal(balances, 0); assert.equal(submissions, 0);
  await assert.rejects(adapter.deploy({ requestId: 'closed-retry', eventId: testBytes(1), issuerSecret: testBytes(2), signingKey: '11'.repeat(32) }), /closed/);
});
