import test from 'node:test';
import assert from 'node:assert/strict';
import { EventPassAdapter, verifyReceipt, connectOwnerSelectedWallet, connectorWalletProviders, derivePassCommitment } from '../dist/index.js';

test('retired live adapter cannot be constructed or call authorization', () => {
  let effects = 0;
  assert.throws(() => new EventPassAdapter({ authorize: () => { effects++; return true; } }), /retired/);
  assert.equal(effects, 0);
});
test('retired receipt verifier rejects even unrelated successful receipts before provider reads', async () => {
  let reads = 0;
  await assert.rejects(verifyReceipt({ queryContractState: () => { reads++; } }, { status: 'SucceedEntirely' }, {}), /retired/);
  assert.equal(reads, 0);
});
test('retired wallet entry points never connect or inspect owner wallet', async () => {
  let effects = 0;
  const wallet = { connect: () => { effects++; }, getConfiguration: () => { effects++; } };
  await assert.rejects(connectOwnerSelectedWallet(wallet, 'preview', () => { effects++; }), /retired/);
  await assert.rejects(connectorWalletProviders(wallet, 'preview'), /retired/);
  assert.equal(effects, 0);
});
test('historical Compact commitment helper remains genuine and read-only', () => {
  const result = derivePassCommitment(new Uint8Array(32).fill(1), new Uint8Array(32).fill(3));
  assert.equal(Buffer.from(result).toString('hex'), '5185c8debf55209fd26c57deed732812eba45a0081c735acd7d9a73f1ef3a038');
});
