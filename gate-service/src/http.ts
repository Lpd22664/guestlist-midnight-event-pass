import type { IncomingMessage, ServerResponse } from 'node:http';
import type { GateService } from './service.js';
import { GateError } from './types.js';
export function createGateHandler(service: GateService, options: { allowedOrigins?: string[]; maxBodyBytes?: number } = {}) {
  const origins = new Set(options.allowedOrigins ?? []);
  for (const origin of origins) {
    const url = new URL(origin);
    if (url.origin !== origin || !['http:', 'https:'].includes(url.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && url.protocol !== 'https:') throw new Error('Exact trusted app origins required');
  }
  const limit = options.maxBodyBytes ?? 2_048;
  if (!Number.isSafeInteger(limit) || limit < 256 || limit > 8_192) throw new Error('Invalid gate request size limit');
  return async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    response.setHeader('Cache-Control', 'no-store'); response.setHeader('Content-Type', 'application/json');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    const send = (status: number, value: unknown) => { response.statusCode = status; response.end(JSON.stringify(value)); };
    try {
      if (request.url?.includes('?') || request.url?.includes('#')) throw new GateError('invalid-request', 400);
      const origin = request.headers.origin;
      if (origin) {
        if (!origins.has(origin)) throw new GateError('unauthorized', 403);
        response.setHeader('Access-Control-Allow-Origin', origin); response.setHeader('Vary', 'Origin');
      }
      if (request.method === 'OPTIONS') {
        if (!origin || !origins.has(origin)) throw new GateError('unauthorized', 403);
        response.setHeader('Access-Control-Allow-Methods', 'GET, POST');
        response.setHeader('Access-Control-Allow-Headers', 'Authorization, X-Gate-Id, Content-Type');
        response.statusCode = 204; response.end(); return;
      }
      const id = request.headers['x-gate-id'], authorization = request.headers.authorization;
      // Authenticate BEFORE reading/parsing a caller body or touching a chain provider.
      service.health(id, authorization);
      if (request.method === 'GET' && request.url === '/v1/health') { send(200, service.health(id, authorization)); return; }
      if (request.method === 'GET' && /^\/v1\/redemptions\/[A-Za-z0-9_-]{8,96}$/.test(request.url ?? '')) {
        send(200, service.readRedemption(id, authorization, { requestId: request.url!.split('/')[3] })); return;
      }
      if (request.method !== 'POST' || !['/v1/redemptions/open', '/v1/redemptions/claim'].includes(request.url ?? '')) throw new GateError('invalid-request', 404);
      if (request.headers['content-type']?.split(';')[0] !== 'application/json' || request.headers['content-encoding']) throw new GateError('invalid-request', 415);
      const declared = request.headers['content-length'];
      if (declared && (!/^\d+$/.test(declared) || Number(declared) > limit)) throw new GateError('invalid-request', 413);
      let size = 0; const chunks: Buffer[] = [];
      for await (const chunk of request) {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += bytes.length;
        if (size > limit) throw new GateError('invalid-request', 413);
        chunks.push(bytes);
      }
      let input: unknown;
      try { input = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new GateError('invalid-request', 400); }
      const result = request.url === '/v1/redemptions/open' ? await service.openRedemption(id, authorization, input) : await service.claimRedemption(id, authorization, input);
      send(200, result);
    } catch (error) {
      const safe = error instanceof GateError ? error : new GateError('service-unavailable', 503);
      // Never echo request/provider errors, auth headers, raw transaction or private state.
      send(safe.status, { admit: false, code: safe.code });
    }
  };
}
