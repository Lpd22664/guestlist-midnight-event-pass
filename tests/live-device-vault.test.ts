import assert from 'node:assert/strict';
import { test } from 'node:test';
import { webcrypto } from 'node:crypto';
import { createRequire } from 'node:module';
import { DeviceVault, DEVICE_VAULT_DATABASE, VAULT_PBKDF2_ITERATIONS, readEncryptedBackupMetadata, validateVaultPassword, vaultScopeKey, type OwnerVaultApproval } from '../src/live/device-vault';
import { forgetCustody, importOwnerFile, type RecoveryScope } from '../src/live/custody';
import { LiveController } from '../src/live/controller';
import { openOwnerStorage } from '../browser-integration/dist/index';

const { IDBFactory } = createRequire(import.meta.url)('../browser-integration/node_modules/fake-indexeddb') as { IDBFactory: new () => IDBFactory };
const cryptoImpl = webcrypto as unknown as Crypto;
const password = 'synthetic fixture password only';
const scope: RecoveryScope = { role: 'issuer', ownerAccountId: 'synthetic-owner', eventId: '11'.repeat(32) };
// Fixed public test fixtures only. No owner authority, wallet, connection, or real maintenance grant.
const fixture = (s: RecoveryScope = scope, secret = '22') => JSON.stringify({ schema: 'guestlist-owner-custody-v1', network: 'preview', ...s, vaultKeyHex: '33'.repeat(32), ...(s.role === 'issuer' ? { issuerSecretHex: secret.repeat(32), maintenanceSigningKey: '44'.repeat(32) } : { bearerSecretHex: secret.repeat(32) }) });
const approved = (): OwnerVaultApproval => ({ ownerApproved: true, isCurrent: () => true });
const make = (idb: IDBFactory = new IDBFactory(), customCrypto = cryptoImpl) => ({ idb, vault: new DeviceVault({ indexedDBImpl: idb, cryptoImpl: customCrypto }) });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }
async function dbRecord(idb: IDBFactory, key = vaultScopeKey(scope), replace?: unknown): Promise<unknown> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = idb.open(DEVICE_VAULT_DATABASE, 1); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('records', replace === undefined ? 'readonly' : 'readwrite');
      const request = replace === undefined ? tx.objectStore('records').get(key) : tx.objectStore('records').put(replace, key);
      let result: unknown; request.onsuccess = () => { result = request.result; }; tx.oncomplete = () => resolve(result); tx.onabort = () => reject(tx.error);
    });
  } finally { db.close(); }
}
function gateCrypto(method: 'deriveKey' | 'decrypt' | 'importKey', match?: (...args: unknown[]) => boolean) {
  const entered = deferred<void>(), release = deferred<void>();
  const subtle = new Proxy(cryptoImpl.subtle, { get(target, property) {
    const value = Reflect.get(target, property, target);
    if (property !== method) return typeof value === 'function' ? value.bind(target) : value;
    return async (...args: unknown[]) => { const result = await Reflect.apply(value, target, args); if (!match || match(...args)) { entered.resolve(); await release.promise; } return result; };
  } });
  return { entered, release, crypto: { subtle, getRandomValues: cryptoImpl.getRandomValues.bind(cryptoImpl) } as Crypto };
}

test('password validation permits long passphrases and requires at least 15 characters', () => {
  for (const value of ['', 'short password', ' '.repeat(16), 'a'.repeat(20), 'ab'.repeat(65)]) assert.throws(() => validateVaultPassword(value));
  validateVaultPassword(password); validateVaultPassword(' four untrimmed words '); validateVaultPassword('🍎'.repeat(14) + '🍐');
});

test('password vault persists ciphertext only and a fresh instance restores the exact original authority', async () => {
  const { idb, vault } = make();
  assert.deepEqual(await vault.list(), []);
  await vault.remember(fixture(), scope, password, approved());
  const saved = JSON.stringify(await dbRecord(idb));
  for (const privateValue of ['22'.repeat(32), '33'.repeat(32), '44'.repeat(32), 'vaultKeyHex', 'issuerSecretHex', 'maintenanceSigningKey', password]) assert.equal(saved.includes(privateValue), false);
  const reopened = make(idb).vault;
  assert.deepEqual(await reopened.list(), [{ network: 'preview', ...scope }]);
  const custody = await reopened.unlock(scope, password, approved());
  assert.equal(custody.role, 'issuer'); assert.equal(custody.encryptionKey.extractable, false); assert.equal(custody.maintenanceSigningKey, '44'.repeat(32)); assert.deepEqual(custody.capability, new Uint8Array(32).fill(0x22));
  const original = await importOwnerFile(fixture(), scope, cryptoImpl), iv = new Uint8Array(12).fill(5), plaintext = new TextEncoder().encode('synthetic original SDK-vault record');
  const encrypted = await cryptoImpl.subtle.encrypt({ name: 'AES-GCM', iv }, original.encryptionKey, plaintext);
  assert.deepEqual(new Uint8Array(await cryptoImpl.subtle.decrypt({ name: 'AES-GCM', iv }, custody.encryptionKey, encrypted)), plaintext);
  await assert.rejects(cryptoImpl.subtle.exportKey('raw', custody.encryptionKey));
  forgetCustody(original); forgetCustody(custody);
});

test('return unlock preserves the SDK vault namespace, private state, maintenance key and unresolved journal', async () => {
  const { idb, vault } = make(), original = await importOwnerFile(fixture(), scope, cryptoImpl), sdkScope = { network: 'preview' as const, ...scope }, contract = '55'.repeat(32);
  const owner = await openOwnerStorage({ scope: sdkScope, encryptionKey: original.encryptionKey, authorize: async () => true, indexedDBImpl: idb, cryptoImpl });
  owner.privateStateProvider.setContractAddress(contract);
  await owner.privateStateProvider.set('synthetic-private-state', { issuerSecret: original.capability });
  await owner.privateStateProvider.setSigningKey(contract, original.maintenanceSigningKey!);
  await owner.journal.create({ requestId: 'synthetic-unresolved', network: 'preview', action: 'deploy', eventId: scope.eventId, issuerCommitment: '66'.repeat(32), state: 'started', expiresAt: 1000 });
  const databasesBefore = (await idb.databases()).map(value => value.name);
  await vault.remember(fixture(), scope, password, approved()); owner.close(); forgetCustody(original);
  const custody = await make(idb).vault.unlock(scope, password, approved());
  const reopened = await openOwnerStorage({ scope: sdkScope, encryptionKey: custody.encryptionKey, authorize: async () => true, indexedDBImpl: idb, cryptoImpl });
  reopened.privateStateProvider.setContractAddress(contract);
  assert.deepEqual((await reopened.privateStateProvider.get('synthetic-private-state'))?.issuerSecret, new Uint8Array(32).fill(0x22));
  assert.equal(await reopened.privateStateProvider.getSigningKey(contract), '44'.repeat(32));
  assert.equal((await reopened.journal.get('synthetic-unresolved'))?.state, 'started');
  const databasesAfter = (await idb.databases()).map(value => value.name);
  assert.deepEqual(databasesAfter.filter(name => name !== DEVICE_VAULT_DATABASE), databasesBefore);
  reopened.close(); forgetCustody(custody);
});

test('wrong password and attempted replacement never alter an existing saved authority', async () => {
  const { vault, idb } = make(); await vault.remember(fixture(), scope, password, approved());
  const before = await dbRecord(idb);
  await assert.rejects(vault.unlock(scope, 'another synthetic password', approved()), /could not be unlocked/);
  await assert.rejects(vault.remember(fixture(scope, '77'), scope, 'different synthetic password', approved()), /already saved/);
  assert.deepEqual(await dbRecord(idb), before);
  const custody = await vault.unlock(scope, password, approved()); assert.deepEqual(custody.capability, new Uint8Array(32).fill(0x22)); forgetCustody(custody);
});

test('separate scopes keep owner/event/role isolated; outer scope substitution fails authentication', async () => {
  const { vault, idb } = make(); await vault.remember(fixture(), scope, password, approved());
  const backup = JSON.parse(await vault.exportBackup(scope));
  for (const changed of [{ ownerAccountId: 'different-owner' }, { eventId: '99'.repeat(32) }, { role: 'bearer' as const }]) {
    const otherScope = { ...scope, ...changed }, other = make();
    await assert.rejects(other.vault.importBackup(JSON.stringify({ ...backup, ...changed }), otherScope, password, approved()), /could not be unlocked/);
    assert.deepEqual(await other.vault.list(), []);
    await assert.rejects(vault.unlock(otherScope, password, approved()), /could not be unlocked/);
  }
  const bearer = { ...scope, role: 'bearer' as const };
  await vault.remember(fixture(bearer, '88'), bearer, password, approved());
  assert.equal((await make(idb).vault.list()).length, 2);
  const custody = await vault.unlock(bearer, password, approved()); assert.equal(custody.maintenanceSigningKey, undefined); assert.deepEqual(custody.capability, new Uint8Array(32).fill(0x88)); forgetCustody(custody);
});

test('backup schema, bounded input, fixed KDF cost and authenticated salt/IV/ciphertext fail closed', async () => {
  const { vault } = make(); await vault.remember(fixture(), scope, password, approved());
  const backup = await vault.exportBackup(scope), record = JSON.parse(backup);
  assert.equal(record.iterations, VAULT_PBKDF2_ITERATIONS);
  assert.deepEqual(readEncryptedBackupMetadata(backup, 'issuer'), { network: 'preview', ...scope });
  for (const changed of [{ schema: 'other' }, { eventId: [scope.eventId] }, { eventId: [[scope.eventId]] }, { network: 'mainnet' }, { iterations: 1 }, { iterations: 2 ** 40 }, { kdf: 'PBKDF2-SHA1' }, { cipher: 'AES-CBC' }, { extra: 'not permitted' }, { saltHex: 'ab' }, { ciphertextHex: 'ab'.repeat(9000) }]) assert.throws(() => readEncryptedBackupMetadata(JSON.stringify({ ...record, ...changed }), 'issuer'));
  assert.throws(() => readEncryptedBackupMetadata(' '.repeat(18001), 'issuer'));
  assert.throws(() => readEncryptedBackupMetadata(backup, 'bearer'));
  for (const changed of [{ saltHex: 'ab'.repeat(16) }, { ivHex: 'ab'.repeat(12) }, { ciphertextHex: 'ab'.repeat(record.ciphertextHex.length / 2) }]) {
    const other = make(); await assert.rejects(other.vault.importBackup(JSON.stringify({ ...record, ...changed }), scope, password, approved()), /could not be unlocked/); assert.deepEqual(await other.vault.list(), []);
  }
});

test('encrypted backup imports only after successful decryption and never overwrites another record', async () => {
  const a = make(), b = make(); await a.vault.remember(fixture(), scope, password, approved());
  const backup = await a.vault.exportBackup(scope);
  await assert.rejects(b.vault.importBackup(backup, scope, 'wrong fixture password', approved()), /could not be unlocked/); assert.deepEqual(await b.vault.list(), []);
  const first = await b.vault.importBackup(backup, scope, password, approved()); forgetCustody(first);
  const before = await dbRecord(b.idb), same = await b.vault.importBackup(backup, scope, password, approved()); forgetCustody(same);
  assert.deepEqual(await dbRecord(b.idb), before);
  const c = make(); await c.vault.remember(fixture(scope, '77'), scope, password, approved());
  await assert.rejects(b.vault.importBackup(await c.vault.exportBackup(scope), scope, password, approved()), /already saved/);
  assert.deepEqual(await dbRecord(b.idb), before);
});

test('explicit owner approval is required before any private processing or persistence', async () => {
  const { vault, idb } = make();
  const rejected = { ...approved(), ownerApproved: false } as unknown as OwnerVaultApproval;
  await assert.rejects(vault.remember(fixture(), scope, password, rejected), /Explicit owner review/);
  await assert.rejects(vault.unlock(scope, password, rejected), /Explicit owner review/);
  await assert.rejects(vault.importBackup('{}', scope, password, rejected), /Explicit owner review/);
  assert.deepEqual(await idb.databases(), []);
});

test('lock during PBKDF2 cancels save and creates no saved record', async () => {
  const delayed = gateCrypto('deriveKey'), { vault, idb } = make(undefined, delayed.crypto), abort = new AbortController();
  const pending = vault.remember(fixture(), scope, password, { ...approved(), signal: abort.signal });
  await delayed.entered.promise; abort.abort(); delayed.release.resolve();
  await assert.rejects(pending, /cancelled/); assert.deepEqual(await idb.databases(), []);
});

test('lock during decrypt or final AES import prevents a late custody resurrection', async () => {
  const source = make(); await source.vault.remember(fixture(), scope, password, approved());
  for (const method of ['decrypt', 'importKey'] as const) {
    const delayed = gateCrypto(method, method === 'importKey' ? (_format, _key, algorithm) => algorithm === 'AES-GCM' : undefined);
    const vault = make(source.idb, delayed.crypto).vault;
    let current = true;
    const pending = vault.unlock(scope, password, { ownerApproved: true, isCurrent: () => current });
    await delayed.entered.promise; current = false; delayed.release.resolve();
    await assert.rejects(pending, /cancelled/);
  }
  assert.equal((await source.vault.list()).length, 1);
});

test('simultaneous tabs cannot replace each other: add-only transaction commits exactly one authority', async () => {
  const { idb, vault } = make(), other = make(idb).vault;
  const results = await Promise.allSettled([vault.remember(fixture(), scope, password, approved()), other.remember(fixture(scope, '77'), scope, password, approved())]);
  assert.equal(results.filter(value => value.status === 'fulfilled').length, 1);
  assert.equal(results.filter(value => value.status === 'rejected').length, 1);
  const custody = await vault.unlock(scope, password, approved());
  assert.deepEqual(custody.capability, new Uint8Array(32).fill(results[0].status === 'fulfilled' ? 0x22 : 0x77)); forgetCustody(custody);
});

test('malformed storage never silently becomes a new vault or leaks additional metadata', async () => {
  const { idb, vault } = make(); await vault.remember(fixture(), scope, password, approved());
  const corrupt = { ...(await dbRecord(idb) as object), password: 'synthetic leaked extra' }; await dbRecord(idb, vaultScopeKey(scope), corrupt);
  await assert.rejects(vault.list(), /unreadable/); await assert.rejects(vault.unlock(scope, password, approved())); await assert.rejects(vault.exportBackup(scope));
  await assert.rejects(vault.remember(fixture(), scope, password, approved()), /already saved/);
  assert.deepEqual(await dbRecord(idb), corrupt);
});

test('controller lock aborts owner-local writes and rotates its signal without deleting public history', () => {
  const data = new Map<string, string>(), controller = new LiveController({ storage: { getItem: key => data.get(key) ?? null, setItem: (key, value) => { data.set(key, value); } } });
  const signal = controller.ownerControlSignal(), current = controller.ownerControlGuard();
  controller.disconnect(); assert.equal(signal.aborted, true); assert.equal(current(), false); assert.equal(controller.ownerControlSignal().aborted, false); assert.equal(data.size, 0);
});

test('locking during the IndexedDB write aborts the whole transaction before it persists authority', async () => {
  const idb = new IDBFactory(), abort = new AbortController(), originalOpen = idb.open.bind(idb);
  // Synthetic transaction interruption at the exact record-add boundary.
  idb.open = (...args: Parameters<IDBFactory['open']>) => {
    const request = originalOpen(...args);
    request.addEventListener('success', () => {
      const db = request.result, originalTransaction = db.transaction.bind(db);
      db.transaction = (...txArgs: Parameters<IDBDatabase['transaction']>) => {
        const tx = originalTransaction(...txArgs);
        if (tx.mode === 'readwrite') {
          const store = tx.objectStore('records'), add = store.add.bind(store);
          store.add = (...addArgs: Parameters<IDBObjectStore['add']>) => { const pending = add(...addArgs); abort.abort(); return pending; };
        }
        return tx;
      };
    });
    return request;
  };
  const vault = make(idb).vault;
  await assert.rejects(vault.remember(fixture(), scope, password, { ...approved(), signal: abort.signal }), /cancelled/);
  assert.deepEqual(await vault.list(), []);
});

test('independent wraps use fresh random salts and IVs even for the exact same authority and password', async () => {
  const a = make(), b = make();
  await a.vault.remember(fixture(), scope, password, approved()); await b.vault.remember(fixture(), scope, password, approved());
  const first = JSON.parse(await a.vault.exportBackup(scope)), second = JSON.parse(await b.vault.exportBackup(scope));
  assert.notEqual(first.saltHex, second.saltHex); assert.notEqual(first.ivHex, second.ivHex); assert.notEqual(first.ciphertextHex, second.ciphertextHex);
});

test('legacy recovery and password unlock snapshot mutable scope before asynchronous AES import', async () => {
  const original = make(); await original.vault.remember(fixture(), scope, password, approved());
  for (const usePassword of [false, true]) {
    const selected = { ...scope }, delayed = gateCrypto('importKey', (_format, _key, algorithm) => algorithm === 'AES-GCM');
    const pending = usePassword ? make(original.idb, delayed.crypto).vault.unlock(selected, password, approved()) : importOwnerFile(fixture(), selected, delayed.crypto);
    await delayed.entered.promise;
    selected.role = 'bearer'; selected.ownerAccountId = 'changed-owner'; selected.eventId = '99'.repeat(32);
    delayed.release.resolve();
    const custody = await pending;
    assert.equal(custody.role, scope.role); assert.equal(custody.ownerAccountId, scope.ownerAccountId); assert.equal(custody.eventId, scope.eventId);
    assert.deepEqual(custody.capability, new Uint8Array(32).fill(0x22)); forgetCustody(custody);
  }
});
