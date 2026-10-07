import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MAX_HANDOFF_BYTES, parsePublicEventManifest, encodePublicEventManifest, buildEventLink, parseEventLink, encodePassRequest, parsePassRequest, encodeCheckInRequest, parseCheckInRequest, encodeGateRequest, parseGateRequest, parsePreservedGateRequest, encodeRedemptionReceipt, parseRedemptionReceipt, type PublicGateRequestContext, type PublicEventManifest } from '../src/live/handoffs';
import type { PublicReceipt } from '../src/live/model';

// Fixed public-only fixtures. No capability, wallet, authority or network access.
const event: PublicEventManifest = { network: 'preview', contractAddress: '11'.repeat(32), eventId: '22'.repeat(32), issuerCommitment: '33'.repeat(32) };
const commitment = '44'.repeat(32), now = 1_800_000_000_000;
const context: PublicGateRequestContext = { ...event, commitment, requestId: 'synthetic-gate-request-0001', expiresAt: now + 60_000, baselineBlockHash: '55'.repeat(32), baselineBlockHeight: 10 };
const receipt: PublicReceipt = { schema: 'midnight-event-pass-receipt-v1', network: 'preview', action: 'redeem', contractAddress: event.contractAddress, eventId: event.eventId, commitment, txId: '66'.repeat(33), identifiers: ['66'.repeat(33)], txHash: '77'.repeat(32), blockHash: '88'.repeat(32), blockHeight: 11, blockTimestamp: 1_800_000_001, transactionStatus: 'SucceedEntirely', stateCheck: 'verified-at-finalized-block', publicState: { eventId: event.eventId, issuerCommitment: event.issuerCommitment, issuedCount: '1', redeemedCount: '1', revokedCount: '0', passStatus: 'USED' } };

test('manifest and fragment link round trip only public identity and never confer trust', () => {
  assert.deepEqual(parsePublicEventManifest(encodePublicEventManifest(event)), event);
  assert.deepEqual(parsePublicEventManifest(JSON.stringify(event, null, 2)), event);
  for (const origin of ['https://guestlist.example/', 'https://guestlist.example/app/', 'http://localhost:4173/', 'http://127.0.0.1:4173/', 'http://[::1]:4173/']) {
    const link = buildEventLink(origin, event);
    assert.equal(new URL(link).search, ''); assert.ok(new URL(link).hash.startsWith('#event='));
    assert.deepEqual(parseEventLink(link), event);
    assert.equal('trust' in parseEventLink(link), false);
  }
});
test('manifest rejects non-Preview, malformed, zero, uppercase and missing identities', () => {
  for (const network of ['mainnet', 'preprod', 'undeployed', 'Preview', null]) assert.throws(() => parsePublicEventManifest({ ...event, network }));
  for (const key of ['contractAddress', 'eventId', 'issuerCommitment']) {
    for (const bad of ['', '00'.repeat(32), 'AA'.repeat(32), '11'.repeat(31), '0x' + '11'.repeat(32), null, 12, {}, ['11'.repeat(32)]]) assert.throws(() => parsePublicEventManifest({ ...event, [key]: bad }));
    const copy = { ...event } as Record<string, unknown>; delete copy[key]; assert.throws(() => parsePublicEventManifest(copy));
  }
});
test('manifest refuses all authority, endpoint, account, private and unknown fields', () => {
  for (const key of ['bearerSecret', 'bearerSecretHex', 'issuerSecret', 'vaultKeyHex', 'maintenanceSigningKey', 'apiSecret', 'gateId', 'ownerAccountId', 'proverEndpoint', 'indexerUri', 'serviceUrl', 'trust', 'deploymentReceipt', 'name', 'email', '__proto__']) {
    const input = JSON.parse(JSON.stringify(event)); Object.defineProperty(input, key, { value: 'synthetic-extra', enumerable: true });
    assert.throws(() => parsePublicEventManifest(input));
    assert.throws(() => encodePublicEventManifest(input));
  }
});
test('bounded strict flat JSON rejects duplicates, escaped duplicate keys and nesting', () => {
  const json = JSON.stringify(event);
  for (const input of [json.replace('{', '{"network":"preview",'), json.replace('{', '{"net\\u0077ork":"preview",'), json + '{}', '[' + json + ']', '{"event":' + json + '}', json.replace('"preview"', 'null'), json.replace('"preview"', 'true'), json.replace('"preview"', '[]'), json.replace('"preview"', '{}'), '{', json + ' '.repeat(MAX_HANDOFF_BYTES), json.replace('"preview"', '"' + '💥'.repeat(1500) + '"')]) assert.throws(() => parsePublicEventManifest(input));
  assert.throws(() => parsePublicEventManifest(Object.assign(Object.create({ ownerAccountId: 'synthetic' }), event)));
  let getterCalls = 0; const getter = { ...event }; Object.defineProperty(getter, 'eventId', { get() { getterCalls++; return event.eventId; }, enumerable: true });
  assert.throws(() => parsePublicEventManifest(getter)); assert.equal(getterCalls, 0);
  assert.throws(() => parsePublicEventManifest({ ...event, [Symbol('hidden')]: 'extra' }));
});
test('event links reject unsafe schemes, credentials, queries and extra fragment data', () => {
  const fragment = buildEventLink('https://guestlist.example/', event).split('#')[1];
  const credentials = ['synthetic-user', 'synthetic-password'].join(':') + '@';
  for (const base of ['http://remote.example/', 'http://127.1/', 'http://0177.0.0.1/', 'http://2130706433/', 'https:guestlist.example', 'javascript:alert(1)', 'data:text/plain,hello', '//guestlist.example/', 'https://'+credentials+'guestlist.example/', 'https://guestlist.example/?', 'https://guestlist.example/?network=preview', 'https://guestlist.example/#old', 'https://guestlist.example/\n', 'https://guestlist.example/\\other']) assert.throws(() => buildEventLink(base, event));
  for (const link of ['https://guestlist.example/?secret=anything#' + fragment, 'https://guestlist.example/?#' + fragment, 'https://guestlist.example/#' + fragment + '&extra=1', 'https://guestlist.example/#' + fragment + '#extra', 'https://guestlist.example/#event=%ZZ', 'https://guestlist.example/#wrong=' + encodeURIComponent(JSON.stringify(event)), 'https://guestlist.example/']) assert.throws(() => parseEventLink(link));
});
test('request-pass and check-in QR schemas are distinct and exact-event-bound', () => {
  const request = encodePassRequest(event, commitment), checkIn = encodeCheckInRequest(event, commitment);
  assert.equal(parsePassRequest(request, event).commitment, commitment);
  assert.equal(parseCheckInRequest(checkIn, event).commitment, commitment);
  assert.throws(() => parsePassRequest(checkIn, event)); assert.throws(() => parseCheckInRequest(request, event));
  for (const key of ['contractAddress', 'eventId', 'issuerCommitment']) {
    assert.throws(() => parsePassRequest(request, { ...event, [key]: '99'.repeat(32) }));
    assert.throws(() => parseCheckInRequest(checkIn, { ...event, [key]: '99'.repeat(32) }));
  }
  for (const value of [request, checkIn]) {
    const input = JSON.parse(value);
    for (const key of ['bearerSecret', 'ownerAccountId', 'apiSecret', 'requestId', 'txId', 'status']) {
      const bad = { ...input, [key]: 'synthetic-extra' };
      assert.throws(() => input.schema === 'guestlist-pass-request-v1' ? parsePassRequest(bad, event) : parseCheckInRequest(bad, event));
    }
  }
});
test('gate request is exact-event/commitment bound, bounded and unexpired', () => {
  const qr = encodeGateRequest(context, now), parsed = parseGateRequest(qr, event, commitment, now);
  assert.deepEqual(parsed, { schema: 'guestlist-gate-request-v1', ...context });
  assert.equal(encodeGateRequest(parsed, now), qr);
  assert.throws(() => parseGateRequest(qr, { ...event, issuerCommitment: '99'.repeat(32) }, commitment, now));
  assert.throws(() => parseGateRequest(qr, event, '99'.repeat(32), now));
  assert.throws(() => parseGateRequest(qr, event, commitment, context.expiresAt), /expired/);
  assert.throws(() => encodeGateRequest(context, context.expiresAt), /expired/);
  const badFields = { requestId: ['', 'short', '../request-1', 'x'.repeat(97)], expiresAt: [0, -1, 1.5, '1800000060000', now + 900_001, Number.MAX_SAFE_INTEGER + 1], baselineBlockHash: ['', '00'.repeat(32), '0x' + '55'.repeat(32)], baselineBlockHeight: [-1, -0, 1.5, Number.MAX_SAFE_INTEGER + 1] };
  for (const [field, values] of Object.entries(badFields)) for (const value of values) assert.throws(() => encodeGateRequest({ ...context, [field]: value } as PublicGateRequestContext, now));
  for (const key of ['bearerSecret', 'apiSecret', 'status', 'ownerAccountId', 'gateId', 'txId']) assert.throws(() => parseGateRequest({ ...parsed, [key]: 'synthetic-extra' }, event, commitment, now));
});
test('receipt handoff retains exact gate context and real tagged transaction ID after expiry', () => {
  const qr = encodeRedemptionReceipt(context, receipt);
  const parsed = parseRedemptionReceipt(qr, context);
  assert.deepEqual(parsed, { schema: 'guestlist-redemption-receipt-v1', ...context, txId: receipt.txId });
  assert.equal('admit' in parsed, false); assert.equal('trust' in parsed, false);
  assert.equal(encodeRedemptionReceipt(parseGateRequest(encodeGateRequest(context, now), event, commitment, now), receipt), qr);
  for (const [key, value] of Object.entries({ network: 'preprod', contractAddress: '99'.repeat(32), eventId: '99'.repeat(32), issuerCommitment: '99'.repeat(32), commitment: '99'.repeat(32), requestId: 'another-request-0002', expiresAt: context.expiresAt + 1, baselineBlockHash: '99'.repeat(32), baselineBlockHeight: 11 })) assert.throws(() => parseRedemptionReceipt({ ...parsed, [key]: value }, context));
  for (const txId of ['', 'request-0001', '00'.repeat(33), 'AB'.repeat(33), 'ab'.repeat(34)]) assert.throws(() => parseRedemptionReceipt({ ...parsed, txId }, context));
  for (const key of ['admit', 'bearerSecret', 'apiSecret', 'ownerAccountId', 'receipt']) assert.throws(() => parseRedemptionReceipt({ ...parsed, [key]: 'synthetic-extra' }, context));
});
test('preserved expired gate context supports receipt recovery but fails new-action validation', () => {
  const wire = encodeGateRequest(context, now), restored = parsePreservedGateRequest(wire, event, commitment);
  assert.deepEqual(restored, { schema: 'guestlist-gate-request-v1', ...context });
  const receiptWire = encodeRedemptionReceipt(restored, receipt);
  assert.equal(parseRedemptionReceipt(receiptWire, restored).txId, receipt.txId);
  // Both new-action parsing and re-sharing as an active gate request still check
  // the real current clock; restoration is not an expiry bypass.
  assert.throws(() => parseGateRequest(restored, event, commitment, context.expiresAt), /expired/);
  assert.throws(() => encodeGateRequest(restored, context.expiresAt), /expired/);
  assert.throws(() => parsePreservedGateRequest(wire, { ...event, eventId: '99'.repeat(32) }, commitment));
  assert.throws(() => parsePreservedGateRequest(wire, event, '99'.repeat(32)));
  for (const key of ['bearerSecret', 'apiSecret', 'ownerAccountId', 'txId', 'status']) assert.throws(() => parsePreservedGateRequest({ ...restored, [key]: 'synthetic-extra' }, event, commitment));
  assert.throws(() => parsePreservedGateRequest({ ...restored, expiresAt: -1 }, event, commitment));
  assert.throws(() => parsePreservedGateRequest({ ...restored, baselineBlockHeight: 1.5 }, event, commitment));
});
test('receipt builder rejects unrelated, failed, pre-baseline, non-USED or malformed receipts', () => {
  for (const change of [{ action: 'issue' }, { network: 'preprod' }, { contractAddress: '99'.repeat(32) }, { eventId: '99'.repeat(32) }, { commitment: '99'.repeat(32) }, { blockHeight: 10 }, { transactionStatus: 'FailFallible' }, { stateCheck: 'unverified' }, { identifiers: [] }, { identifiers: ['99'.repeat(33)] }, { identifiers: [receipt.txId, receipt.txId] }, { apiSecret: 'synthetic-extra' }]) assert.throws(() => encodeRedemptionReceipt(context, { ...receipt, ...change } as PublicReceipt));
  for (const change of [{ passStatus: 'ACTIVE' }, { issuerCommitment: '99'.repeat(32) }, { eventId: '99'.repeat(32) }, { issuedCount: '-1' }, { bearerSecret: 'synthetic-extra' }]) assert.throws(() => encodeRedemptionReceipt(context, { ...receipt, publicState: { ...receipt.publicState, ...change } } as PublicReceipt));
});
