import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, normalize } from 'node:path';
import { chromium } from '@playwright/test';
import { MidnightBech32m, ShieldedCoinPublicKey, ShieldedEncryptionPublicKey } from '@midnight-ntwrk/wallet-sdk-address-format';
import { derivePassCommitment } from '../dist/index.js';

// Isolated synthetic Chromium context, no owner profile or extension. Only loopback HTTP allowed.
const root = fileURLToPath(new URL('../bundle/', import.meta.url));
const cpk = ShieldedCoinPublicKey.codec.encode('preview', ShieldedCoinPublicKey.fromHexString('01'.repeat(32))).asString();
const epk = ShieldedEncryptionPublicKey.codec.encode('preview', ShieldedEncryptionPublicKey.fromHexString('02'.repeat(32))).asString();
const expectedCommitment = Array.from(derivePassCommitment(new Uint8Array(32).fill(1), new Uint8Array(32).fill(3)), b => b.toString(16).padStart(2, '0')).join('');
const server = createServer(async (request, response) => {
  try {
    const path = new URL(request.url, 'http://127.0.0.1').pathname;
    if (path === '/') { response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><html><head><title>Synthetic browser runtime test</title></head><body><p>Offline browser fixture</p></body></html>'); return; }
    if (path.includes('..')) throw new Error('Invalid path');
    const target = normalize(join(root, path));
    if (!target.startsWith(root)) throw new Error('Invalid path');
    const data = await readFile(target);
    response.setHeader('Content-Type', path.endsWith('.js') ? 'text/javascript' : path.endsWith('.json') ? 'application/json' : path.endsWith('.wasm') ? 'application/wasm' : 'application/octet-stream'); response.end(data);
  } catch { response.statusCode = 404; response.end('Missing synthetic fixture'); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port, origin = `http://127.0.0.1:${port}`;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE ?? '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
const context = await browser.newContext();
const errors = [], externalRequests = [];
await context.route('**/*', route => { const url = route.request().url(); if (!url.startsWith(origin + '/')) { externalRequests.push(url); return route.abort(); } return route.continue(); });
const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
try {
  await page.goto(origin);
  const report = await page.evaluate(async ({ origin, cpk, epk, expectedCommitment }) => {
    const sdk = await import(`${origin}/event-pass.js`);
    const checks = [];
    const check = (condition, label) => { if (!condition) throw new Error(`Browser check failed: ${label}`); checks.push(label); };
    const derive = sdk.derivePassCommitment(new Uint8Array(32).fill(1), new Uint8Array(32).fill(3));
    check(Array.from(derive, b => b.toString(16).padStart(2, '0')).join('') === expectedCommitment, 'real Compact commitment matches Node output');
    check(typeof globalThis.Buffer === 'undefined', 'no global Buffer mutation');
    const discovered = sdk.discoverWallets(undefined); check(discovered.length === 0, 'wallet import never connects automatically');
    // Synthetic methods return fixture keys; no real wallet, signing, proving or network submission.
    let changed = false, externalCalls = 0;
    const config = { networkId: 'preview', indexerUri: `${origin}/graphql`, indexerWsUri: `ws://127.0.0.1:${new URL(origin).port}/graphql`, substrateNodeUri: `${origin}/rpc` };
    const wallet = {
      getConnectionStatus: async () => ({ status: 'connected', networkId: 'preview' }), getConfiguration: async () => config,
      getShieldedAddresses: async () => ({ shieldedCoinPublicKey: changed ? epk : cpk, shieldedEncryptionPublicKey: epk }),
      balanceUnsealedTransaction: async () => { externalCalls++; throw new Error('Forbidden synthetic balance'); },
      submitTransaction: async () => { externalCalls++; throw new Error('Forbidden synthetic submit'); },
    };
    sdk.selectNetwork('preview');
    const bridge = await sdk.connectorWalletProviders(wallet, 'preview');
    check(bridge.walletProvider.getCoinPublicKey() === '01'.repeat(32), 'API4 Bech32m public-key bridge works without Node globals');
    changed = true;
    try { await bridge.walletProvider.balanceTx({}); throw new Error('Identity drift was accepted'); } catch (error) { check(error.message.includes('account changed'), 'account drift blocks balancing'); }
    check(externalCalls === 0, 'account drift blocks external wallet actions');
    const zk = new sdk.BrowserZkConfigProvider(`${origin}/midnight/event-pass/`);
    const artifacts = await zk.get('issue'); check(artifacts.proverKey.length > 2_000_000 && artifacts.zkir.length > 300, 'real browser fetches and authenticates compiler assets');
    const key = await crypto.subtle.importKey('raw', new Uint8Array(32).fill(7), 'AES-GCM', false, ['encrypt', 'decrypt']);
    const scope = { network: 'preview', ownerAccountId: 'synthetic-browser-owner', eventId: '01'.repeat(32), role: 'issuer' };
    let approvals = 0;
    const options = { scope, encryptionKey: key, authorize: async () => { approvals++; return true; } };
    const a = await sdk.openOwnerStorage(options), b = await sdk.openOwnerStorage(options);
    a.privateStateProvider.setContractAddress('a'.repeat(64)); await a.privateStateProvider.set('fixture', { issuerSecret: new Uint8Array(32).fill(2) });
    const roundTrip = await a.privateStateProvider.get('fixture'); check(roundTrip.issuerSecret instanceof Uint8Array && roundTrip.issuerSecret[0] === 2, 'native IndexedDB encrypted capability round-trip');
    const attempt = { network: 'preview', eventId: scope.eventId, issuerCommitment: '04'.repeat(32), action: 'deploy', state: 'started', expiresAt: Date.now() + 60_000 };
    const result = await Promise.allSettled([a.journal.create({ ...attempt, requestId: 'a' }), b.journal.create({ ...attempt, requestId: 'b' })]);
    check(result.filter(r => r.status === 'fulfilled').length === 1, 'native IndexedDB cross-connection atomic event lock');
    a.close(); b.close();
    const reopened = await sdk.openOwnerStorage(options); reopened.privateStateProvider.setContractAddress('a'.repeat(64));
    check((await reopened.privateStateProvider.get('fixture')).issuerSecret[0] === 2, 'owner ciphertext survives reload with same key'); reopened.close();
    check(approvals === 3, 'each storage opening requests explicit approval');
    const constructorStore = await sdk.openOwnerStorage(options);
    const priorId = result[0].status === 'fulfilled' ? 'a' : 'b';
    const prior = await constructorStore.journal.get(priorId); await constructorStore.journal.update({ ...prior, state: 'failed-before-submit' });
    let proverEntries = 0, balanceCalls = 0, submitCalls = 0;
    const adapter = new sdk.EventPassAdapter({
      network: 'preview', ownerRole: 'issuer', compiledAssetsBaseUrl: `${origin}/midnight/event-pass/`, proofDestination: 'synthetic-offline-test-prover',
      privateStateId: 'synthetic-browser-owner:event1:issuer', journal: constructorStore.journal, authorize: async () => true, timeoutMs: 10_000,
      providers: { privateStateProvider: constructorStore.privateStateProvider, publicDataProvider: {}, zkConfigProvider: zk,
        proofProvider: { proveTx: async () => { proverEntries++; throw new Error('Synthetic stop before proof'); } },
        walletProvider: { getCoinPublicKey: () => '01'.repeat(32), getEncryptionPublicKey: () => '02'.repeat(32), balanceTx: async () => { balanceCalls++; throw new Error('Forbidden balance'); } },
        midnightProvider: { submitTx: async () => { submitCalls++; throw new Error('Forbidden submit'); } },
        guardedEffects: { proveTx: async () => { proverEntries++; throw new Error('Synthetic stop before proof'); }, balanceTx: async () => { balanceCalls++; throw new Error('Forbidden balance'); }, submitTx: async () => { submitCalls++; throw new Error('Forbidden submit'); } },
      },
    });
    try { await adapter.deploy({ requestId: 'synthetic-constructor-check', eventId: new Uint8Array(32).fill(1), issuerSecret: new Uint8Array(32).fill(2), signingKey: '11'.repeat(32) }); throw new Error('Synthetic deploy unexpectedly completed'); }
    catch (error) { check(error.message.includes('failed before submission'), 'real SDK deploy construction safely stops at mocked proof boundary'); }
    check(proverEntries === 1 && balanceCalls === 0 && submitCalls === 0, 'single browser WASM runtime permits actual SDK construction with zero external wallet actions');
    constructorStore.close();
    return { schema: 'midnight-browser-offline-verification-v1', checks, networkTransactions: 0, walletConnections: 0, proofsGenerated: 0, ownerProfilesAccessed: 0 };
  }, { origin, cpk, epk, expectedCommitment });
  if (errors.length || externalRequests.length) throw new Error(JSON.stringify({ errors, externalRequests }));
  await writeFile(new URL('../evidence/browser-report.json', import.meta.url), JSON.stringify({ ...report, errors, externalRequests, checkedAt: new Date().toISOString() }, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} finally { await context.close(); await browser.close(); await new Promise(resolve => server.close(resolve)); }
