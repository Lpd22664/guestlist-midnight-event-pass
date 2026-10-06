import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { webcrypto } from 'node:crypto';
import { openOwnerStorage, BrowserZkConfigProvider, assetManifest } from '../dist/index.js';
import { readFile } from 'node:fs/promises';
import { transactionBytes } from '../dist/bytes.js';

// Synthetic cryptographic fixture keys exist ONLY in tests. Never user keys/default production custody.
const fixtureKey = (byte = 7, extractable = false) => webcrypto.subtle.importKey('raw', new Uint8Array(32).fill(byte), 'AES-GCM', extractable, ['encrypt', 'decrypt']);
const fixtureScope = { network: 'preview', ownerAccountId: 'synthetic-owner', eventId: '01'.repeat(32), role: 'issuer' };
const fixtureState = { issuerSecret: new Uint8Array(32).fill(2) };
const addressA = 'a'.repeat(64), addressB = 'b'.repeat(64);
const attempt = (id = 'synthetic-1') => ({ requestId: id, network: 'preview', eventId: fixtureScope.eventId, issuerCommitment: '04'.repeat(32), action: 'deploy', state: 'started', expiresAt: Date.now() + 60_000 });
async function store(options = {}) { return openOwnerStorage({ scope: fixtureScope, encryptionKey: await fixtureKey(), authorize: async () => true, cryptoImpl: webcrypto, indexedDBImpl: new IDBFactory(), ...options }); }

test('private storage denial creates no database and never requests a wallet/seed', async () => {
  const idb = new IDBFactory();
  await assert.rejects(store({ indexedDBImpl: idb, authorize: async () => false }), /approval/);
  assert.equal((await idb.databases()).length, 0);
});
test('vault requires explicit nonextractable AES256 custody; no address-derived/default key', async () => {
  await assert.rejects(store({ encryptionKey: undefined }), /owner-provisioned/);
  await assert.rejects(store({ encryptionKey: await fixtureKey(7, true) }), /nonextractable/);
  await assert.rejects(store({ scope: { ...fixtureScope, ownerAccountId: '' } }), /identifier/);
});
test('encrypted state survives close/reopen only with the existing owner key', async () => {
  const idb = new IDBFactory(), key = await fixtureKey();
  const s = await store({ indexedDBImpl: idb, encryptionKey: key });
  const p = s.privateStateProvider; p.setContractAddress(addressA);
  await p.set('owner:event:issuer', fixtureState);
  assert.deepEqual(await p.get('owner:event:issuer'), fixtureState);
  await p.setSigningKey(addressA, '11'.repeat(32));
  s.close();
  await assert.rejects(p.get('owner:event:issuer'), /closed/);
  const reopened = await store({ indexedDBImpl: idb, encryptionKey: key }); reopened.privateStateProvider.setContractAddress(addressA);
  assert.deepEqual(await reopened.privateStateProvider.get('owner:event:issuer'), fixtureState);
  assert.equal(await reopened.privateStateProvider.getSigningKey(addressA), '11'.repeat(32));
  reopened.close();
  const wrong = await store({ indexedDBImpl: idb, encryptionKey: await fixtureKey(8) }); wrong.privateStateProvider.setContractAddress(addressA);
  await assert.rejects(wrong.privateStateProvider.get('owner:event:issuer'), /wrong key or corrupt/); wrong.close();
});
test('vault isolates owner/network/event/role and contract/state identifiers', async () => {
  const idb = new IDBFactory(), key = await fixtureKey(), s = await store({ indexedDBImpl: idb, encryptionKey: key });
  const p = s.privateStateProvider;
  await assert.rejects(p.get('id'), /contract address/);
  p.setContractAddress(addressA); await p.set('id', fixtureState);
  p.setContractAddress(addressB); assert.equal(await p.get('id'), null);
  p.setContractAddress(addressA); assert.equal(await p.get('another-id'), null);
  for (const change of [{ ownerAccountId: 'synthetic-other-owner' }, { network: 'preprod' }, { eventId: '05'.repeat(32) }, { role: 'bearer' }]) {
    const separate = await store({ indexedDBImpl: idb, encryptionKey: key, scope: { ...fixtureScope, ...change } }); separate.privateStateProvider.setContractAddress(addressA);
    assert.equal(await separate.privateStateProvider.get('id'), null); separate.close();
  }
  s.close();
});
test('bearer vault never accepts issuer capability or maintenance authority', async () => {
  const s = await store({ scope: { ...fixtureScope, role: 'bearer' } }), p = s.privateStateProvider; p.setContractAddress(addressA);
  await assert.rejects(p.set('id', fixtureState), /role/);
  await assert.rejects(p.setSigningKey(addressA, '11'.repeat(32)), /issuer-owned/);
  const bearer = { bearerSecret: new Uint8Array(32).fill(3) }; await p.set('id', bearer); assert.deepEqual(await p.get('id'), bearer); s.close();
});
test('vault disables plaintext and unreviewed import/export recovery', async () => {
  const s = await store();
  for (const name of ['exportPrivateStates', 'exportSigningKeys', 'importPrivateStates', 'importSigningKeys']) await assert.rejects(s.privateStateProvider[name](), /secure handoff/);
  s.close();
});
test('ciphertext hides capabilities; unique IVs and scope AAD reject moved/tampered records', async () => {
  const idb = new IDBFactory(), key = await fixtureKey(), s = await store({ indexedDBImpl: idb, encryptionKey: key });
  const p = s.privateStateProvider; p.setContractAddress(addressA); await p.set('id', fixtureState); await p.set('id2', fixtureState);
  const [{ name }] = await idb.databases();
  const db = await new Promise((resolve, reject) => { const req = idb.open(name); req.onsuccess = () => resolve(req.result); req.onerror = reject; });
  const rows = await new Promise((resolve, reject) => { const tx = db.transaction('vault'), req = tx.objectStore('vault').getAll(); req.onsuccess = () => resolve(req.result); tx.onabort = reject; });
  assert.equal(rows.length, 2); assert.notDeepEqual(rows[0].iv, rows[1].iv);
  const serialized = JSON.stringify(rows); assert.ok(!serialized.includes('issuer')); assert.ok(!serialized.includes('signingKey'));
  await new Promise((resolve, reject) => { const tx = db.transaction('vault', 'readwrite'); tx.objectStore('vault').put(rows[0], `state:${addressA}:id2`); tx.oncomplete = resolve; tx.onabort = reject; });
  await assert.rejects(p.get('id2'), /wrong key or corrupt/); db.close(); s.close();
});
test('durable journal atomically rejects concurrent same-event submissions across tabs', async () => {
  const idb = new IDBFactory(), key = await fixtureKey();
  const a = await store({ indexedDBImpl: idb, encryptionKey: key }), b = await store({ indexedDBImpl: idb, encryptionKey: key });
  const results = await Promise.allSettled([a.journal.create(attempt('first')), b.journal.create(attempt('second'))]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.match(results.find(r => r.status === 'rejected').reason.message, /Unresolved event/);
  const id = results[0].status === 'fulfilled' ? 'first' : 'second';
  const existing = await a.journal.get(id); await a.journal.update({ ...existing, state: 'failed-before-submit' });
  await assert.rejects(b.journal.create(attempt(id)), /Duplicate/);
  await b.journal.create(attempt('new-after-pre-submit-failure'));
  a.close(); b.close();
});
test('journal scope/private-field/identity checks fail closed and unknown stays unresolved', async () => {
  const s = await store(), j = s.journal, initial = attempt();
  await assert.rejects(j.create({ ...initial, issuerSecret: 'never-store-this' }), /public attempts/);
  await assert.rejects(j.create({ ...initial, network: 'preprod' }), /scope/);
  await j.create(initial);
  await assert.rejects(j.update({ ...initial, eventId: '05'.repeat(32) }), /scope/);
  await assert.rejects(j.update({ ...initial, issuerCommitment: '06'.repeat(32) }), /identity/);
  await j.update({ ...initial, state: 'unknown' });
  await j.update({ ...initial, state: 'submitted', txId: 'synthetic-id' });
  assert.equal((await j.get(initial.requestId)).state, 'unknown');
  await assert.rejects(j.create(attempt('retry')), /Unresolved/); s.close();
});
test('browser ZK provider fetches actual compiler assets and refuses wrong/corrupted sets', async () => {
  const base = 'https://synthetic.local/midnight/event-pass/'; let calls = [];
  const fetchFixture = async (url, init) => { calls.push({ url, init }); const relative = new URL(url).pathname.replace('/midnight/event-pass/', ''); return new Response(await readFile(new URL('../public/midnight/event-pass/' + relative, import.meta.url))); };
  const provider = new BrowserZkConfigProvider(base, fetchFixture, webcrypto);
  const config = await provider.get('issue'); assert.ok(config.proverKey.length > 2_000_000); assert.ok(config.verifierKey.length > 2_000); assert.ok(config.zkir.length > 300);
  assert.equal(calls.length, 3); assert.ok(calls.every(call => call.init.credentials === 'omit' && call.init.redirect === 'error'));
  await assert.rejects(provider.getVerifierKey('../redeem'), /Invalid|Unknown|safe/);
  await assert.rejects(new BrowserZkConfigProvider(base, async () => new Response('bad'), webcrypto).getVerifierKey('issue'), /integrity/);
  assert.throws(() => new BrowserZkConfigProvider('http://remote.invalid/'), /HTTPS/);
  assert.equal(assetManifest.compiler, '0.31.1');
});
test('browser wire codecs reject odd/nonhex/empty transaction bytes instead of truncating', () => {
  assert.deepEqual(transactionBytes('Aa0100'), new Uint8Array([170, 1, 0]));
  for (const malformed of ['', '0x01', '0', 'abz1', 'ab 01']) assert.throws(() => transactionBytes(malformed), /encoding/);
});
test('all-zero event scope is rejected before opening storage', async () => {
  const idb = new IDBFactory(); await assert.rejects(store({ indexedDBImpl: idb, scope: { ...fixtureScope, eventId: '00'.repeat(32) } }), /nonzero/); assert.equal((await idb.databases()).length, 0);
});

test('protected same-origin public artifacts use existing app cookies only, external assets omit credentials', async t => {
  const prior = Object.getOwnPropertyDescriptor(globalThis, 'location');
  Object.defineProperty(globalThis, 'location', { configurable: true, value: { origin: 'https://synthetic.local' } });
  t.after(() => { if (prior) Object.defineProperty(globalThis, 'location', prior); else Reflect.deleteProperty(globalThis, 'location'); });
  const calls = [];
  const fetchFixture = async (url, init) => { calls.push({ url, init }); const relative = new URL(url).pathname.replace('/midnight/event-pass/', ''); return new Response(await readFile(new URL('../public/midnight/event-pass/' + relative, import.meta.url))); };
  await new BrowserZkConfigProvider('https://synthetic.local/midnight/event-pass/', fetchFixture, webcrypto).getVerifierKey('issue');
  assert.equal(calls[0].init.credentials, 'same-origin'); assert.equal(calls[0].init.redirect, 'error');
  await new BrowserZkConfigProvider('https://external.synthetic.local/midnight/event-pass/', fetchFixture, webcrypto).getVerifierKey('issue');
  assert.equal(calls[1].init.credentials, 'omit'); assert.equal(calls[1].init.redirect, 'error');
  await assert.rejects(new BrowserZkConfigProvider('https://synthetic.local/midnight/event-pass/', async () => new Response('public missing asset', { status: 404 }), webcrypto).getVerifierKey('issue'), /404; keys\/issue\.verifier/);
});
