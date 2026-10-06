import { createHash, timingSafeEqual } from 'node:crypto';
import { GateError } from './types.js';
import { gateId } from './validation.js';
/** Consumes existing owner-provisioned gate API keys. No defaults, persistence, generation or logging. */
export class GateAuth {
  #digests = new Map<string, Buffer>();
  constructor(keys: Readonly<Record<string, string>>) {
    if (!keys || Object.keys(keys).length === 0 || Object.keys(keys).length > 128) throw new Error('Explicit existing gate API keys required');
    for (const [id, key] of Object.entries(keys)) {
      gateId(id);
      if (typeof key !== 'string' || key.length < 32 || key.length > 512 || !/^[\x21-\x7e]+$/.test(key)) throw new Error('Invalid existing gate API key');
      this.#digests.set(id, createHash('sha256').update(key).digest());
    }
  }
  authenticate(id: unknown, authorization: unknown): string {
    const normalized = gateId(id);
    if (typeof authorization !== 'string' || !authorization.startsWith('Bearer ') || authorization.length > 519) throw new GateError('unauthorized', 401);
    const expected = this.#digests.get(normalized);
    const supplied = createHash('sha256').update(authorization.slice(7)).digest();
    if (!expected || !timingSafeEqual(expected, supplied)) throw new GateError('unauthorized', 401);
    return normalized;
  }
}
