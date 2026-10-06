// Explicit synthetic fixture process, never a listener or live chain connection.
import { GateStore, GateService, GateAuth } from '../dist/service.js';
import { EVENT, RECEIPT, REQUEST, KEY_A, AUTH_A, TX, HEAD } from './fixtures.mjs';
const store = new GateStore(process.argv[2]);
const service = new GateService({ store, auth: new GateAuth({ north: KEY_A }), events: [{ event: EVENT, reader: {
  readActiveBaseline: async () => ({ hash: HEAD, height: 10 }),
  verifyRedemption: async () => structuredClone(RECEIPT),
} }] });
try { process.stdout.write(JSON.stringify(await service.claimRedemption('north', AUTH_A, { requestId: REQUEST.requestId, txId: TX }))); }
finally { service.stop(); store.close(); }
