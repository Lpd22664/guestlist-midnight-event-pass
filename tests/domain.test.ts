import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { applyCommand, createDemoState, decodeCredential, demoCommitment, encodeCredential, EVENT, newSecret, passNumber, shortCommitment, statusOf, type Command, type DemoState, type Pass } from '../src/domain';
import { clone, issue, NOW, rawCredential, readyPass, rejectsCode, secret, throwsCode } from './helpers';

async function rejectedWithoutMutation(state: DemoState, command: Command, code: Parameters<typeof rejectsCode>[1], role: 'organiser' | 'attendee' = 'organiser', requestId = 'synthetic-failure') {
  const before = clone(state);
  await rejectsCode(() => applyCommand(state, command, role, requestId, NOW), code);
  assert.deepEqual(state, before, 'A rejected action must not mutate the input ledger');
}

test('synthetic seed has stable identifiers, status counts, and no chain receipts', async () => {
  const first = await createDemoState();
  assert.deepEqual(first, await createDemoState());
  assert.equal(first.eventId, EVENT.id);
  assert.equal(first.version, 1);
  assert.equal(first.revision, 0);
  assert.deepEqual(first.requests, {});
  assert.equal(first.passes.length, 18);
  assert.equal(new Set(first.passes.map(pass => pass.id)).size, 18);
  assert.deepEqual(first.passes.reduce<Record<string, number>>((counts, pass) => { const status = statusOf(pass, NOW.getTime()); counts[status] = (counts[status] ?? 0) + 1; return counts; }, {}), { ready: 12, used: 3, revoked: 2, expired: 1 });
  for (const [index, pass] of first.passes.entries()) {
    assert.equal(pass.secret, secret(index + 1));
    assert.equal(pass.id, pass.commitment);
    assert.equal(pass.commitment, await demoCommitment(pass.secret));
    assert.equal(pass.sequence, index + 1);
  }
});

test('commitments match SHA-256 and are separated by event, protocol, and secret', async () => {
  const input = secret(77);
  const expected = createHash('sha256').update(`guestlist:demo:v1:${EVENT.id}:${input}`).digest('hex');
  const actual = await demoCommitment(input);
  assert.equal(actual, expected);
  assert.notEqual(actual, await demoCommitment(input, 'another-event' as typeof EVENT.id));
  assert.notEqual(actual, await demoCommitment(secret(78)));
  assert.notEqual(actual, createHash('sha256').update(input).digest('hex'));
  assert.notEqual(actual, createHash('sha256').update(`guestlist:chain:v1:${EVENT.id}:${input}`).digest('hex'));
});

test('new secrets are 32 random bytes represented as lowercase hexadecimal', () => {
  const values = Array.from({ length: 32 }, () => newSecret());
  for (const value of values) assert.match(value, /^[0-9a-f]{64}$/);
  assert.equal(new Set(values).size, values.length);
});

test('pass display helpers format synthetic identifiers without changing them', () => {
  assert.equal(passNumber({ sequence: 1 }), 'GL-001');
  assert.equal(passNumber({ sequence: 1234 }), 'GL-1234');
  assert.equal(shortCommitment('abcdef0123456789'), 'abcdef01…456789');
});

test('credential round trip declares only the local demo mode and expected event', async () => {
  const pass = readyPass(await createDemoState());
  const encoded = encodeCredential(pass);
  assert.match(encoded, /^guestlist-demo:/);
  assert.deepEqual(decodeCredential(encoded), { version: 1, mode: 'demo', eventId: EVENT.id, passId: pass.id, secret: pass.secret });
  assert.deepEqual(decodeCredential(`${encoded} \n`), decodeCredential(encoded));
  assert.equal(encoded.includes(pass.label), false);
});

const malformedCredentials: Array<[string, string]> = [
  ['empty', ''], ['other protocol', 'guestlist-chain:anything'], ['unprefixed', 'anything'],
  ['invalid base64', 'guestlist-demo:%%%'], ['invalid JSON', `guestlist-demo:${btoa('{')}`],
  ['null JSON', `guestlist-demo:${btoa('null')}`], ['array JSON', `guestlist-demo:${btoa('[]')}`],
  ['wrong version', rawCredential({ version: 2 })], ['chain mode', rawCredential({ mode: 'chain' })],
  ['missing event', rawCredential({ eventId: undefined })], ['non-string event', rawCredential({ eventId: 123 })],
  ['missing pass ID', rawCredential({ passId: undefined })], ['short pass ID', rawCredential({ passId: 'abc' })],
  ['uppercase pass ID', rawCredential({ passId: 'A'.repeat(64) })], ['non-string pass ID', rawCredential({ passId: 123 })],
  ['missing secret', rawCredential({ secret: undefined })], ['short secret', rawCredential({ secret: 'abc' })],
  ['uppercase secret', rawCredential({ secret: 'A'.repeat(64) })], ['non-string secret', rawCredential({ secret: 123 })],
  ['oversize credential', `guestlist-demo:${'a'.repeat(2048)}`],
];
for (const [name, raw] of malformedCredentials) test(`credential parser rejects ${name}`, () => throwsCode(() => decodeCredential(raw), 'invalid'));
test('credential parser distinguishes a valid credential from another event', () => throwsCode(() => decodeCredential(rawCredential({ eventId: 'synthetic-other-event' })), 'wrong-event'));

test('status becomes expired exactly at expiry; terminal statuses stay terminal', async () => {
  const pass = readyPass(await createDemoState());
  const expiry = Date.parse(pass.expiresAt);
  assert.equal(statusOf(pass, expiry - 1), 'ready');
  assert.equal(statusOf(pass, expiry), 'expired');
  assert.equal(statusOf(pass, expiry + 1), 'expired');
  assert.equal(statusOf({ ...pass, status: 'used' }, expiry + 1), 'used');
  assert.equal(statusOf({ ...pass, status: 'revoked' }, expiry + 1), 'revoked');
  assert.equal(pass.status, 'ready', 'Derived expiry must not mutate the pass');
});

test('organiser issues a trimmed label, monotonic sequence, local receipt, and one audit entry immutably', async () => {
  const input = await createDemoState();
  const before = clone(input);
  const { state, receipt } = await applyCommand(input, issue(100, '  Synthetic Visitor  '), 'organiser', 'synthetic-issue', NOW);
  assert.deepEqual(input, before);
  assert.equal(state.passes.length, 19);
  const pass = state.passes.at(-1)!;
  assert.equal(pass.label, 'Synthetic Visitor');
  assert.equal(pass.sequence, 19);
  assert.equal(pass.type, 'Guest');
  assert.equal(pass.status, 'ready');
  assert.equal(pass.issuedAt, NOW.toISOString());
  assert.equal(pass.expiresAt, EVENT.expiresAt);
  assert.equal(pass.id, await demoCommitment(secret(100)));
  assert.deepEqual(receipt, { mode: 'demo', operationId: 'demo-synthetic-issue', type: 'issue', passId: pass.id, status: 'verified-locally', at: NOW.toISOString() });
  assert.equal(state.revision, 1);
  assert.equal(state.activity.length, input.activity.length + 1);
  assert.deepEqual(state.activity[0], { id: 'synthetic-issue', type: 'issue', passId: pass.id, label: pass.label, at: NOW.toISOString(), operationId: receipt.operationId });
  assert.equal(state.requests['synthetic-issue'].receipt, receipt);
});

test('organiser may issue a host pass and labels at the permitted boundaries', async () => {
  let state = await createDemoState();
  for (const [number, label] of [[101, 'AB'], [102, 'A'.repeat(48)]] as const) {
    const result = await applyCommand(state, { type: 'issue', passType: 'Host', label, secret: secret(number) }, 'organiser', `synthetic-host-${number}`, NOW);
    state = result.state;
    assert.equal(state.passes.at(-1)!.type, 'Host');
    assert.equal(state.passes.at(-1)!.label, label);
  }
});

for (const type of ['issue', 'revoke'] as const) test(`attendee cannot ${type}, including replaying an organiser request`, async () => {
  const state = await createDemoState();
  const command: Command = type === 'issue' ? issue() : { type: 'revoke', passId: readyPass(state).id };
  await rejectedWithoutMutation(state, command, 'unauthorised', 'attendee');
  const authorised = await applyCommand(state, command, 'organiser', 'synthetic-authority', NOW);
  await rejectedWithoutMutation(authorised.state, command, 'unauthorised', 'attendee', 'synthetic-authority');
});

const badIssues: Array<[string, Command]> = [
  ['empty label', issue(100, '')], ['whitespace label', issue(100, '   ')], ['short label', issue(100, 'A')],
  ['long label', issue(100, 'A'.repeat(49))],
  ['invalid secret', { type: 'issue', label: 'Synthetic', passType: 'Guest', secret: 'bad' }],
  ['uppercase secret', { type: 'issue', label: 'Synthetic', passType: 'Guest', secret: 'A'.repeat(64) }],
  ['invalid pass type', { type: 'issue', label: 'Synthetic', passType: 'VIP' as 'Guest', secret: secret(100) }],
];
for (const [name, command] of badIssues) test(`issue rejects ${name} without recording a request`, async () => rejectedWithoutMutation(await createDemoState(), command, 'invalid'));
for (const requestId of ['', 'r'.repeat(129)]) test(`request ID rejects ${requestId ? 'oversize' : 'empty'} value`, async () => rejectedWithoutMutation(await createDemoState(), issue(), 'invalid', 'organiser', requestId));
test('request ID permits its 128-character boundary', async () => assert.equal((await applyCommand(await createDemoState(), issue(), 'organiser', 'r'.repeat(128), NOW)).state.revision, 1));

test('sequence uses the highest issued number rather than the array length', async () => {
  const state = await createDemoState();
  state.passes[0].sequence = 1000;
  const result = await applyCommand(state, issue(), 'organiser', 'synthetic-sequence', NOW);
  assert.equal(result.state.passes.at(-1)!.sequence, 1001);
});

for (const status of ['ready', 'used', 'revoked', 'expired'] as const) test(`an already issued ${status} credential cannot be reissued`, async () => {
  const state = await createDemoState();
  const pass = state.passes.find(value => statusOf(value, NOW.getTime()) === status)!;
  await rejectedWithoutMutation(state, { type: 'issue', label: 'Another Synthetic Label', passType: 'Guest', secret: pass.secret }, 'duplicate');
});

for (const role of ['attendee', 'organiser'] as const) test(`${role} may redeem the correct ready credential exactly once`, async () => {
  const input = await createDemoState();
  const before = clone(input);
  const pass = readyPass(input);
  const command: Command = { type: 'redeem', credential: encodeCredential(pass) };
  const { state, receipt } = await applyCommand(input, command, role, 'synthetic-redeem', NOW);
  assert.deepEqual(input, before);
  assert.equal(state.passes.find(value => value.id === pass.id)!.status, 'used');
  assert.equal(state.passes.find(value => value.id === pass.id)!.usedAt, NOW.toISOString());
  assert.equal(receipt.type, 'redeem');
  assert.equal(receipt.status, 'verified-locally');
  assert.equal(state.revision, 1);
  assert.equal(state.activity[0].passId, pass.id);
  await rejectedWithoutMutation(state, command, 'used', role, 'synthetic-second-redemption');
});

test('redeem rejects a wrong secret, unknown ID, malformed input, and wrong event', async () => {
  const state = await createDemoState();
  const pass = readyPass(state);
  for (const [credential, code] of [
    [rawCredential({ passId: pass.id, secret: secret(999) }), 'invalid'],
    [rawCredential({ passId: secret(999), secret: pass.secret }), 'invalid'],
    ['not a credential', 'invalid'],
    [rawCredential({ passId: pass.id, secret: pass.secret, eventId: 'synthetic-other-event' }), 'wrong-event'],
  ] as const) await rejectedWithoutMutation(state, { type: 'redeem', credential }, code, 'attendee');
});

for (const status of ['used', 'revoked', 'expired'] as const) for (const type of ['redeem', 'revoke'] as const) test(`${type} rejects a ${status} pass and preserves its terminal data`, async () => {
  const state = await createDemoState();
  const pass = state.passes.find(value => statusOf(value, NOW.getTime()) === status)!;
  const command: Command = type === 'redeem' ? { type, credential: encodeCredential(pass) } : { type, passId: pass.id };
  await rejectedWithoutMutation(state, command, status);
});

test('organiser revocation records one terminal change and cannot subsequently redeem', async () => {
  const input = await createDemoState();
  const before = clone(input);
  const pass = readyPass(input);
  const { state, receipt } = await applyCommand(input, { type: 'revoke', passId: pass.id }, 'organiser', 'synthetic-revoke', NOW);
  assert.deepEqual(input, before);
  assert.equal(state.passes.find(value => value.id === pass.id)!.status, 'revoked');
  assert.equal(state.passes.find(value => value.id === pass.id)!.revokedAt, NOW.toISOString());
  assert.equal(receipt.type, 'revoke');
  assert.equal(state.activity[0].type, 'revoke');
  await rejectedWithoutMutation(state, { type: 'redeem', credential: encodeCredential(pass) }, 'revoked', 'attendee');
});
test('revocation rejects unknown pass identifiers', async () => rejectedWithoutMutation(await createDemoState(), { type: 'revoke', passId: secret(999) }, 'invalid'));

test('redemption succeeds immediately before expiry and fails at the exact boundary', async () => {
  const state = await createDemoState();
  const pass = readyPass(state);
  const command: Command = { type: 'redeem', credential: encodeCredential(pass) };
  const expiry = Date.parse(pass.expiresAt);
  assert.equal((await applyCommand(state, command, 'attendee', 'synthetic-before-expiry', new Date(expiry - 1))).state.passes.find(value => value.id === pass.id)!.status, 'used');
  await rejectsCode(() => applyCommand(state, command, 'attendee', 'synthetic-at-expiry', new Date(expiry)), 'expired');
});

test('capacity counts every issued pass including terminal and expired passes', async () => {
  let state = await createDemoState();
  while (state.passes.length < EVENT.capacity) {
    const number = 100 + state.passes.length;
    state = (await applyCommand(state, issue(number), 'organiser', `synthetic-fill-${number}`, NOW)).state;
  }
  assert.equal(state.passes.length, 72);
  await rejectedWithoutMutation(state, issue(999), 'capacity');
  const ready = readyPass(state);
  state = (await applyCommand(state, { type: 'revoke', passId: ready.id }, 'organiser', 'synthetic-capacity-revoke', NOW)).state;
  await rejectedWithoutMutation(state, issue(999), 'capacity');
});

for (const type of ['issue', 'redeem', 'revoke'] as const) test(`${type} request replay returns the original receipt and leaves revision, passes, and history unchanged`, async () => {
  const input = await createDemoState();
  const pass = readyPass(input);
  const command: Command = type === 'issue' ? issue() : type === 'redeem' ? { type, credential: encodeCredential(pass) } : { type, passId: pass.id };
  const first = await applyCommand(input, command, 'organiser', `synthetic-idempotent-${type}`, NOW);
  const replay = await applyCommand(first.state, command, 'organiser', `synthetic-idempotent-${type}`, new Date('2026-10-25T00:00:00.000Z'));
  assert.deepEqual(replay.receipt, first.receipt);
  assert.deepEqual(replay.state, first.state);
  assert.notEqual(replay.state, first.state);
});

test('same request ID with changed command fields or type is a conflict', async () => {
  const input = await createDemoState();
  const first = await applyCommand(input, issue(), 'organiser', 'synthetic-request-conflict', NOW);
  for (const command of [issue(101), issue(100, 'Changed Synthetic Label'), { ...issue(), passType: 'Host' }, { type: 'revoke', passId: readyPass(first.state).id }] as Command[]) {
    await rejectedWithoutMutation(first.state, command, 'request-conflict', 'organiser', 'synthetic-request-conflict');
  }
});

test('failed requests are not cached and a corrected action may reuse their request ID', async () => {
  const state = await createDemoState();
  await rejectedWithoutMutation(state, issue(100, 'A'), 'invalid', 'organiser', 'synthetic-retry');
  const retry = await applyCommand(state, issue(), 'organiser', 'synthetic-retry', NOW);
  assert.equal(retry.state.revision, 1);
  assert.equal(Object.keys(retry.state.requests).length, 1);
});

for (const requestId of ['__proto__', 'constructor', 'toString']) test(`bounded request ID ${requestId} does not collide with inherited object properties`, async () => {
  const first = await applyCommand(await createDemoState(), issue(), 'organiser', requestId, NOW);
  assert.equal(Object.hasOwn(first.state.requests, requestId), true);
  const persisted = JSON.parse(JSON.stringify(first.state)) as DemoState;
  const replay = await applyCommand(persisted, issue(), 'organiser', requestId, NOW);
  assert.deepEqual(replay.state, persisted);
  assert.deepEqual(replay.receipt, first.receipt);
});

test('an explicit real time outside the event window cannot issue an already-expired pass', async () => {
  const state = await createDemoState();
  await rejectsCode(() => applyCommand(state, issue(900), 'organiser', 'closed-event', new Date('2026-10-25T12:00:00Z')), 'expired');
  assert.equal(state.passes.length, 18);
});
