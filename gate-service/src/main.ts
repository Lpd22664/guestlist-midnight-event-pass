/** Manual loopback bootstrap only. Importing library/client modules never starts a listener. */
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { checkOwnerRuntime } from './owner-runtime.js';
import type { StorageFileIdentity } from './owner-files.js';
import { GateService, GateStore, GateAuth } from './service.js';
import { createMidnightChainReader, type PublicChainConfiguration } from './chain.js';
import { createGateHandler } from './http.js';
import { event, record } from './validation.js';
const required = (name: string): string => { const value = process.env[name]; if (!value) throw new Error(`Missing explicit ${name}`); return value; };
export function startGateFromEnvironment(databaseIdentity?: StorageFileIdentity): void {
  try {
    checkOwnerRuntime();
    const keys: unknown = JSON.parse(required('GUESTLIST_GATE_KEYS_JSON'));
    if (!keys || typeof keys !== 'object' || Array.isArray(keys)) throw new Error('Invalid existing gate authority');
    const entries: unknown = JSON.parse(required('GUESTLIST_GATE_EVENTS_JSON'));
    if (!Array.isArray(entries) || !entries.length || entries.length > 128) throw new Error('Explicit trusted event registry required');
    const configurations = entries.map((entry): PublicChainConfiguration => {
      const value = record(entry, ['network', 'contractAddress', 'eventId', 'issuerCommitment', 'nodeRpcUri', 'indexerUri', 'indexerWsUri']);
      const trusted = event({ network: value.network, contractAddress: value.contractAddress, eventId: value.eventId, issuerCommitment: value.issuerCommitment });
      if (typeof value.nodeRpcUri !== 'string' || typeof value.indexerUri !== 'string' || typeof value.indexerWsUri !== 'string') throw new Error('Invalid public chain endpoints');
      return { ...trusted, nodeRpcUri: value.nodeRpcUri, indexerUri: value.indexerUri, indexerWsUri: value.indexerWsUri };
    });
    if (new Set(configurations.map(value => value.network)).size !== 1) throw new Error('One pinned network per gate process required');
    const port = Number(required('GUESTLIST_GATE_PORT'));
    if (!Number.isSafeInteger(port) || port < 1024 || port > 65535) throw new Error('Explicit unprivileged loopback port required');
    const allowedOrigins: unknown = JSON.parse(required('GUESTLIST_GATE_APP_ORIGINS_JSON'));
    if (!Array.isArray(allowedOrigins) || !allowedOrigins.every(value => typeof value === 'string')) throw new Error('Exact app origins required');
    const auth = new GateAuth(keys as Record<string, string>);
    const store = new GateStore(required('GUESTLIST_GATE_DB_PATH'), databaseIdentity ? { expectedIdentity: databaseIdentity } : {});
    const service = new GateService({ auth, store, events: configurations.map(configuration => ({ event: event({ network: configuration.network, contractAddress: configuration.contractAddress, eventId: configuration.eventId, issuerCommitment: configuration.issuerCommitment }), reader: createMidnightChainReader(configuration) })) });
    const server = createServer(createGateHandler(service, { allowedOrigins }));
    server.requestTimeout = 10_000; server.headersTimeout = 10_000; server.keepAliveTimeout = 5_000;
    server.maxConnections = 128;
    server.on('error', () => { service.stop(); store.close(); process.exitCode = 1; console.error('Gate listener unavailable; admissions remain closed'); });
    const stop = () => { service.stop(); server.close(() => { store.close(); process.exitCode = 0; }); };
    process.once('SIGINT', stop); process.once('SIGTERM', stop);
    // An external reviewed TLS/reverse-proxy/network arrangement is an owner deployment step.
    server.listen(port, '127.0.0.1', () => console.info('Guestlist gate service listening on owner-selected loopback port'));
  } catch { console.error('Gate setup failed; check explicit owner-approved configuration without logging credentials'); process.exitCode = 1; }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) startGateFromEnvironment();
