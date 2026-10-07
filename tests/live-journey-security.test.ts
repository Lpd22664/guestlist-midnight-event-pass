import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LiveController, type GateClient } from '../src/live/controller';
import type { Custody, PublicStateSnapshot, Sdk } from '../src/live/model';

// Fixed synthetic review fixtures; no owner key, wallet, signing, or live network.
const event = { network: 'preview' as const, eventId: '11'.repeat(32), contractAddress: '22'.repeat(32), issuerCommitment: '33'.repeat(32) };
const commitment = '44'.repeat(32);
const state: PublicStateSnapshot = { eventId: event.eventId, issuerCommitment: event.issuerCommitment, issuedCount: '1', redeemedCount: '0', revokedCount: '0', passStatus: 'ACTIVE' };
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }
function fixture(verify: Sdk['verifyPublicEvent'] = async () => state) {
  const records = new Map<string, string>();
  const calls: unknown[][] = [];
  const sdk = { derivePassCommitment: () => new Uint8Array(32).fill(0x44), createReadOnlyPublicProvider: (...args: unknown[]) => { calls.push(args); return {}; }, verifyPublicEvent: verify } as unknown as Sdk;
  const controller = new LiveController({ storage: { getItem: key => records.get(key) ?? null, setItem: (key, value) => { records.set(key, value); } }, loadSdk: async () => sdk, requestId: () => 'synthetic-review-request', assets: () => 'https://synthetic.invalid/assets/' });
  async function approve<T>(run: () => Promise<T>) { const unsubscribe = controller.consent.subscribe(() => { if (controller.consent.getSnapshot()) queueMicrotask(() => controller.consent.respond(true)); }); try { return await run(); } finally { unsubscribe(); } }
  async function ready() { await controller.load(); await approve(() => controller.reviewEvent(event)); }
  return { controller, calls, sdk, ready, approve };
}
function custody(): Custody { return { role: 'bearer', ownerAccountId: 'synthetic-review-owner', eventId: event.eventId, encryptionKey: {} as CryptoKey, capability: new Uint8Array(32).fill(7) }; }
function gate(): GateClient { return { health: async () => ({ schema: 'guestlist-gate-health-v1', policy: 'active-before-redemption-v1', storage: 'durable-shared', events: [event] }), close: () => {}, openRedemption: async input => ({ admit: false, code: 'opened', attempt: { ...input, baselineBlockHash: '55'.repeat(32), baselineBlockHeight: 7, expiresAt: Date.now() + 60_000 } }), claimRedemption: async () => { throw new Error('Synthetic review must not claim'); } }; }

test('reviewed event replacement cannot attach an old bearer commitment to a new event', async () => {
  const f = fixture(); await f.ready(); f.controller.setCustody(custody()); f.controller.prepareBearerCommitment();
  const replacement = { ...event, eventId: '66'.repeat(32), contractAddress: '77'.repeat(32) };
  await f.approve(() => f.controller.reviewEvent(replacement));
  assert.equal(f.controller.getSnapshot().event?.eventId, event.eventId);
  assert.equal(f.controller.custodyScope?.eventId, event.eventId);
  assert.equal(f.controller.getSnapshot().commitment, commitment);
  assert.ok(f.controller.getSnapshot().error);
});

test('unresolved gate context cannot be stranded by trusting a different contract', async () => {
  const f = fixture(); await f.ready(); await f.controller.setGate(gate()); await f.controller.openGate(commitment);
  await f.approve(() => f.controller.reviewEvent({ ...event, contractAddress: '77'.repeat(32) }));
  assert.equal(f.controller.getSnapshot().event?.contractAddress, event.contractAddress);
  assert.equal(f.controller.getSnapshot().gateContext?.status, 'open');
  assert.equal(f.controller.getSnapshot().gateContext?.requestId, 'synthetic-review-request');
  assert.ok(f.controller.getSnapshot().error);
});

test('walletless verification uses fixed official readers and confers no wallet, custody, or admission', async () => {
  const f = fixture(); await f.ready(); await f.controller.readPublicEvent(commitment);
  assert.deepEqual(f.calls, [['preview', 'https://indexer.preview.midnight.network/api/v4/graphql', 'wss://indexer.preview.midnight.network/api/v4/graphql/ws']]);
  const view = f.controller.getSnapshot();
  assert.equal(view.publicVerified, true); assert.equal(view.state?.passStatus, 'ACTIVE');
  assert.equal(view.connected, false); assert.equal(view.joined, false); assert.equal(view.custodyReady, false); assert.equal(view.admission, undefined);
});

test('locking during walletless verification prevents late public readiness resurrection', async () => {
  const pending = deferred<PublicStateSnapshot>(); const f = fixture(() => pending.promise); await f.ready();
  const work = f.controller.readPublicEvent(commitment); f.controller.disconnect(); pending.resolve(state); await work;
  const view = f.controller.getSnapshot();
  assert.equal(view.publicVerified, false); assert.equal(view.state, undefined); assert.equal(view.publicCheckedAt, undefined); assert.equal(view.admission, undefined);
});

test('failed public recheck removes previous ACTIVE readiness and does not leak provider error details', async () => {
  const f = fixture(); await f.ready(); await f.controller.readPublicEvent(commitment);
  f.sdk.verifyPublicEvent = async () => { throw new Error('synthetic-sensitive-provider-fragment'); };
  await f.controller.readPublicEvent(commitment);
  const view = f.controller.getSnapshot();
  assert.equal(view.publicVerified, false); assert.equal(view.state, undefined); assert.equal(view.publicCheckedAt, undefined);
  assert.equal(view.error.includes('synthetic-sensitive-provider-fragment'), false);
});

const txId = '66'.repeat(33);
function redemptionReceipt() {
  return { schema: 'midnight-event-pass-receipt-v1' as const, network: 'preview' as const, action: 'redeem' as const, contractAddress: event.contractAddress, eventId: event.eventId, commitment, txId, identifiers: [txId], txHash: '77'.repeat(32), blockHash: '88'.repeat(32), blockHeight: 8, blockTimestamp: 1, transactionStatus: 'SucceedEntirely' as const, stateCheck: 'verified-at-finalized-block' as const, publicState: { ...state, redeemedCount: '1', passStatus: 'USED' as const } };
}
async function recoveryFixture(options: { openingUnknown?: boolean; expiresAt?: number } = {}) {
  const f = fixture(); await f.ready();
  let wire = { requestId: 'synthetic-review-request', ...event, commitment, gateId: 'synthetic-gate', openedAt: Date.now() - 1000, expiresAt: options.expiresAt ?? Date.now() + 60_000, baselineBlockHash: '55'.repeat(32), baselineBlockHeight: 7, status: 'open' as string, txId: undefined as string | undefined };
  let code = 'pending', admit = false, claims = 0, rejectClaim = true;
  const client: GateClient = {
    ...gate(),
    openRedemption: async input => { if (options.openingUnknown) throw new Error('Synthetic response lost'); return { admit: false, code: 'opened', attempt: { ...wire, ...input } }; },
    // This explicit cast lets a negative test exercise malformed external truth values.
    readRedemption: async () => ({ admit, code, attempt: { ...wire }, ...(code === 'claimed' ? { receipt: redemptionReceipt() } : {}) }) as Awaited<ReturnType<NonNullable<GateClient['readRedemption']>>>,
    claimRedemption: async input => { claims++; if (rejectClaim) throw new Error('Synthetic response lost'); return { admit: true, code: 'admitted', requestId: input.requestId, receipt: redemptionReceipt() }; },
  };
  await f.controller.setGate(client); await f.controller.openGate(commitment);
  return { ...f, wire: () => wire, setWire: (changes: Partial<typeof wire>) => { wire = { ...wire, ...changes }; }, setCode: (value: string) => { code = value; }, setAdmit: (value: boolean) => { admit = value; }, allowClaim: () => { rejectClaim = false; }, claims: () => claims };
}

test('lost opening is recovered only as the exact public request and never an admission', async () => {
  const f = await recoveryFixture({ openingUnknown: true });
  assert.equal(f.controller.getSnapshot().gateContext?.status, 'unknown');
  await f.controller.readGate('synthetic-review-request');
  const view = f.controller.getSnapshot();
  assert.equal(view.gateContext?.status, 'open'); assert.equal(view.gateContext?.baselineBlockHeight, 7);
  assert.equal(view.admission?.admit, false); assert.equal(f.claims(), 0);
});

test('strict gate recovery refuses event, request, commitment, baseline, expiry and bound-transaction drift', async () => {
  const changes = [
    { requestId: 'different-request' }, { network: 'preprod' }, { contractAddress: '99'.repeat(32) },
    { eventId: '99'.repeat(32) }, { issuerCommitment: '99'.repeat(32) }, { commitment: '99'.repeat(32) },
    { baselineBlockHash: '99'.repeat(32) }, { baselineBlockHeight: 9 }, { expiresAt: Date.now() + 500_000 }, { txId: '99'.repeat(33) },
  ];
  for (const change of changes) {
    const f = await recoveryFixture(); await f.controller.claimGate('synthetic-review-request', txId);
    const before = f.controller.getSnapshot().gateContext;
    f.setWire({ status: 'bound', txId, ...change } as Parameters<typeof f.setWire>[0]);
    await f.controller.readGate('synthetic-review-request');
    assert.deepEqual(f.controller.getSnapshot().gateContext, before, JSON.stringify(change));
    assert.notEqual(f.controller.getSnapshot().admission?.admit, true, JSON.stringify(change));
    assert.ok(f.controller.getSnapshot().error, JSON.stringify(change)); assert.equal(f.claims(), 1);
  }
});

test('an expired read with an open backend row closes local context without granting entry', async () => {
  const f = await recoveryFixture({ expiresAt: Date.now() - 1 }); f.setCode('expired');
  await f.controller.readGate('synthetic-review-request');
  assert.equal(f.controller.getSnapshot().gateContext?.status, 'closed');
  assert.equal(f.controller.getSnapshot().admission?.admit, false); assert.equal(f.claims(), 0);
});

test('pending bound recovery preserves its candidate and permits only explicit same-request claim continuation', async () => {
  const f = await recoveryFixture(); await f.controller.claimGate('synthetic-review-request', txId);
  assert.equal(f.controller.getSnapshot().gateContext?.status, 'unknown');
  f.setWire({ status: 'bound', txId }); await f.controller.readGate('synthetic-review-request');
  const view = f.controller.getSnapshot();
  assert.equal(view.gateContext?.status, 'open'); assert.equal(view.gateContext?.txId, txId);
  assert.equal(view.admission?.admit, false); assert.equal(f.claims(), 1);
  await f.controller.claimGate('synthetic-review-request', '99'.repeat(33));
  assert.equal(f.claims(), 1); assert.notEqual(f.controller.getSnapshot().admission?.admit, true);
  f.allowClaim(); await f.controller.claimGate('synthetic-review-request', txId);
  assert.equal(f.claims(), 2); assert.equal(f.controller.getSnapshot().admission?.admit, true);
});

test('closed requests cannot reopen on a stale pending read', async () => {
  const f = await recoveryFixture(); f.allowClaim(); await f.controller.claimGate('synthetic-review-request', txId);
  assert.equal(f.controller.getSnapshot().gateContext?.status, 'closed');
  f.setWire({ status: 'bound', txId }); await f.controller.readGate('synthetic-review-request');
  assert.equal(f.controller.getSnapshot().gateContext?.status, 'closed');
  assert.notEqual(f.controller.getSnapshot().admission?.admit, true);
});

test('dismissed admission and later status recovery cannot resurrect a green entry grant', async () => {
  const f = await recoveryFixture(); f.allowClaim(); await f.controller.claimGate('synthetic-review-request', txId);
  assert.equal(f.controller.getSnapshot().admission?.admit, true);
  f.controller.dismissAdmission();
  assert.notEqual(f.controller.getSnapshot().admission?.admit, true);
  f.setWire({ status: 'claimed', txId }); f.setCode('claimed'); await f.controller.readGate('synthetic-review-request');
  assert.equal(f.controller.getSnapshot().gateContext?.status, 'closed'); assert.equal(f.controller.getSnapshot().admission?.admit, false);
});

test('a status response claiming admission cannot restore readiness or grant entry', async () => {
  const f = await recoveryFixture({ openingUnknown: true }); const before = f.controller.getSnapshot().gateContext;
  f.setAdmit(true); await f.controller.readGate('synthetic-review-request');
  assert.deepEqual(f.controller.getSnapshot().gateContext, before); assert.notEqual(f.controller.getSnapshot().admission?.admit, true);
  assert.ok(f.controller.getSnapshot().error);
});

test('lost claim before backend binding can recover open context without changing its intended transaction', async () => {
  const f = await recoveryFixture(); await f.controller.claimGate('synthetic-review-request', txId);
  assert.equal(f.controller.getSnapshot().gateContext?.status, 'unknown');
  await f.controller.readGate('synthetic-review-request');
  const view = f.controller.getSnapshot();
  assert.equal(view.gateContext?.status, 'open'); assert.equal(view.gateContext?.txId, txId);
  assert.equal(view.admission?.admit, false); assert.equal(f.claims(), 1);
  f.allowClaim(); await f.controller.claimGate('synthetic-review-request', txId);
  assert.equal(f.claims(), 2); assert.equal(f.controller.getSnapshot().admission?.admit, true);
});

test('dismissing the door during a pending claim prevents a later admission resurrection', async () => {
  const f = fixture(); await f.ready(); const pending = deferred<Awaited<ReturnType<GateClient['claimRedemption']>>>();
  await f.controller.setGate({ ...gate(), claimRedemption: () => pending.promise });
  await f.controller.openGate(commitment);
  const work = f.controller.claimGate('synthetic-review-request', txId);
  f.controller.dismissAdmission();
  pending.resolve({ admit: true, code: 'admitted', requestId: 'synthetic-review-request', receipt: redemptionReceipt() });
  await work;
  assert.notEqual(f.controller.getSnapshot().admission?.admit, true);
  assert.equal(f.controller.getSnapshot().gateContext?.requestId, 'synthetic-review-request');
  assert.equal(f.controller.getSnapshot().gateContext?.txId, txId);
});
