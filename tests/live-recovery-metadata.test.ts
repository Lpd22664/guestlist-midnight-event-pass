import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { test } from 'node:test';
import { ConsentQueue } from '../src/live/consent';
import { forgetCustody, importOwnerFile, readOwnerRecoveryMetadata, resolveRecoveryScope, type RecoveryFile, type RecoveryMetadata } from '../src/live/custody';
import type { Role } from '../src/live/model';

// Public, synthetic fixtures only. No owner recovery file, wallet or network is used.
const eventId = '11'.repeat(32), vaultKeyHex = '22'.repeat(32), capability = '33'.repeat(32), maintenanceSigningKey = '44'.repeat(32);
const rejection = 'Private recovery file was rejected. Check the Preview event, owner ID and role. No private material was accepted.';
function fixture(role: Role = 'issuer'): RecoveryFile {
  return { schema: 'guestlist-owner-custody-v1', network: 'preview', role, ownerAccountId: 'synthetic-owner:1', eventId, vaultKeyHex, ...(role === 'issuer' ? { issuerSecretHex: capability, maintenanceSigningKey } : { bearerSecretHex: capability }) };
}
const encode = (file: unknown) => JSON.stringify(file);
const publicMetadata = (role: Role = 'issuer'): RecoveryMetadata => ({ role, network: 'preview', ownerAccountId: 'synthetic-owner:1', eventId });
function rejected(action: () => unknown): void {
  assert.throws(action, error => error instanceof Error && error.message === rejection);
}

test('issuer inspection returns only frozen public metadata, excluding every private field', () => {
  const metadata = readOwnerRecoveryMetadata(encode(fixture()), 'issuer');
  assert.deepEqual(metadata, publicMetadata());
  assert.deepEqual(Object.keys(metadata).sort(), ['eventId', 'network', 'ownerAccountId', 'role']);
  assert.equal(Object.isFrozen(metadata), true);
  assert.equal(Reflect.set(metadata, 'ownerAccountId', 'another-owner'), false);
  const serialized = encode(metadata);
  for (const privateValue of [vaultKeyHex, capability, maintenanceSigningKey, 'vaultKeyHex', 'issuerSecretHex', 'maintenanceSigningKey']) assert.equal(serialized.includes(privateValue), false);
});

test('bearer inspection returns only that role’s frozen public scope', () => {
  const metadata = readOwnerRecoveryMetadata(encode(fixture('bearer')), 'bearer');
  assert.deepEqual(metadata, publicMetadata('bearer'));
  assert.equal(Object.isFrozen(metadata), true);
  assert.equal('bearerSecretHex' in metadata, false);
});

test('recovery fills both empty public fields without mutating the entered identity', () => {
  const entered = { role: 'issuer' as const, ownerAccountId: '', eventId: '' };
  const metadata = readOwnerRecoveryMetadata(encode(fixture()), entered.role);
  const resolved = resolveRecoveryScope(metadata, entered);
  assert.deepEqual(resolved, publicMetadata());
  assert.deepEqual(entered, { role: 'issuer', ownerAccountId: '', eventId: '' });
  assert.equal(Object.isFrozen(resolved), true);
  assert.notEqual(resolved, metadata);
  assert.equal(Reflect.set(resolved, 'eventId', '55'.repeat(32)), false);
});

test('partial recovery fills only missing fields and accepts matching explicit fields', () => {
  for (const role of ['issuer', 'bearer'] as const) {
    const metadata = readOwnerRecoveryMetadata(encode(fixture(role)), role);
    for (const entered of [
      { role, ownerAccountId: metadata.ownerAccountId, eventId: '' },
      { role, ownerAccountId: '', eventId },
      { role, ownerAccountId: metadata.ownerAccountId, eventId },
    ]) {
      const before = { ...entered };
      assert.deepEqual(resolveRecoveryScope(metadata, entered), publicMetadata(role));
      assert.deepEqual(entered, before);
    }
  }
});

test('explicit role, owner or event mismatches reject instead of changing identity', () => {
  const metadata = readOwnerRecoveryMetadata(encode(fixture()), 'issuer');
  for (const entered of [
    { role: 'bearer' as const, ownerAccountId: '', eventId: '' },
    { role: 'issuer' as const, ownerAccountId: 'another-owner', eventId: '' },
    { role: 'issuer' as const, ownerAccountId: '', eventId: '55'.repeat(32) },
    { role: 'issuer' as const, ownerAccountId: 'Synthetic-owner:1', eventId },
    { role: 'issuer' as const, ownerAccountId: ' synthetic-owner:1 ', eventId },
    { role: 'issuer' as const, ownerAccountId: '', eventId: ' ' },
    { role: 'issuer' as const, ownerAccountId: '', eventId: '00'.repeat(32) },
    { role: '' as Role, ownerAccountId: '', eventId: '' },
  ]) {
    const before = { ...entered };
    rejected(() => resolveRecoveryScope(metadata, entered));
    assert.deepEqual(entered, before);
  }
});

test('wrong schema, network, role or expected role fail closed', () => {
  for (const change of [{ schema: 'guestlist-owner-custody-v2' }, { schema: null }, { network: 'mainnet' }, { network: 'testnet' }, { role: 'bearer' }, { role: 'administrator' }]) rejected(() => readOwnerRecoveryMetadata(encode({ ...fixture(), ...change }), 'issuer'));
  rejected(() => readOwnerRecoveryMetadata(encode(fixture('bearer')), 'issuer'));
  rejected(() => readOwnerRecoveryMetadata(encode(fixture()), 'bearer'));
  rejected(() => readOwnerRecoveryMetadata(encode(fixture()), 'administrator' as Role));
});

test('unknown private extras and cross-role or bearer maintenance authority reject', () => {
  for (const change of [{ bearerSecretHex: capability }, { apiKey: 'synthetic-private-extra' }, { secrets: { issuer: capability } }, { encryptionKey: {} }, { __proto__: null, constructor: 'synthetic-extra' }]) rejected(() => readOwnerRecoveryMetadata(encode({ ...fixture(), ...change }), 'issuer'));
  for (const change of [{ issuerSecretHex: capability }, { maintenanceSigningKey }, { privateKey: 'not-a-key' }]) rejected(() => readOwnerRecoveryMetadata(encode({ ...fixture('bearer'), ...change }), 'bearer'));
  rejected(() => readOwnerRecoveryMetadata(encode(fixture()).replace('{', '{"__proto__":{},'), 'issuer'));
});

test('malformed JSON and nonobject roots reject with the same redacted error', () => {
  for (const text of ['', '{', 'null', '[]', '1', 'true', '"synthetic-private-content"']) rejected(() => readOwnerRecoveryMetadata(text, 'issuer'));
  rejected(() => readOwnerRecoveryMetadata(null as never, 'issuer'));
});

test('public fields require exact owner ID and lowercase nonzero 32-byte event types', () => {
  for (const change of [
    { ownerAccountId: '' }, { ownerAccountId: 'x'.repeat(129) }, { ownerAccountId: 'owner name' }, { ownerAccountId: '../owner' }, { ownerAccountId: 12 }, { ownerAccountId: null },
    { eventId: '00'.repeat(32) }, { eventId: 'AB'.repeat(32) }, { eventId: '11'.repeat(31) }, { eventId: 11 }, { eventId: [eventId] }, { eventId: null },
  ]) rejected(() => readOwnerRecoveryMetadata(encode({ ...fixture(), ...change }), 'issuer'));
  const account = 'A'.repeat(128);
  assert.equal(readOwnerRecoveryMetadata(encode({ ...fixture(), ownerAccountId: account }), 'issuer').ownerAccountId, account);
});

test('required fields and private material types/formats are validated without importing', () => {
  for (const role of ['issuer', 'bearer'] as const) {
    const capabilityKey = role === 'issuer' ? 'issuerSecretHex' : 'bearerSecretHex';
    for (const key of ['schema', 'network', 'role', 'ownerAccountId', 'eventId', 'vaultKeyHex', capabilityKey]) {
      const incomplete: Record<string, unknown> = { ...fixture(role) }; delete incomplete[key];
      rejected(() => readOwnerRecoveryMetadata(encode(incomplete), role));
    }
    for (const key of ['vaultKeyHex', capabilityKey]) {
      for (const value of [null, 1, {}, [vaultKeyHex], '', '00'.repeat(32), 'AB'.repeat(32), '11'.repeat(31)]) rejected(() => readOwnerRecoveryMetadata(encode({ ...fixture(role), [key]: value }), role));
    }
  }
  for (const value of [null, 1, {}, '', 'AB'.repeat(32), '44'.repeat(31)]) rejected(() => readOwnerRecoveryMetadata(encode({ ...fixture(), maintenanceSigningKey: value }), 'issuer'));
  const withoutMaintenance = fixture(); delete withoutMaintenance.maintenanceSigningKey;
  assert.deepEqual(readOwnerRecoveryMetadata(encode(withoutMaintenance), 'issuer'), publicMetadata());
});

test('recovery inspection is bounded at 8192 characters before JSON parsing', () => {
  const text = encode(fixture());
  const atLimit = text.padEnd(8192, ' ');
  assert.deepEqual(readOwnerRecoveryMetadata(atLimit, 'issuer'), publicMetadata());
  rejected(() => readOwnerRecoveryMetadata(`${atLimit} `, 'issuer'));
  rejected(() => readOwnerRecoveryMetadata('x'.repeat(8193), 'issuer'));
});

test('errors never echo private, malformed or mismatching values', () => {
  const secret = 'synthetic-do-not-echo-private-data';
  rejected(() => readOwnerRecoveryMetadata(encode({ ...fixture(), issuerSecretHex: secret }), 'issuer'));
  rejected(() => readOwnerRecoveryMetadata(`{"vaultKeyHex":"${secret}",`, 'issuer'));
  rejected(() => resolveRecoveryScope(publicMetadata(), { role: 'issuer', ownerAccountId: secret, eventId: '' }));
});

test('scope resolver independently rejects malformed metadata and entered field types', () => {
  const entered = { role: 'issuer' as const, ownerAccountId: '', eventId: '' };
  for (const metadata of [null, [], { ...publicMetadata(), network: 'mainnet' }, { ...publicMetadata(), role: 'administrator' }, { ...publicMetadata(), eventId: '00'.repeat(32) }, { ...publicMetadata(), eventId: 1 }, { ...publicMetadata(), ownerAccountId: '' }, { ...publicMetadata(), vaultKeyHex }]) rejected(() => resolveRecoveryScope(metadata as RecoveryMetadata, entered));
  for (const value of [null, { ...entered, ownerAccountId: null }, { ...entered, eventId: 1 }]) rejected(() => resolveRecoveryScope(publicMetadata(), value as unknown as typeof entered));
});

test('inspection and declined owner consent never import or generate keys', async () => {
  const originalCrypto = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  let cryptoCalls = 0;
  const unexpectedCrypto = () => { cryptoCalls++; throw new Error('Synthetic inspection must not touch crypto'); };
  const fakeCrypto = { subtle: { importKey: unexpectedCrypto, generateKey: unexpectedCrypto }, getRandomValues: unexpectedCrypto } as unknown as Crypto;
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: fakeCrypto });
  try {
    const fileText = encode(fixture());
    const resolved = resolveRecoveryScope(readOwnerRecoveryMetadata(fileText, 'issuer'), { role: 'issuer', ownerAccountId: '', eventId: '' });
    const queue = new ConsentQueue();
    const consent = queue.request({ requirement: 'importPrivateFile', title: 'Synthetic local import review', details: [`Preview owner ${resolved.ownerAccountId}, event ${resolved.eventId}`], acceptLabel: 'Owner import' });
    assert.equal(cryptoCalls, 0);
    queue.respond(false);
    const custody = await consent ? await importOwnerFile(fileText, resolved, fakeCrypto) : undefined;
    assert.equal(custody, undefined);
    assert.equal(cryptoCalls, 0);
  } finally {
    if (originalCrypto) Object.defineProperty(globalThis, 'crypto', originalCrypto);
    else Reflect.deleteProperty(globalThis, 'crypto');
  }
});

test('explicit synthetic owner import remains exact-scope and nonextractable after recovery', async () => {
  for (const role of ['issuer', 'bearer'] as const) {
    const text = encode(fixture(role));
    const resolved = resolveRecoveryScope(readOwnerRecoveryMetadata(text, role), { role, ownerAccountId: '', eventId: '' });
    const custody = await importOwnerFile(text, resolved, webcrypto as unknown as Crypto);
    assert.equal(custody.encryptionKey.extractable, false);
    assert.equal(custody.encryptionKey.algorithm.name, 'AES-GCM');
    assert.equal(custody.role, role); assert.equal(custody.eventId, resolved.eventId); assert.equal(custody.ownerAccountId, resolved.ownerAccountId);
    assert.deepEqual([...custody.capability], new Array(32).fill(0x33));
    assert.equal(custody.maintenanceSigningKey, role === 'issuer' ? maintenanceSigningKey : undefined);
    forgetCustody(custody);
    assert.equal(custody.capability.every(byte => byte === 0), true);
  }
});

test('private import rejects wrong or malformed scope before WebCrypto accepts material', async () => {
  let imports = 0;
  const fakeCrypto = { subtle: { importKey: () => { imports++; throw new Error('Unexpected synthetic import'); } } } as unknown as Crypto;
  const scope = { role: 'issuer' as const, ownerAccountId: 'synthetic-owner:1', eventId };
  for (const changedScope of [{ ...scope, ownerAccountId: 'another-owner' }, { ...scope, eventId: '55'.repeat(32) }, { ...scope, role: 'bearer' as const }]) await assert.rejects(importOwnerFile(encode(fixture()), changedScope, fakeCrypto), { message: rejection });
  for (const change of [{ eventId: '00'.repeat(32) }, { ownerAccountId: 'owner name' }, { issuerSecretHex: 1 }, { maintenanceSigningKey: {} }, { bearerSecretHex: capability }]) await assert.rejects(importOwnerFile(encode({ ...fixture(), ...change }), scope, fakeCrypto), { message: rejection });
  assert.equal(imports, 0);
});
