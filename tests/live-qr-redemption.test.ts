import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LiveController } from '../src/live/controller';
import { PUBLIC_STORAGE_KEY, type BrowserSession, type PublicReceipt, type Role, type Sdk } from '../src/live/model';
import type { PublicGateRequest } from '../src/live/handoffs';
import type { ConsentRequest } from '../src/live/consent';
import { sharedHistoryLock } from './live-history-lock-fixture';
const event = { network: 'preview' as const, contractAddress: '11'.repeat(32), eventId: '22'.repeat(32), issuerCommitment: '33'.repeat(32) };
const commitment = '44'.repeat(32), initialNow = 1_800_000_000_000;
const gateRequest = (): PublicGateRequest => ({ schema: 'guestlist-gate-request-v1', ...event, commitment, requestId: 'synthetic-gate-request-1', expiresAt: initialNow + 60_000, baselineBlockHash: '55'.repeat(32), baselineBlockHeight: 10 });
const receipt = (): PublicReceipt => ({ schema: 'midnight-event-pass-receipt-v1', network: 'preview', action: 'redeem', contractAddress: event.contractAddress, eventId: event.eventId, commitment, txId: '66'.repeat(33), identifiers: ['66'.repeat(33)], txHash: '77'.repeat(32), blockHash: '88'.repeat(32), blockHeight: 11, blockTimestamp: 1, transactionStatus: 'SucceedEntirely', stateCheck: 'verified-at-finalized-block', publicState: { eventId: event.eventId, issuerCommitment: event.issuerCommitment, issuedCount: '1', redeemedCount: '1', revokedCount: '0', passStatus: 'USED' } });

/** Fixed synthetic role/provider fixtures only. No wallet, key creation, proving,
 * private network transmission or signing is performed by these tests. */
function fixture(role: Role = 'bearer') {
  const values = new Map<string, string>();
  let options!: Parameters<Sdk['createBrowserSession']>[0], calls = 0, effects = 0;
  let deadline: number | undefined, unknown = false;
  let onReserve = () => {};
  let durable: { state: string; receipt?: PublicReceipt } | null = null;
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); if (key === PUBLIC_STORAGE_KEY && value.includes('"pending"')) onReserve(); } };
  const session = { scope: { network: 'preview', ownerAccountId: 'synthetic-owner', eventId: event.eventId, role }, configuration: { networkId: 'preview', indexerUri: 'https://synthetic.invalid/indexer', indexerWsUri: 'wss://synthetic.invalid/indexer', substrateNodeUri: 'https://synthetic.invalid/node' }, adapter: {
    join: async () => {}, redeem: async (_id: string, _commitment: Uint8Array, gate: { expiresAt: number }) => {
      calls++; deadline = gate.expiresAt;
      if (!await options.authorizeOperation({ action: 'redeem', network: 'preview', contractAddress: event.contractAddress, eventId: event.eventId, commitment, usesPrivateProver: true, proofDestination: 'synthetic owner prover', persistsMaintenanceKey: false, persistsPrivateState: true, paysDust: true })) throw new Error('Declined fixture');
      // Model the genuine SDK deadline check after its later transaction review.
      if (Date.now() >= gate.expiresAt) throw new Error('Expired fixture');
      effects++; durable = { state: unknown ? 'unknown' : 'verified', ...(unknown ? {} : { receipt: receipt() }) };
      if (unknown) throw new Error('Synthetic interrupted submission');
      return receipt();
    },
  }, checkConnection: async () => {}, close: () => {}, readAttempt: async () => durable, reconcile: async () => durable?.receipt ?? null } as unknown as BrowserSession;
  const sdk = { createBrowserSession: async (input: typeof options) => { options = input; return session; }, readChainStatus: async () => ({ network: 'preview', nodeVersion: 'synthetic', finalizedBlockHash: '88'.repeat(32), finalizedBlockHeight: 10, checkedAt: '2026-10-07T00:00:00Z' }), createReadOnlyPublicProvider: () => ({}), readPublicState: async () => receipt().publicState, derivePassCommitment: () => new Uint8Array(32).fill(0x44) } as unknown as Sdk;
  const controller = new LiveController({ storage, publicHistoryLock: sharedHistoryLock(), loadSdk: async () => sdk, assets: () => 'https://synthetic.invalid/assets/' });
  async function reviewed(work: () => Promise<void>, answer: (request: ConsentRequest) => boolean = () => true) {
    const unsubscribe = controller.consent.subscribe(() => { const request = controller.consent.getSnapshot(); if (request) queueMicrotask(() => controller.consent.respond(answer(request))); });
    try { await work(); } finally { unsubscribe(); }
  }
  async function ready() {
    await controller.load(); controller.setCustody({ role, ownerAccountId: 'synthetic-owner', eventId: event.eventId, encryptionKey: {} as CryptoKey, capability: new Uint8Array(32).fill(1) });
    await controller.connect({} as never, 'synthetic owner prover'); await controller.readNetwork(); await reviewed(() => controller.join(event));
  }
  return { controller, ready, reviewed, calls: () => calls, effects: () => effects, deadline: () => deadline, onReserve: (fn: () => void) => { onReserve = fn; }, interruptSubmission: () => { unknown = true; } };
}
test('QR redemption binds exact event/pass/request and forwards expiry to the SDK', async t => {
  t.mock.method(Date, 'now', () => initialNow); const f = fixture(); await f.ready();
  await f.reviewed(() => f.controller.redeemGateRequest(gateRequest()));
  assert.equal(f.calls(), 1); assert.equal(f.effects(), 1); assert.equal(f.deadline(), gateRequest().expiresAt);
  assert.equal(f.controller.getSnapshot().attempts[0].requestId, gateRequest().requestId);
  assert.equal(f.controller.getSnapshot().attempts[0].status, 'verified'); assert.equal(f.controller.getSnapshot().admission, undefined);
});
test('wrong identity, wrong own commitment, secrets or expired QR fail before review and reservation', async t => {
  t.mock.method(Date, 'now', () => initialNow);
  for (const change of [{ network: 'preprod' }, { contractAddress: '99'.repeat(32) }, { eventId: '99'.repeat(32) }, { issuerCommitment: '99'.repeat(32) }, { commitment: '99'.repeat(32) }, { expiresAt: initialNow }, { bearerSecret: 'synthetic-extra' }, { ownerAccountId: 'synthetic-extra' }]) {
    const f = fixture(); await f.ready(); let reviews = 0;
    await f.reviewed(() => f.controller.redeemGateRequest({ ...gateRequest(), ...change }), () => { reviews++; return true; });
    assert.equal(reviews, 0); assert.equal(f.calls(), 0); assert.equal(f.effects(), 0); assert.equal(f.controller.getSnapshot().attempts.length, 0);
  }
});
test('expiry during physical-gate consent stops before any reservation or adapter call', async t => {
  let now = initialNow; t.mock.method(Date, 'now', () => now); const f = fixture(); await f.ready();
  await f.reviewed(() => f.controller.redeemGateRequest(gateRequest()), () => { now = gateRequest().expiresAt; return true; });
  assert.equal(f.calls(), 0); assert.equal(f.effects(), 0); assert.equal(f.controller.getSnapshot().attempts.length, 0);
});
test('expiry while reserving public history fails closed before adapter invocation', async t => {
  let now = initialNow; t.mock.method(Date, 'now', () => now); const f = fixture(); await f.ready();
  f.onReserve(() => { now = gateRequest().expiresAt; });
  await f.reviewed(() => f.controller.redeemGateRequest(gateRequest()));
  assert.equal(f.calls(), 0); assert.equal(f.effects(), 0); assert.equal(f.controller.getSnapshot().attempts[0].status, 'rejected');
});
test('expiry during the later SDK transaction consent forwards the same deadline and creates no effect', async t => {
  let now = initialNow; t.mock.method(Date, 'now', () => now); const f = fixture(); await f.ready();
  await f.reviewed(() => f.controller.redeemGateRequest(gateRequest()), request => { if (request.title === 'Approve Preview redeem?') now = gateRequest().expiresAt; return true; });
  assert.equal(f.calls(), 1); assert.equal(f.effects(), 0); assert.equal(f.deadline(), gateRequest().expiresAt);
  assert.equal(f.controller.getSnapshot().attempts[0].status, 'rejected');
});
test('mutating caller input during consent cannot extend expiry or switch request identity', async t => {
  t.mock.method(Date, 'now', () => initialNow); const f = fixture(); await f.ready(); const input = gateRequest();
  await f.reviewed(() => f.controller.redeemGateRequest(input), () => { input.expiresAt += 60_000; input.requestId = 'synthetic-substitute-request'; return true; });
  assert.equal(f.calls(), 1); assert.equal(f.deadline(), gateRequest().expiresAt);
  assert.equal(f.controller.getSnapshot().attempts[0].requestId, gateRequest().requestId);
});
test('lock during review, issuer scope and raw legacy IDs cannot bypass QR context', async t => {
  t.mock.method(Date, 'now', () => initialNow);
  const f = fixture(); await f.ready(); const pending = f.controller.redeemGateRequest(gateRequest()); await Promise.resolve(); assert.ok(f.controller.consent.getSnapshot()); f.controller.disconnect(); await pending; assert.equal(f.effects(), 0); assert.equal(f.calls(), 0);
  const issuer = fixture('issuer'); await issuer.ready(); await issuer.controller.redeemGateRequest(gateRequest()); assert.equal(issuer.effects(), 0); assert.equal(issuer.calls(), 0);
  const legacy = fixture(); await legacy.ready(); await legacy.controller.redeem(gateRequest().requestId, commitment); assert.equal(legacy.effects(), 0); assert.equal(legacy.calls(), 0); assert.match(legacy.controller.getSnapshot().error, /complete event/);
});
test('unknown submission retains the original request and blocks a repeat QR redemption', async t => {
  t.mock.method(Date, 'now', () => initialNow); const f = fixture(); await f.ready(); f.interruptSubmission();
  await f.reviewed(() => f.controller.redeemGateRequest(gateRequest()));
  assert.equal(f.controller.getSnapshot().attempts[0].status, 'unknown');
  await f.reviewed(() => f.controller.redeemGateRequest(gateRequest()));
  assert.equal(f.calls(), 1); assert.equal(f.effects(), 1); assert.equal(f.controller.getSnapshot().attempts[0].requestId, gateRequest().requestId);
});
