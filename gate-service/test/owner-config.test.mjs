/** Synthetic fixed fixtures only: no random authority, production owner CLI, listener or network. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, closeSync, existsSync, linkSync, mkdirSync, mkdtempSync, openSync, readFileSync, renameSync, rmSync, statSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { CLIENT_FILE, DATABASE_FILE, SERVER_FILE, PREVIEW_ENDPOINTS, apiAuthority, assertNewPrivateDirectory,
  assertOutsideSource, configEnvironment, confirmationPhrase, confirmed, exactAppOrigin, loopbackPort,
  previewManifest, privateConfigPair, readOwnerServerConfig, readPublicManifest, setupPlan, validateServerConfig,
  writePrivateConfigPair } from '../dist/owner-config.js';
import { requireOwnerTerminal } from '../dist/owner-setup.js';
import { assertRuntimeVersions } from '../dist/owner-runtime.js';
import { databaseDescriptorIdentity, storageIdentity } from '../dist/owner-files.js';
import { GateStore } from '../dist/store.js';
import { EVENT, KEY_A } from './fixtures.mjs';
const origin = 'https://synthetic-guestlist.invalid';
const SYNTHETIC_IDENTITY = { device: '1', inode: '2', birthtimeNs: '3' };
function actualIdentity(path) { const fd = openSync(path, 'r'); try { return databaseDescriptorIdentity(fd); } finally { closeSync(fd); } }
const plan = (directory) => ({ event: { ...EVENT }, allowedAppOrigin: origin, port: 43123, gateId: 'fixture-gate', privateDirectory: directory });
function fixture(t) {
  const parent = mkdtempSync(join(tmpdir(), 'synthetic-guestlist-owner-'));
  chmodSync(parent, 0o700);
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const directory = join(parent, 'private');
  return { parent, directory, plan: plan(directory), configPath: join(directory, SERVER_FILE), dbPath: join(directory, DATABASE_FILE) };
}
test('Preview manifest is exact, public-only and nonzero', () => {
  assert.deepEqual(previewManifest(EVENT), EVENT);
  for (const value of [{ ...EVENT, network: 'preprod' }, { ...EVENT, network: 'undeployed' }, { ...EVENT, apiSecret: KEY_A },
    { ...EVENT, eventId: '0'.repeat(64) }, { ...EVENT, issuerCommitment: 'AA'.repeat(32) }, { ...EVENT, contractAddress: '0x' + EVENT.contractAddress }, [], null]) {
    assert.throws(() => previewManifest(value));
  }
});
test('Only exact HTTPS or exact loopback app origins are accepted', () => {
  for (const value of [origin, 'http://127.0.0.1:4173', 'http://localhost:4173', 'http://[::1]:4173']) assert.equal(exactAppOrigin(value), value);
  const credentialFixture = new URL(origin);
  credentialFixture.username = 'synthetic-owner'; credentialFixture.password = 'not-a-password';
  for (const value of ['*', 'https://synthetic-guestlist.invalid/', 'https://synthetic-guestlist.invalid/app', credentialFixture.href,
    'http://synthetic-guestlist.invalid', 'https://synthetic-guestlist.invalid?q=a', 'https://synthetic-guestlist.invalid#x', 'https://synthetic-guestlist.invalid\n', 'null']) assert.throws(() => exactAppOrigin(value));
});
test('No port, gate identity or private-directory defaults', () => {
  for (const port of [0, 80, 1023, 65536, 43123.5, '43123', NaN]) assert.throws(() => loopbackPort(port));
  assert.equal(loopbackPort(1024), 1024); assert.equal(loopbackPort(65535), 65535);
  for (const value of [{ ...plan('/owner/private'), port: undefined }, { ...plan('/owner/private'), gateId: '' },
    { ...plan('/owner/private'), privateDirectory: './private' }, { ...plan('/owner/private'), privateDirectory: '/owner/../private' },
    { ...plan('/owner/private'), privateDirectory: '/owner/private\n' }, { ...plan('/owner/private'), unexpected: true }]) assert.throws(() => setupPlan(value));
});
test('Synthetic pair exactly matches existing app connection import and one database', () => {
  const pair = privateConfigPair(plan('/owner/private'), KEY_A, SYNTHETIC_IDENTITY);
  assert.deepEqual(pair.client, { schema: 'guestlist-gate-client-v1', serviceUrl: 'http://127.0.0.1:43123', gateId: 'fixture-gate', apiSecret: KEY_A });
  assert.deepEqual(Object.keys(pair.server).sort(), ['schema', 'event', 'endpoints', 'allowedAppOrigin', 'port', 'gateId', 'apiSecret', 'dbPath', 'databaseIdentity'].sort());
  assert.equal(pair.server.dbPath, '/owner/private/gate.sqlite');
  assert.deepEqual(pair.server.endpoints, PREVIEW_ENDPOINTS);
  assert.equal(pair.server.apiSecret, pair.client.apiSecret);
});
test('Every public setup field binds the exact final owner phrase', () => {
  const value = plan('/owner/private'), phrase = confirmationPhrase(value);
  assert.match(phrase, /^CREATE PERSISTENT GATE AUTHORITY fixture-gate [a-f0-9]{16}$/);
  assert.equal(confirmed(value, phrase), true);
  for (const answer of ['yes', 'y', '--yes', phrase.toLowerCase(), `${phrase} `, `${phrase}\n`]) assert.equal(confirmed(value, answer), false);
  for (const changed of [{ ...value, event: { ...EVENT, eventId: '55'.repeat(32) } }, { ...value, allowedAppOrigin: 'https://another.invalid' },
    { ...value, port: 43124 }, { ...value, gateId: 'another-gate' }, { ...value, privateDirectory: '/owner/other' }]) assert.equal(confirmed(changed, phrase), false);
});
test('TTY required and no unattended approval or argument bypass exists', () => {
  assert.doesNotThrow(() => requireOwnerTerminal([], true, true));
  for (const [args, input, output] of [[[], false, true], [[], true, false], [[], false, false], [['--yes'], true, true], [['--help'], true, true], [['approved'], true, true]]) {
    assert.throws(() => requireOwnerTerminal(args, input, output));
  }
});
test('Node and SQLite policies reject unsupported and prerelease runtimes', () => {
  for (const [node, sqlite] of [['24.19.0', '3.51.3'], ['24.20.1', '3.53.3'], ['24.99.0', '4.0.0']]) assert.doesNotThrow(() => assertRuntimeVersions(node, sqlite));
  for (const [node, sqlite] of [['22.22.0', '3.53.3'], ['24.18.9', '3.53.3'], ['25.0.0', '3.53.3'], ['24.19.0-rc.1', '3.53.3'],
    ['24.19.0', '3.51.2'], ['24.19.0', '3.50.9'], ['24.19.0', '2.99.0'], ['24.19.0', 'invalid']]) assert.throws(() => assertRuntimeVersions(node, sqlite));
});
test('Synthetic authority validation matches GateAuth limits', () => {
  assert.equal(apiAuthority(KEY_A), KEY_A);
  for (const value of ['', 'x'.repeat(31), 'x'.repeat(513), 'x'.repeat(40) + '\n', null]) assert.throws(() => apiAuthority(value));
});
test('Server validation refuses altered network endpoints, unknown fields and relocated DB', () => {
  const config = privateConfigPair(plan('/owner/private'), KEY_A, SYNTHETIC_IDENTITY).server;
  assert.deepEqual(validateServerConfig(config, '/owner/private'), config);
  for (const altered of [{ ...config, schema: 'guestlist-gate-client-v1' }, { ...config, wallet: 'forbidden' },
    { ...config, endpoints: { ...config.endpoints, nodeRpcUri: 'https://another.invalid' } },
    { ...config, endpoints: { ...config.endpoints, indexerWsUri: 'wss://indexer.preview.midnight.network/api/v3/graphql/ws' } },
    { ...config, endpoints: { ...config.endpoints, proverUri: 'http://127.0.0.1:6300' } },
    { ...config, dbPath: '/other/gate.sqlite' }, { ...config, dbPath: ':memory:' }]) assert.throws(() => validateServerConfig(altered, '/owner/private'));
});
test('Validated launcher mapping replaces every legacy env configuration input', () => {
  const config = privateConfigPair(plan('/owner/private'), KEY_A, SYNTHETIC_IDENTITY).server, env = configEnvironment(config);
  assert.deepEqual(Object.keys(env).sort(), ['GUESTLIST_GATE_KEYS_JSON', 'GUESTLIST_GATE_DB_PATH', 'GUESTLIST_GATE_PORT', 'GUESTLIST_GATE_APP_ORIGINS_JSON', 'GUESTLIST_GATE_EVENTS_JSON'].sort());
  assert.deepEqual(JSON.parse(env.GUESTLIST_GATE_KEYS_JSON), { 'fixture-gate': KEY_A });
  assert.equal(env.GUESTLIST_GATE_DB_PATH, '/owner/private/gate.sqlite');
  assert.deepEqual(JSON.parse(env.GUESTLIST_GATE_EVENTS_JSON), [{ ...EVENT, ...PREVIEW_ENDPOINTS }]);
  assert.deepEqual(JSON.parse(env.GUESTLIST_GATE_APP_ORIGINS_JSON), [origin]);
  assert.ok(!env.GUESTLIST_GATE_EVENTS_JSON.includes(KEY_A));
});
test('Private storage cannot be in source, public, dist or gate-service', () => {
  const repository = new URL('../..', import.meta.url).pathname.replace(/\/$/, '');
  for (const path of [repository, join(repository, 'public/private'), join(repository, 'dist/private'), join(repository, 'gate-service/private')]) assert.throws(() => assertOutsideSource(path));
  assert.doesNotThrow(() => assertOutsideSource(join(tmpdir(), 'synthetic-private')));
});
test('Fixed fixture writes are exclusive, owner-only and read back without creating SQLite state', (t) => {
  const f = fixture(t);
  writePrivateConfigPair(f.plan, KEY_A);
  assert.equal(statSync(f.directory).mode & 0o777, 0o700);
  for (const name of [SERVER_FILE, CLIENT_FILE, DATABASE_FILE]) assert.equal(statSync(join(f.directory, name)).mode & 0o777, 0o600);
  assert.equal(statSync(f.dbPath).size, 0);
  assert.deepEqual(readOwnerServerConfig(f.configPath), privateConfigPair(f.plan, KEY_A, actualIdentity(f.dbPath)).server);
  const before = readFileSync(f.configPath, 'utf8');
  assert.throws(() => writePrivateConfigPair(f.plan, 'synthetic-other-authority-never-real'));
  assert.equal(readFileSync(f.configPath, 'utf8'), before);
  assert.equal(statSync(f.dbPath).size, 0);
});
test('Existing directory is refused even when it is empty', (t) => {
  const f = fixture(t); mkdirSync(f.directory, { mode: 0o700 });
  assert.throws(() => assertNewPrivateDirectory(f.directory));
  assert.throws(() => writePrivateConfigPair(f.plan, KEY_A));
  assert.equal(existsSync(f.configPath), false);
});
test('Shared parent permissions are rejected without changing them', (t) => {
  const f = fixture(t); chmodSync(f.parent, 0o770);
  assert.throws(() => assertNewPrivateDirectory(f.directory));
  assert.equal(statSync(f.parent).mode & 0o777, 0o770);
});
test('Symlink directory and symlink parent aliases are rejected', (t) => {
  const f = fixture(t), alias = join(f.parent, 'alias'); symlinkSync(f.parent, alias, 'dir');
  assert.throws(() => assertNewPrivateDirectory(join(alias, 'private')));
  symlinkSync(join(f.parent, 'missing'), f.directory, 'dir');
  assert.throws(() => assertNewPrivateDirectory(f.directory));
});
test('Launcher rejects a permissive private directory or server config without chmod changes', (t) => {
  const f = fixture(t); writePrivateConfigPair(f.plan, KEY_A);
  chmodSync(f.directory, 0o750); assert.throws(() => readOwnerServerConfig(f.configPath));
  assert.equal(statSync(f.directory).mode & 0o777, 0o750);
  chmodSync(f.directory, 0o700); chmodSync(f.configPath, 0o640); assert.throws(() => readOwnerServerConfig(f.configPath));
  assert.equal(statSync(f.configPath).mode & 0o777, 0o640);
});
test('Launcher never recreates a missing database or accepts a shared-permission replacement', (t) => {
  const f = fixture(t); writePrivateConfigPair(f.plan, KEY_A); unlinkSync(f.dbPath);
  assert.throws(() => readOwnerServerConfig(f.configPath)); assert.equal(existsSync(f.dbPath), false);
  writeFileSync(f.dbPath, '', { mode: 0o644 }); assert.throws(() => readOwnerServerConfig(f.configPath));
});
test('Launcher refuses private config or database symlinks and hardlinks', (t) => {
  const f = fixture(t); writePrivateConfigPair(f.plan, KEY_A);
  const alias = join(f.directory, 'db-alias'); linkSync(f.dbPath, alias); assert.throws(() => readOwnerServerConfig(f.configPath)); unlinkSync(alias);
  const saved = join(f.directory, 'saved-config'); writeFileSync(saved, readFileSync(f.configPath), { mode: 0o600 });
  unlinkSync(f.configPath); symlinkSync(saved, f.configPath); assert.throws(() => readOwnerServerConfig(f.configPath));
});
test('Bounded public manifest reading rejects private/unknown fields and symlinks', (t) => {
  const f = fixture(t), path = join(f.parent, 'public-manifest.json');
  writeFileSync(path, JSON.stringify(EVENT)); assert.deepEqual(readPublicManifest(path), EVENT);
  writeFileSync(path, JSON.stringify({ ...EVENT, issuerSecret: 'synthetic-only' })); assert.throws(() => readPublicManifest(path));
  writeFileSync(path, 'x'.repeat(4097)); assert.throws(() => readPublicManifest(path));
  const alias = join(f.parent, 'alias.json'); symlinkSync(path, alias); assert.throws(() => readPublicManifest(alias));
});
test('Bounded private config rejects unknown fields without echoing fixture authority', (t) => {
  const f = fixture(t); writePrivateConfigPair(f.plan, KEY_A);
  const config = JSON.parse(readFileSync(f.configPath, 'utf8')); writeFileSync(f.configPath, JSON.stringify({ ...config, wallet: KEY_A }));
  assert.throws(() => readOwnerServerConfig(f.configPath), (error) => !String(error).includes(KEY_A));
  writeFileSync(f.configPath, 'x'.repeat(16_385)); assert.throws(() => readOwnerServerConfig(f.configPath));
});
test('SQLite creates owner-only WAL sidecars from the reserved synthetic database', (t) => {
  const f = fixture(t); writePrivateConfigPair(f.plan, KEY_A);
  const store = new GateStore(f.dbPath, { expectedIdentity: actualIdentity(f.dbPath) });
  try { for (const suffix of ['', '-wal', '-shm']) assert.equal(statSync(`${f.dbPath}${suffix}`).mode & 0o777, 0o600); }
  finally { store.close(); }
});
test('Importing setup, launch and main never provisions, prompts, listens or accesses owner config', () => {
  const script = `import crypto from 'node:crypto'; import http from 'node:http'; import readline from 'node:readline/promises'; import { syncBuiltinESMExports } from 'node:module';
    crypto.randomBytes = () => { throw new Error('forbidden random authority generation on import'); };
    http.createServer = () => { throw new Error('forbidden listener on import'); };
    readline.createInterface = () => { throw new Error('forbidden prompt on import'); };
    syncBuiltinESMExports();
    await import('./dist/owner-setup.js'); await import('./dist/owner-launch.js'); await import('./dist/main.js');`;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], { cwd: new URL('..', import.meta.url), encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr); assert.equal(result.stdout, '');
});
test('Direct setup from pipes fails closed and cannot accept --yes', (t) => {
  const f = fixture(t);
  for (const args of [[], ['--yes']]) {
    const result = spawnSync(process.execPath, ['dist/owner-setup.js', ...args], { cwd: new URL('..', import.meta.url), input: 'yes\n', encoding: 'utf8' });
    assert.equal(result.status, 1); assert.match(result.stderr, /interactive terminal/); assert.equal(result.stdout, '');
    assert.equal(existsSync(f.directory), false); assert.ok(!result.stderr.includes(KEY_A));
  }
});
test('Separate launch requires one absolute owner config path and no --yes mode', () => {
  for (const args of [[], ['--yes'], ['relative.json'], ['one', 'two']]) {
    const result = spawnSync(process.execPath, ['dist/owner-launch.js', ...args], { cwd: new URL('..', import.meta.url), encoding: 'utf8' });
    assert.equal(result.status, 1); assert.equal(result.stdout, ''); assert.match(result.stderr, /admissions remain closed/i);
  }
});

test('A non-sticky writable ancestor is rejected even when its immediate parent is private', (t) => {
  const f = fixture(t), shared = join(f.parent, 'shared'), parent = join(shared, 'owner-parent');
  mkdirSync(shared, { mode: 0o700 }); mkdirSync(parent, { mode: 0o700 }); chmodSync(shared, 0o770);
  assert.throws(() => assertNewPrivateDirectory(join(parent, 'gate-private')));
  assert.equal(existsSync(join(parent, 'gate-private')), false);
  assert.equal(statSync(shared).mode & 0o777, 0o770);
});
test('A replaced owner-private database is rejected using original instance metadata', (t) => {
  const f = fixture(t); writePrivateConfigPair(f.plan, KEY_A);
  const config = readOwnerServerConfig(f.configPath);
  renameSync(f.dbPath, join(f.directory, 'preserved-original.sqlite'));
  writeFileSync(f.dbPath, '', { mode: 0o600 });
  assert.throws(() => readOwnerServerConfig(f.configPath));
  assert.throws(() => new GateStore(f.dbPath, { expectedIdentity: config.databaseIdentity }));
  assert.equal(statSync(f.dbPath).size, 0);
});
test('A missing DB after configuration loading is refused before SQLite creation', (t) => {
  const f = fixture(t); writePrivateConfigPair(f.plan, KEY_A);
  const config = readOwnerServerConfig(f.configPath); unlinkSync(f.dbPath);
  assert.throws(() => new GateStore(f.dbPath, { expectedIdentity: config.databaseIdentity }));
  assert.equal(existsSync(f.dbPath), false);
});
test('Database instance metadata schema rejects absent, unknown, malformed and zero-inode identities', () => {
  assert.deepEqual(storageIdentity(SYNTHETIC_IDENTITY), SYNTHETIC_IDENTITY);
  for (const value of [null, {}, { ...SYNTHETIC_IDENTITY, inode: '0' }, { ...SYNTHETIC_IDENTITY, device: '-1' },
    { ...SYNTHETIC_IDENTITY, inode: 2 }, { ...SYNTHETIC_IDENTITY, birthtimeNs: '01' }, { ...SYNTHETIC_IDENTITY, extra: 'forbidden' }]) assert.throws(() => storageIdentity(value));
});
