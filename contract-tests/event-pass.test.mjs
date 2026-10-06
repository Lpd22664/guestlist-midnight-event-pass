import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import {
  LocalContractHarness, Contract, PassStatus, RT, testBytes, pureCircuits,
} from '../contracts/local-harness.mjs';

const hex = (value) => Buffer.from(value).toString('hex');
const snapshot = (h) => ({
  eventId: hex(h.ledger.eventId),
  issuerCommitment: hex(h.ledger.issuerCommitment),
  passes: Array.from(h.ledger.passes, ([key, status]) => [hex(key), status]),
  issued: h.ledger.issuedCount,
  redeemed: h.ledger.redeemedCount,
  revoked: h.ledger.revokedCount,
});
const rejectUnchanged = (h, action, message) => {
  const before = snapshot(h);
  assert.throws(action, message);
  assert.deepEqual(snapshot(h), before, 'Rejected call must not alter accepted state');
};

test('build evidence matches the exact original source and compiler-runtime pair', () => {
  const source = readFileSync(new URL('../contracts/event-pass.compact', import.meta.url));
  const manifest = JSON.parse(readFileSync(new URL('../contracts/evidence/build-manifest.json', import.meta.url)));
  const info = JSON.parse(readFileSync(new URL('../contracts/generated/event-pass/compiler/contract-info.json', import.meta.url)));
  assert.equal(manifest.sourceSha256, createHash('sha256').update(source).digest('hex'));
  assert.equal(info['compiler-version'], '0.31.1');
  assert.equal(info['runtime-version'], '0.16.0');
  assert.deepEqual(info.circuits.filter((c) => c.proof).map((c) => c.name), ['issue', 'revoke', 'redeem']);
});

test('constructor fixes one event and one secret-derived issuer with empty counters', () => {
  const h = new LocalContractHarness();
  assert.deepEqual(h.ledger.eventId, testBytes(1));
  assert.deepEqual(h.ledger.issuerCommitment, pureCircuits.deriveIssuerCommitment(testBytes(1), testBytes(2)));
  assert.equal(h.ledger.passes.size(), 0n);
  assert.equal(h.ledger.issuedCount, 0n);
  assert.equal(h.ledger.redeemedCount, 0n);
  assert.equal(h.ledger.revokedCount, 0n);
});

test('issuer issues an active pass; bearer atomically consumes it once', () => {
  const h = new LocalContractHarness();
  const commitment = h.commitment();
  const issue = h.call('issue', commitment);
  assert.equal(h.ledger.passes.lookup(commitment), PassStatus.ACTIVE);
  assert.equal(h.ledger.issuedCount, 1n);
  assert.ok(issue.proofData.publicTranscript.length > 0);
  const redeem = h.call('redeem', commitment);
  assert.deepEqual(redeem.result, []);
  assert.equal(h.ledger.passes.lookup(commitment), PassStatus.USED);
  assert.equal(h.ledger.redeemedCount, 1n);
  rejectUnchanged(h, () => h.call('redeem', commitment), /Pass is not active/);
});

test('issuer revokes an active pass; correct bearer can no longer use it', () => {
  const h = new LocalContractHarness();
  const commitment = h.commitment();
  h.call('issue', commitment);
  h.call('revoke', commitment);
  assert.equal(h.ledger.passes.lookup(commitment), PassStatus.REVOKED);
  assert.equal(h.ledger.revokedCount, 1n);
  rejectUnchanged(h, () => h.call('redeem', commitment), /Pass is not active/);
  rejectUnchanged(h, () => h.call('revoke', commitment), /Only active passes can be revoked/);
});

test('wrong issuer secret cannot issue or revoke, even with the correct bearer', () => {
  const h = new LocalContractHarness();
  const commitment = h.commitment();
  const attacker = { ...h.privateState, issuerSecret: testBytes(8) };
  rejectUnchanged(h, () => h.call('issue', commitment, attacker), /Issuer authorization failed/);
  h.call('issue', commitment);
  rejectUnchanged(h, () => h.call('revoke', commitment, attacker), /Issuer authorization failed/);
});

test('wrong bearer secret cannot consume an otherwise active pass', () => {
  const h = new LocalContractHarness();
  const commitment = h.commitment();
  h.call('issue', commitment);
  rejectUnchanged(h, () => h.call('redeem', commitment, { ...h.privateState, bearerSecret: testBytes(9) }), /Bearer authorization failed/);
  assert.equal(h.ledger.passes.lookup(commitment), PassStatus.ACTIVE);
});

for (const transition of ['active', 'used', 'revoked']) {
  test(`permanent tombstone rejects reissuance of a ${transition} pass`, () => {
    const h = new LocalContractHarness();
    const commitment = h.commitment();
    h.call('issue', commitment);
    if (transition === 'used') h.call('redeem', commitment);
    if (transition === 'revoked') h.call('revoke', commitment);
    rejectUnchanged(h, () => h.call('issue', commitment), /Pass has already been issued/);
  });
}

test('unissued valid commitment cannot be redeemed or revoked', () => {
  const h = new LocalContractHarness();
  const commitment = h.commitment();
  rejectUnchanged(h, () => h.call('redeem', commitment), /Pass has not been issued/);
  rejectUnchanged(h, () => h.call('revoke', commitment), /Pass has not been issued/);
});

test('used pass cannot be revoked or resurrected', () => {
  const h = new LocalContractHarness();
  const commitment = h.commitment();
  h.call('issue', commitment);
  h.call('redeem', commitment);
  rejectUnchanged(h, () => h.call('revoke', commitment), /Only active passes can be revoked/);
});

test('event binding and domain separation prevent bearer/issuer reuse', () => {
  const id = testBytes(1);
  const secret = testBytes(3);
  const first = pureCircuits.derivePassCommitment(id, secret);
  assert.deepEqual(first, pureCircuits.derivePassCommitment(id, secret));
  assert.notDeepEqual(first, pureCircuits.derivePassCommitment(testBytes(4), secret));
  assert.notDeepEqual(first, pureCircuits.deriveIssuerCommitment(id, secret));
  const anotherEvent = new LocalContractHarness({ eventId: testBytes(4), bearerSecret: secret });
  anotherEvent.call('issue', first);
  rejectUnchanged(anotherEvent, () => anotherEvent.call('redeem', first), /Bearer authorization failed/);
});

test('a second distinct pass remains usable after the first is consumed', () => {
  const h = new LocalContractHarness();
  const first = h.commitment();
  const secondSecret = testBytes(4);
  const second = h.commitment(secondSecret);
  h.call('issue', first);
  h.call('issue', second);
  h.call('redeem', first);
  assert.equal(h.ledger.passes.lookup(second), PassStatus.ACTIVE);
  h.call('redeem', second, { ...h.privateState, bearerSecret: secondSecret });
  assert.equal(h.ledger.issuedCount, 2n);
  assert.equal(h.ledger.redeemedCount, 2n);
  assert.equal(h.ledger.passes.size(), 2n);
});

test('fixed public state contains only commitments and status, never raw secrets', () => {
  const h = new LocalContractHarness();
  h.call('issue', h.commitment());
  h.call('redeem', h.commitment());
  const publicState = snapshot(h);
  const encoded = JSON.stringify(publicState, (_, value) => typeof value === 'bigint' ? value.toString() : value);
  assert.ok(!encoded.includes(hex(testBytes(2))), 'Issuer secret is absent from decoded public ledger');
  assert.ok(!encoded.includes(hex(testBytes(3))), 'Bearer secret is absent from decoded public ledger');
  assert.equal(publicState.passes[0][0], hex(h.commitment()));
  // This checks the ledger schema, not an anonymity property or proof privacy.
});

test('bearer redeem intentionally does not require issuer credential', () => {
  const h = new LocalContractHarness();
  const commitment = h.commitment();
  h.call('issue', commitment);
  h.call('redeem', commitment, { ...h.privateState, issuerSecret: testBytes(9) });
  assert.equal(h.ledger.passes.lookup(commitment), PassStatus.USED);
});

test('zero credentials/commitments and malformed byte inputs are rejected', () => {
  assert.throws(() => new LocalContractHarness({ eventId: testBytes(0) }), /Event ID cannot be zero/);
  assert.throws(() => new LocalContractHarness({ issuerSecret: testBytes(0) }), /Issuer secret cannot be zero/);
  const h = new LocalContractHarness();
  rejectUnchanged(h, () => h.call('issue', testBytes(0)), /Pass commitment cannot be zero/);
  rejectUnchanged(h, () => h.call('issue', new Uint8Array(31)), /32|Bytes|Uint8Array/);
  rejectUnchanged(h, () => h.call('issue', h.commitment(), { ...h.privateState, issuerSecret: testBytes(0) }), /Issuer secret cannot be zero/);
  const commitment = h.commitment();
  h.call('issue', commitment);
  rejectUnchanged(h, () => h.call('redeem', commitment, { ...h.privateState, bearerSecret: testBytes(0) }), /Bearer secret cannot be zero/);
});

test('contract rejects missing witnesses and incomplete circuit context', () => {
  assert.throws(() => new Contract({}), /issuerSecret/);
  const h = new LocalContractHarness();
  assert.throws(() => h.contract.impureCircuits.issue({}, h.commitment()));
  assert.equal(h.ledger.passes.size(), 0n);
  assert.ok(RT.createCircuitContext);
});

test('serial duplicate gate attempts have exactly one accepted state transition', () => {
  const h = new LocalContractHarness();
  const commitment = h.commitment();
  h.call('issue', commitment);
  const outcomes = Array.from({ length: 5 }, () => {
    try { h.call('redeem', commitment); return 'accepted'; }
    catch { return 'rejected'; }
  });
  assert.deepEqual(outcomes, ['accepted', 'rejected', 'rejected', 'rejected', 'rejected']);
  assert.equal(h.ledger.redeemedCount, 1n);
  // Two proofs computed from the SAME stale ACTIVE state can both pass locally.
  // Real simultaneous-state conflict testing requires a node + finalization.
});

test('local calls against stale ACTIVE snapshots are not consensus finality', () => {
  const h = new LocalContractHarness();
  const commitment = h.commitment();
  h.call('issue', commitment);
  const staleContextA = h.context();
  const staleContextB = h.context();
  const first = h.contract.impureCircuits.redeem(staleContextA, commitment);
  const second = h.contract.impureCircuits.redeem(staleContextB, commitment);
  assert.deepEqual(first.result, []);
  assert.deepEqual(second.result, []);
  assert.equal(h.ledger.passes.lookup(commitment), PassStatus.ACTIVE);
  // The harness has adopted neither snapshot. Both local computations can
  // succeed; admitting two attendees on this signal alone would be unsafe.
});
