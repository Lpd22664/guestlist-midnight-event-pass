import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { DemoService } from '../src/demo-service';
import { applyCommand, createDemoState, encodeCredential, EVENT, type Command, type DemoState } from '../src/domain';
import { clone, issue, MemoryStorage, NOW, readyPass, rejectsCode, secret, STORAGE_KEY } from './helpers';

async function serviceAtFixedTime(t: TestContext, storage: Storage | undefined = new MemoryStorage(), latency = 0) {
  t.mock.timers.enable({ apis: ['Date'], now: NOW.getTime() });
  t.after(() => t.mock.timers.reset());
  const service = new DemoService(storage, latency);
  await service.initialise();
  return service;
}
function stored(storage: Storage): DemoState { return JSON.parse(storage.getItem(STORAGE_KEY)!); }
async function savedFixture() { const state = await createDemoState(); state.revision = 5; return state; }

test('initialisation writes fresh synthetic data and reloads a valid saved ledger', async t => {
  const storage = new MemoryStorage();
  const first = await serviceAtFixedTime(t, storage);
  assert.equal(storage.writes, 1);
  assert.deepEqual(stored(storage), first.state);
  await first.execute(issue(), 'organiser', 'synthetic-persist');
  const second = new DemoService(storage, 0);
  await second.initialise();
  assert.deepEqual(second.state, first.state);
  assert.equal(second.storageWarning, '');
  assert.equal(second.state.passes.at(-1)!.issuedAt, NOW.toISOString());
  assert.equal(second.state.requests['synthetic-persist'].receipt.mode, 'demo');
});

test('missing storage supports in-memory issue, redeem, revoke, and reset', async t => {
  const service = await serviceAtFixedTime(t, undefined);
  await service.execute(issue(), 'organiser', 'synthetic-memory-issue');
  const issued = service.state.passes.at(-1)!;
  await service.execute({ type: 'redeem', credential: encodeCredential(issued) }, 'attendee', 'synthetic-memory-redeem');
  assert.equal(service.state.passes.at(-1)!.status, 'used');
  await service.execute({ type: 'revoke', passId: readyPass(service.state).id }, 'organiser', 'synthetic-memory-revoke');
  assert.equal(service.state.revision, 3);
  await service.reset();
  assert.deepEqual(service.state, { ...await createDemoState(), revision: 4 });
});

test('storage read failure reports fresh synthetic fallback and stays usable', async t => {
  const storage = new MemoryStorage(); storage.readError = true;
  const service = await serviceAtFixedTime(t, storage);
  assert.match(service.storageWarning, /could not be read/);
  assert.deepEqual(service.state, await createDemoState());
  await service.execute(issue(), 'organiser', 'synthetic-read-fallback');
  assert.equal(service.state.revision, 1);
});

test('storage write failure truthfully warns while preserving usable in-memory state', async t => {
  const storage = new MemoryStorage(); storage.writeError = true;
  const service = await serviceAtFixedTime(t, storage);
  assert.match(service.storageWarning, /storage is unavailable/);
  await service.execute(issue(), 'organiser', 'synthetic-write-fallback');
  assert.equal(service.state.revision, 1);
  assert.equal(service.state.passes.length, 19);
  assert.equal(storage.length, 0);
});

test('storage write failure after successful persistence does not roll back the action', async t => {
  const storage = new MemoryStorage();
  const service = await serviceAtFixedTime(t, storage);
  storage.writeError = true;
  await service.execute(issue(), 'organiser', 'synthetic-write-failure');
  assert.equal(service.state.revision, 1);
  assert.equal(stored(storage).revision, 0);
  assert.match(service.storageWarning, /storage is unavailable/);
});

test('persistent write failure cannot resync stale storage over unsaved in-memory actions', async t => {
  const storage = new MemoryStorage();
  const service = await serviceAtFixedTime(t, storage);
  storage.writeError = true;
  await service.execute(issue(100), 'organiser', 'synthetic-unsaved-a');
  await service.execute(issue(101), 'organiser', 'synthetic-unsaved-b');
  assert.equal(service.state.passes.length, 20);
  assert.equal(service.state.revision, 2);
  assert.deepEqual(Object.keys(service.state.requests), ['synthetic-unsaved-a', 'synthetic-unsaved-b']);
  storage.writeError = false;
  await service.execute(issue(102), 'organiser', 'synthetic-unsaved-recovery');
  assert.equal(service.state.revision, 3);
  assert.equal(service.state.passes.length, 21);
  assert.deepEqual(stored(storage), service.state);
});

for (const [name, raw] of [['invalid JSON', '{broken'], ['null', 'null'], ['array', '[]'], ['empty object', '{}']] as const) test(`initialisation recovers from ${name} storage`, async t => {
  const storage = new MemoryStorage(); storage.setItem(STORAGE_KEY, raw);
  const service = await serviceAtFixedTime(t, storage);
  assert.match(service.storageWarning, /could not be read/);
  assert.deepEqual(service.state, await createDemoState());
  assert.deepEqual(stored(storage), service.state);
});

const invalidSavedStates: Array<[string, (state: DemoState) => void]> = [
  ['wrong version', state => { (state as unknown as { version: number }).version = 2; }],
  ['wrong event', state => { state.eventId = 'synthetic-other-event'; }],
  ['fractional revision', state => { state.revision = 0.5; }],
  ['negative revision', state => { state.revision = -1; }],
  ['missing pass array', state => { delete (state as Partial<DemoState>).passes; }],
  ['null pass', state => { (state.passes as unknown[])[0] = null; }],
  ['invalid pass ID', state => { state.passes[0].id = 'invalid'; }],
  ['mismatching ID and commitment', state => { state.passes[0].commitment = secret(999); }],
  ['invalid secret', state => { state.passes[0].secret = 'invalid'; }],
  ['missing sequence', state => { delete (state.passes[0] as Partial<DemoState['passes'][number]>).sequence; }],
  ['fractional sequence', state => { state.passes[0].sequence = 1.5; }],
  ['zero sequence', state => { state.passes[0].sequence = 0; }],
  ['invalid pass type', state => { state.passes[0].type = 'VIP' as 'Guest'; }],
  ['non-string label', state => { (state.passes[0] as unknown as { label: number }).label = 42; }],
  ['invalid status', state => { state.passes[0].status = 'expired' as 'ready'; }],
  ['invalid issued time', state => { state.passes[0].issuedAt = 'invalid'; }],
  ['invalid expiry', state => { state.passes[0].expiresAt = 'invalid'; }],
  ['missing activity array', state => { delete (state as Partial<DemoState>).activity; }],
  ['null activity entry', state => { (state.activity as unknown[])[0] = null; }],
  ['invalid activity type', state => { state.activity[0].type = 'delete' as 'issue'; }],
  ['invalid activity time', state => { state.activity[0].at = 'invalid'; }],
  ['null requests', state => { (state as unknown as { requests: null }).requests = null; }],
  ['array requests', state => { (state as unknown as { requests: unknown[] }).requests = []; }],
  ['null request record', state => { (state.requests as Record<string, unknown>).broken = null; }],
  ['missing request fingerprint', state => { (state.requests as Record<string, unknown>).broken = { receipt: {} }; }],
  ['invalid request fingerprint', state => { (state.requests as Record<string, unknown>).broken = { fingerprint: 'invalid', receipt: {} }; }],
  ['invalid request receipt', state => { (state.requests as Record<string, unknown>).broken = { fingerprint: secret(101), receipt: null }; }],
  ['non-demo receipt', state => { (state.requests as Record<string, unknown>).broken = { fingerprint: secret(101), receipt: { mode: 'chain', operationId: 'demo-broken', type: 'issue', passId: state.passes[0].id, status: 'verified-locally', at: NOW.toISOString() } }; }],
];
for (const [name, corrupt] of invalidSavedStates) test(`saved-state validation rejects ${name} and recovers to operable data`, async t => {
  const storage = new MemoryStorage();
  const state = await savedFixture(); corrupt(state); storage.setItem(STORAGE_KEY, JSON.stringify(state));
  const service = await serviceAtFixedTime(t, storage);
  assert.match(service.storageWarning, /could not be read/);
  assert.deepEqual(service.state, await createDemoState());
  await service.execute(issue(), 'organiser', `synthetic-corrupt-${name}`);
  assert.equal(service.state.revision, 1);
  assert.equal(service.state.passes.length, 19);
});

test('resync adopts another valid revision and notifies listeners once', async t => {
  const storage = new MemoryStorage();
  const service = await serviceAtFixedTime(t, storage);
  let notifications = 0; service.subscribe(() => notifications++);
  const remote = (await applyCommand(service.state, issue(), 'organiser', 'synthetic-remote', NOW)).state;
  storage.setItem(STORAGE_KEY, JSON.stringify(remote));
  service.sync();
  assert.deepEqual(service.state, remote);
  assert.equal(notifications, 1);
  service.sync();
  assert.equal(notifications, 1);
});

test('execute resyncs before applying a new command so a previous tab change is retained', async t => {
  const storage = new MemoryStorage();
  const service = await serviceAtFixedTime(t, storage);
  const remote = (await applyCommand(service.state, issue(100), 'organiser', 'synthetic-tab-a', NOW)).state;
  storage.setItem(STORAGE_KEY, JSON.stringify(remote));
  await service.execute(issue(101), 'organiser', 'synthetic-tab-b');
  assert.equal(service.state.revision, 2);
  assert.equal(service.state.passes.length, 20);
  assert.deepEqual(Object.keys(service.state.requests).sort(), ['synthetic-tab-a', 'synthetic-tab-b']);
  assert.deepEqual(stored(storage), service.state);
});

test('resync retains in-memory data on missing, corrupt, invalid, and unreadable storage', async t => {
  const storage = new MemoryStorage();
  const service = await serviceAtFixedTime(t, storage);
  await service.execute(issue(), 'organiser', 'synthetic-before-corruption');
  const before = clone(service.state);
  let notifications = 0; service.subscribe(() => notifications++);
  for (const raw of ['{broken', 'null', JSON.stringify({ ...before, eventId: 'synthetic-other-event', revision: 99 }), JSON.stringify({ ...before, requests: null, revision: 99 })]) {
    storage.setItem(STORAGE_KEY, raw); service.sync(); assert.deepEqual(service.state, before);
  }
  storage.removeItem(STORAGE_KEY); service.sync(); assert.deepEqual(service.state, before);
  storage.readError = true; service.sync(); assert.deepEqual(service.state, before);
  assert.equal(notifications, 0);
});

test('a remote synthetic reset is adopted even though its revision restarts at zero', async t => {
  const storage = new MemoryStorage();
  const service = await serviceAtFixedTime(t, storage);
  await service.execute(issue(), 'organiser', 'synthetic-before-reset');
  const reset = await createDemoState(); storage.setItem(STORAGE_KEY, JSON.stringify(reset));
  service.sync();
  assert.deepEqual(service.state, reset);
});

test('subscription cleanup removes a listener without affecting other listeners', async t => {
  const service = await serviceAtFixedTime(t);
  let first = 0, second = 0;
  const unsubscribe = service.subscribe(() => first++); service.subscribe(() => second++);
  await service.execute(issue(100), 'organiser', 'synthetic-subscribed');
  unsubscribe(); unsubscribe();
  await service.execute(issue(101), 'organiser', 'synthetic-unsubscribed');
  assert.equal(first, 1); assert.equal(second, 2);
});

test('rapid repeated issue using one request ID returns one receipt without duplicate state', async t => {
  const service = await serviceAtFixedTime(t);
  const receipts = await Promise.all(Array.from({ length: 16 }, () => service.execute(issue(), 'organiser', 'synthetic-rapid-idempotent')));
  for (const receipt of receipts) assert.deepEqual(receipt, receipts[0]);
  assert.equal(service.state.passes.length, 19);
  assert.equal(service.state.revision, 1);
  assert.equal(service.state.activity.filter(item => item.id === 'synthetic-rapid-idempotent').length, 1);
  assert.equal(Object.keys(service.state.requests).length, 1);
});

test('rapid duplicate issue with distinct request IDs succeeds once and rejects the duplicates', async t => {
  const service = await serviceAtFixedTime(t);
  const results = await Promise.allSettled(Array.from({ length: 12 }, (_, index) => service.execute(issue(), 'organiser', `synthetic-rapid-duplicate-${index}`)));
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  for (const result of results) if (result.status === 'rejected') assert.equal(result.reason.code, 'duplicate');
  assert.equal(service.state.passes.length, 19);
  assert.equal(service.state.revision, 1);
});

test('rapid unique issues stay serial, retain all passes, and have unique increasing numbers', async t => {
  const service = await serviceAtFixedTime(t);
  const receipts = await Promise.all(Array.from({ length: 20 }, (_, index) => service.execute(issue(100 + index), 'organiser', `synthetic-rapid-unique-${index}`)));
  assert.equal(service.state.revision, 20);
  assert.equal(service.state.passes.length, 38);
  assert.equal(new Set(receipts.map(receipt => receipt.operationId)).size, 20);
  assert.equal(new Set(service.state.passes.map(pass => pass.id)).size, 38);
  assert.deepEqual(service.state.passes.slice(18).map(pass => pass.sequence), Array.from({ length: 20 }, (_, index) => 19 + index));
});

test('rapid repeated redemption permits exactly one use and leaves no duplicate audit record', async t => {
  const service = await serviceAtFixedTime(t);
  const pass = readyPass(service.state);
  const command: Command = { type: 'redeem', credential: encodeCredential(pass) };
  const results = await Promise.allSettled(Array.from({ length: 12 }, (_, index) => service.execute(command, 'attendee', `synthetic-rapid-redeem-${index}`)));
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  for (const result of results) if (result.status === 'rejected') assert.equal(result.reason.code, 'used');
  assert.equal(service.state.revision, 1);
  assert.equal(service.state.activity.filter(item => item.type === 'redeem' && item.passId === pass.id).length, 1);
});

test('a queue failure does not poison later valid actions or reset', async t => {
  const service = await serviceAtFixedTime(t);
  const failure = service.execute(issue(), 'attendee', 'synthetic-queued-failure');
  const success = service.execute(issue(101), 'organiser', 'synthetic-after-failure');
  await rejectsCode(() => failure, 'unauthorised');
  await success;
  assert.equal(service.state.revision, 1);
  await service.reset();
  await service.execute(issue(102), 'organiser', 'synthetic-after-reset');
  assert.equal(service.state.revision, 3);
  assert.equal(service.state.passes.at(-1)!.secret, secret(102));
});

test('service request conflict leaves state and saved ledger unchanged; a later command succeeds', async t => {
  const storage = new MemoryStorage();
  const service = await serviceAtFixedTime(t, storage);
  await service.execute(issue(), 'organiser', 'synthetic-service-conflict');
  const before = clone(service.state), saved = storage.getItem(STORAGE_KEY), writes = storage.writes;
  await rejectsCode(() => service.execute(issue(101), 'organiser', 'synthetic-service-conflict'), 'request-conflict');
  assert.deepEqual(service.state, before); assert.equal(storage.getItem(STORAGE_KEY), saved); assert.equal(storage.writes, writes);
  await service.execute(issue(101), 'organiser', 'synthetic-service-after-conflict');
  assert.equal(service.state.revision, 2);
});

test('reset runs after queued changes, clears all synthetic changes, saves, and notifies', async t => {
  const storage = new MemoryStorage();
  const service = await serviceAtFixedTime(t, storage, 5);
  let notifications = 0; service.subscribe(() => notifications++);
  const action = service.execute(issue(), 'organiser', 'synthetic-before-queued-reset');
  const reset = service.reset();
  await Promise.all([action, reset]);
  assert.deepEqual(service.state, { ...await createDemoState(), revision: 2 });
  assert.deepEqual(stored(storage), service.state);
  assert.equal(notifications, 2);
  assert.deepEqual(service.state.requests, {});
});

test('reset storage failure preserves fresh synthetic state and reports the limitation', async t => {
  const storage = new MemoryStorage();
  const service = await serviceAtFixedTime(t, storage);
  await service.execute(issue(), 'organiser', 'synthetic-before-failed-reset');
  storage.writeError = true;
  await service.reset();
  assert.deepEqual(service.state, { ...await createDemoState(), revision: 2 });
  assert.match(service.storageWarning, /storage is unavailable/);
});

test('Web Locks path acquires the shared preview-ledger lock for every command', async t => {
  const locksDescriptor = Object.getOwnPropertyDescriptor(navigator, 'locks');
  const requested: string[] = [];
  Object.defineProperty(navigator, 'locks', { configurable: true, value: { request: async (name: string, fn: () => unknown) => { requested.push(name); return fn(); } } });
  t.after(() => { if (locksDescriptor) Object.defineProperty(navigator, 'locks', locksDescriptor); else Reflect.deleteProperty(navigator, 'locks'); });
  const service = await serviceAtFixedTime(t);
  await Promise.all([service.execute(issue(100), 'organiser', 'synthetic-lock-a'), service.execute(issue(101), 'organiser', 'synthetic-lock-b')]);
  assert.deepEqual(requested, ['guestlist-preview-ledger', 'guestlist-preview-ledger']);
  assert.equal(service.state.revision, 2);
  assert.equal(service.state.passes.length, 20);
});

test('two service instances with a shared Web Lock retain concurrent changes', async t => {
  const descriptor = Object.getOwnPropertyDescriptor(navigator, 'locks');
  let lockQueue: Promise<unknown> = Promise.resolve();
  Object.defineProperty(navigator, 'locks', { configurable: true, value: { request: (_name: string, fn: () => unknown) => { const result = lockQueue.then(fn, fn); lockQueue = result.catch(() => undefined); return result; } } });
  t.after(() => { if (descriptor) Object.defineProperty(navigator, 'locks', descriptor); else Reflect.deleteProperty(navigator, 'locks'); });
  const storage = new MemoryStorage();
  const first = await serviceAtFixedTime(t, storage), second = new DemoService(storage, 0); await second.initialise();
  await Promise.all([first.execute(issue(100), 'organiser', 'synthetic-shared-a'), second.execute(issue(101), 'organiser', 'synthetic-shared-b')]);
  first.sync();
  assert.equal(first.state.revision, 2);
  assert.equal(first.state.passes.length, 20);
  assert.deepEqual(first.state, second.state);
  assert.deepEqual(stored(storage), first.state);
});

test('reset followed by issue in another tab cannot reuse a revision and overwrite post-reset work', async t => {
  const storage = new MemoryStorage();
  const first = await serviceAtFixedTime(t, storage), second = new DemoService(storage, 0); await second.initialise();
  await first.execute(issue(800), 'organiser', 'before-reset');
  await second.reset();
  assert.equal(second.state.revision, 2);
  await second.execute(issue(801), 'organiser', 'after-reset');
  first.sync();
  assert.deepEqual(first.state, second.state);
  await first.execute(issue(802), 'organiser', 'after-sync');
  assert.ok(stored(storage).passes.some(p => p.secret === secret(801)));
  assert.ok(!stored(storage).passes.some(p => p.secret === secret(800)));
});

test('resync also accepts a changed same-revision legacy snapshot', async t => {
  const storage = new MemoryStorage();
  const service = await serviceAtFixedTime(t, storage);
  await service.execute(issue(800), 'organiser', 'old-snapshot');
  const remote = (await applyCommand(await createDemoState(), issue(801), 'organiser', 'legacy-reset-issue', NOW)).state;
  assert.equal(remote.revision, service.state.revision);
  storage.setItem(STORAGE_KEY, JSON.stringify(remote));
  service.sync();
  assert.deepEqual(service.state, remote);
});

test('reset acquires the same shared Web Lock as issue and redemption', async t => {
  const descriptor = Object.getOwnPropertyDescriptor(navigator, 'locks');
  const requested: string[] = [];
  Object.defineProperty(navigator, 'locks', { configurable: true, value: { request: async (name: string, fn: () => unknown) => { requested.push(name); return fn(); } } });
  t.after(() => { if (descriptor) Object.defineProperty(navigator, 'locks', descriptor); else Reflect.deleteProperty(navigator, 'locks'); });
  const service = await serviceAtFixedTime(t);
  await service.execute(issue(), 'organiser', 'lock-before-reset');
  await service.reset();
  assert.deepEqual(requested, ['guestlist-preview-ledger', 'guestlist-preview-ledger']);
  assert.equal(service.state.revision, 2);
});

test('portfolio preview still issues and redeems when visitor wall clock is years after the fixture', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2030-01-01T12:00:00Z') });
  t.after(() => t.mock.timers.reset());
  const service = new DemoService(new MemoryStorage(), 0); await service.initialise();
  await service.execute(issue(900), 'organiser', 'future-visitor-issue');
  const pass = service.state.passes.at(-1)!;
  assert.equal(pass.issuedAt, NOW.toISOString());
  await service.execute({ type: 'redeem', credential: encodeCredential(pass) }, 'attendee', 'future-visitor-redeem');
  assert.equal(service.state.passes.at(-1)!.status, 'used');
});
