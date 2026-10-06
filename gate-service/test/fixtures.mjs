import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { GateAuth, GateStore, GateService } from '../dist/service.js';
export const KEY_A = 'synthetic-only-gate-A-key-never-for-real-use';
export const KEY_B = 'synthetic-only-gate-B-key-never-for-real-use';
export const HEAD = 'a1'.repeat(32), BLOCK = 'b2'.repeat(32), TX = 'c3'.repeat(32), ALIAS = 'd4'.repeat(32);
export const EVENT = { network: 'preview', contractAddress: '11'.repeat(32), eventId: '22'.repeat(32), issuerCommitment: '33'.repeat(32) };
export const REQUEST = { ...EVENT, requestId: 'synthetic-request-0001', commitment: '44'.repeat(32) };
export const RECEIPT = { schema: 'midnight-event-pass-receipt-v1', network: 'preview', action: 'redeem', ...EVENT,
  commitment: REQUEST.commitment, txId: TX, identifiers: [TX], txHash: 'e5'.repeat(32), blockHash: BLOCK, blockHeight: 11,
  blockTimestamp: 1_700_000_000, transactionStatus: 'SucceedEntirely', stateCheck: 'verified-at-finalized-block',
  publicState: { eventId: EVENT.eventId, issuerCommitment: EVENT.issuerCommitment, issuedCount: '1', redeemedCount: '1', revokedCount: '0', passStatus: 'USED' } };
export const AUTH_A = `Bearer ${KEY_A}`, AUTH_B = `Bearer ${KEY_B}`;
export function fixture(options = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'guestlist-gate-test-')), dbPath = join(dir, 'gate.sqlite');
  const calls = { baseline: 0, receipt: 0 };
  const reader = options.reader ?? {
    readActiveBaseline: async () => { calls.baseline++; return { hash: HEAD, height: 10 }; },
    verifyRedemption: async () => { calls.receipt++; return structuredClone(RECEIPT); },
  };
  const store = new GateStore(dbPath, options.storeOptions);
  const auth = new GateAuth({ north: KEY_A, south: KEY_B });
  const service = new GateService({ store, auth, events: [{ event: EVENT, reader }], ...options.serviceOptions });
  return { dir, dbPath, reader, store, auth, service, calls, close: () => { service.stop(); try { store.close(); } catch {} rmSync(dir, { recursive: true, force: true }); } };
}
export const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return {promise,resolve,reject}; };
