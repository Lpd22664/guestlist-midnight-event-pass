/** Backend-only owner config helpers. Imports perform no I/O, provisioning or network work. */
import { constants, closeSync, existsSync, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readSync, realpathSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, parse, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { event, gateId, record } from './validation.js';
import type { GateEvent } from './types.js';
import { assertDatabaseIdentity, databaseDescriptorIdentity, storageIdentity, type StorageFileIdentity } from './owner-files.js';

export const SERVER_FILE = 'guestlist-gate-server.json';
export const CLIENT_FILE = 'guestlist-gate-client.json';
export const DATABASE_FILE = 'gate.sqlite';
/** Reviewed official public Preview endpoints only; never inferred from a wallet/prover. */
export const PREVIEW_ENDPOINTS = Object.freeze({
  nodeRpcUri: 'https://rpc.preview.midnight.network',
  indexerUri: 'https://indexer.preview.midnight.network/api/v4/graphql',
  indexerWsUri: 'wss://indexer.preview.midnight.network/api/v4/graphql/ws',
});
export interface OwnerSetupPlan {
  event: GateEvent & { network: 'preview' };
  allowedAppOrigin: string;
  port: number;
  gateId: string;
  privateDirectory: string;
}
export interface OwnerServerConfig {
  schema: 'guestlist-gate-server-v1';
  event: OwnerSetupPlan['event'];
  endpoints: typeof PREVIEW_ENDPOINTS;
  allowedAppOrigin: string;
  port: number;
  gateId: string;
  apiSecret: string;
  dbPath: string;
  databaseIdentity: StorageFileIdentity;
}
export interface OwnerClientConfig {
  schema: 'guestlist-gate-client-v1';
  serviceUrl: string;
  gateId: string;
  apiSecret: string;
}
const fail = (): never => { throw new Error('Invalid owner gate configuration'); };
export function previewManifest(input: unknown): OwnerSetupPlan['event'] {
  const checked = event(input);
  if (checked.network !== 'preview') return fail();
  return { ...checked, network: 'preview' };
}
export function exactAppOrigin(input: unknown): string {
  if (typeof input !== 'string' || /[\u0000-\u0020\u007f]/.test(input)) return fail();
  const url = new URL(input);
  if (url.origin !== input || url.username || url.password || url.search || url.hash ||
      !['http:', 'https:'].includes(url.protocol) ||
      url.protocol !== 'https:' && !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) return fail();
  return input;
}
export function loopbackPort(input: unknown): number {
  if (typeof input !== 'number' || !Number.isSafeInteger(input) || input < 1024 || input > 65535) return fail();
  return input;
}
export function privatePath(input: unknown): string {
  if (typeof input !== 'string' || !isAbsolute(input) || input !== resolve(input) || /[\u0000-\u001f\u007f]/.test(input)) return fail();
  return input;
}
export function apiAuthority(input: unknown): string {
  if (typeof input !== 'string' || input.length < 32 || input.length > 512 || !/^[\x21-\x7e]+$/.test(input)) return fail();
  return input;
}
export function setupPlan(input: unknown): OwnerSetupPlan {
  const value = record(input, ['event', 'allowedAppOrigin', 'port', 'gateId', 'privateDirectory']);
  return { event: previewManifest(value.event), allowedAppOrigin: exactAppOrigin(value.allowedAppOrigin),
    port: loopbackPort(value.port), gateId: gateId(value.gateId), privateDirectory: privatePath(value.privateDirectory) };
}
/** Review binds every public setup field to the personally typed final confirmation. */
export function confirmationPhrase(plan: OwnerSetupPlan): string {
  const checked = setupPlan(plan);
  const digest = createHash('sha256').update(JSON.stringify({ ...checked, endpoints: PREVIEW_ENDPOINTS })).digest('hex').slice(0, 16);
  return `CREATE PERSISTENT GATE AUTHORITY ${checked.gateId} ${digest}`;
}
export function confirmed(plan: OwnerSetupPlan, answer: string): boolean { return answer === confirmationPhrase(plan); }
export function privateConfigPair(plan: OwnerSetupPlan, suppliedAuthority: string, databaseIdentity: StorageFileIdentity): { server: OwnerServerConfig; client: OwnerClientConfig } {
  const checked = setupPlan(plan), secret = apiAuthority(suppliedAuthority);
  return { server: { schema: 'guestlist-gate-server-v1', event: checked.event, endpoints: { ...PREVIEW_ENDPOINTS },
    allowedAppOrigin: checked.allowedAppOrigin, port: checked.port, gateId: checked.gateId, apiSecret: secret,
    dbPath: join(checked.privateDirectory, DATABASE_FILE), databaseIdentity: storageIdentity(databaseIdentity) },
    client: { schema: 'guestlist-gate-client-v1', serviceUrl: `http://127.0.0.1:${checked.port}`, gateId: checked.gateId, apiSecret: secret } };
}
export function validateServerConfig(input: unknown, directory: string): OwnerServerConfig {
  const value = record(input, ['schema', 'event', 'endpoints', 'allowedAppOrigin', 'port', 'gateId', 'apiSecret', 'dbPath', 'databaseIdentity']);
  if (value.schema !== 'guestlist-gate-server-v1') return fail();
  const endpoints = record(value.endpoints, ['nodeRpcUri', 'indexerUri', 'indexerWsUri']);
  if (Object.entries(PREVIEW_ENDPOINTS).some(([key, endpoint]) => endpoints[key] !== endpoint)) return fail();
  const checked = setupPlan({ event: value.event, allowedAppOrigin: value.allowedAppOrigin, port: value.port, gateId: value.gateId, privateDirectory: directory });
  if (value.dbPath !== join(checked.privateDirectory, DATABASE_FILE)) return fail();
  return privateConfigPair(checked, apiAuthority(value.apiSecret), storageIdentity(value.databaseIdentity)).server;
}
export function configEnvironment(config: OwnerServerConfig): Record<string, string> {
  // Revalidate, including exact Preview endpoints, before overriding all legacy env inputs.
  const value = validateServerConfig(config, dirname(privatePath(config.dbPath)));
  return { GUESTLIST_GATE_KEYS_JSON: JSON.stringify({ [value.gateId]: value.apiSecret }),
    GUESTLIST_GATE_DB_PATH: value.dbPath, GUESTLIST_GATE_PORT: String(value.port),
    GUESTLIST_GATE_APP_ORIGINS_JSON: JSON.stringify([value.allowedAppOrigin]),
    GUESTLIST_GATE_EVENTS_JSON: JSON.stringify([{ ...value.event, ...value.endpoints }]) };
}
function ownerUid(): number {
  if (!process.getuid || process.getuid() === 0) throw new Error('Run as the local non-root owner');
  return process.getuid();
}
/** Require immutable-by-other-users ancestry. Root-owned sticky /tmp is allowed for fixtures;
 * the owner must still select a durable local location for actual operation. */
function safeAncestors(path: string): void {
  const uid = ownerUid(), absolute = privatePath(path), root = parse(absolute).root;
  let current = root;
  for (const component of [root, ...absolute.slice(root.length).split(sep).filter(Boolean)]) {
    current = component === root ? root : join(current, component);
    const stat = lstatSync(current);
    if (!stat.isDirectory() || stat.isSymbolicLink() || ![0, uid].includes(stat.uid) ||
        (stat.mode & 0o022) !== 0 && !(stat.uid === 0 && (stat.mode & 0o1000) !== 0)) throw new Error('Private path ancestry must be owner/root-controlled and non-shared');
  }
}
/** Reject symlinks at every component, including parent directory aliases. */
function noSymlinks(path: string, allowMissingLeaf = false): void {
  const absolute = privatePath(path), root = parse(absolute).root;
  let current = root;
  const components = absolute.slice(root.length).split(sep).filter(Boolean);
  for (const [index, component] of components.entries()) {
    current = join(current, component);
    if (allowMissingLeaf && index === components.length - 1 && !existsSync(current)) {
      try { lstatSync(current); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
    }
    if (lstatSync(current).isSymbolicLink()) throw new Error('Private paths cannot contain symlinks');
  }
}
export function assertOutsideSource(directory: string, sourceDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '../..')): void {
  const path = privatePath(directory), source = realpathSync(sourceDirectory);
  const within = relative(source, path);
  if (within === '' || within !== '..' && !within.startsWith(`..${sep}`) && !isAbsolute(within)) throw new Error('Private storage must be outside the repository and static app');
}
export function assertNewPrivateDirectory(directory: string): void {
  const path = privatePath(directory);
  assertOutsideSource(path); safeAncestors(dirname(path)); noSymlinks(path, true);
  const parent = lstatSync(dirname(path));
  if (!parent.isDirectory() || parent.uid !== ownerUid() || (parent.mode & 0o022) !== 0) throw new Error('Choose an existing owner-controlled, non-shared parent directory');
  try { lstatSync(path); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
  throw new Error('Choose a new private directory; existing data is never replaced');
}
function assertPrivateDirectory(directory: string): void {
  assertOutsideSource(directory); safeAncestors(directory); noSymlinks(directory);
  const stat = lstatSync(directory);
  if (!stat.isDirectory() || stat.uid !== ownerUid() || (stat.mode & 0o777) !== 0o700) throw new Error('Private owner directory must have mode 0700');
  const parent = lstatSync(dirname(directory));
  if (!parent.isDirectory() || parent.uid !== ownerUid() || (parent.mode & 0o022) !== 0) throw new Error('Private parent directory is not owner-controlled');
}
function writeExclusive(path: string, content: string): void {
  const fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { writeFileSync(fd, content, 'utf8'); fsyncSync(fd); } finally { closeSync(fd); }
}
/** Only stores supplied authority; never generates authority. Tests use fixed synthetic fixtures. */
export function writePrivateConfigPair(plan: OwnerSetupPlan, suppliedAuthority: string): void {
  const checked = setupPlan(plan);
  apiAuthority(suppliedAuthority);
  assertNewPrivateDirectory(checked.privateDirectory);
  mkdirSync(checked.privateDirectory, { mode: 0o700 });
  assertPrivateDirectory(checked.privateDirectory);
  // Reserve the ONE authoritative file first and bind its instance identity to the private config.
  const database = join(checked.privateDirectory, DATABASE_FILE);
  writeExclusive(database, '');
  const databaseFd = openPrivateFile(database);
  let pair: ReturnType<typeof privateConfigPair>;
  try { pair = privateConfigPair(checked, suppliedAuthority, databaseDescriptorIdentity(databaseFd)); }
  finally { closeSync(databaseFd); }
  writeExclusive(join(checked.privateDirectory, SERVER_FILE), `${JSON.stringify(pair.server, null, 2)}\n`);
  writeExclusive(join(checked.privateDirectory, CLIENT_FILE), `${JSON.stringify(pair.client, null, 2)}\n`);
  const fd = openSync(checked.privateDirectory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try { fsyncSync(fd); } finally { closeSync(fd); }
}
function boundedJson(fd: number, maxBytes: number): unknown {
  const stat = fstatSync(fd);
  if (!stat.isFile() || stat.size < 1 || stat.size > maxBytes) return fail();
  const bytes = Buffer.alloc(maxBytes + 1);
  let used = 0;
  while (used < bytes.length) {
    const count = readSync(fd, bytes, used, bytes.length - used, null);
    if (count === 0) break;
    used += count;
  }
  if (used < 1 || used > maxBytes) return fail();
  return JSON.parse(bytes.subarray(0, used).toString('utf8'));
}
export function readPublicManifest(path: string): OwnerSetupPlan['event'] {
  const fd = openSync(privatePath(path), constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    return previewManifest(boundedJson(fd, 4096));
  } finally { closeSync(fd); }
}
function openPrivateFile(path: string): number {
  noSymlinks(path);
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.uid !== ownerUid() || (stat.mode & 0o777) !== 0o600 || stat.nlink !== 1) throw new Error('Private owner files must have mode 0600 and no links');
    return fd;
  } catch (error) { closeSync(fd); throw error; }
}
export function openOwnerServerConfig(path: string): { config: OwnerServerConfig; databaseFd: number } {
  const absolute = privatePath(path), directory = dirname(absolute);
  if (basename(absolute) !== SERVER_FILE) return fail();
  assertPrivateDirectory(directory);
  const fd = openPrivateFile(absolute);
  let config: OwnerServerConfig;
  try {
    config = validateServerConfig(boundedJson(fd, 16_384), directory);
  } finally { closeSync(fd); }
  const databaseFd = openPrivateFile(config.dbPath);
  try {
    assertDatabaseIdentity(config.dbPath, config.databaseIdentity);
    const held = databaseDescriptorIdentity(databaseFd);
    if (JSON.stringify(held) !== JSON.stringify(config.databaseIdentity)) throw new Error('Database instance changed');
    // Keep the validated instance open across module loading and SQLite initialization.
    return { config, databaseFd };
  } catch (error) { closeSync(databaseFd); throw error; }
}
export function readOwnerServerConfig(path: string): OwnerServerConfig {
  const opened = openOwnerServerConfig(path);
  try { return opened.config; } finally { closeSync(opened.databaseFd); }
}

