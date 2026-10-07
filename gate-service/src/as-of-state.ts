import { readFile } from 'node:fs/promises';
import { BrowserZkConfigProvider } from '../../browser-integration/dist/zk-assets.js';
import { createPinnedStateVerifier, deserializePublicContractState, type PublicContractState } from '../../browser-integration/dist/state-integrity.js';
import { GateError } from './types.js';
import { blockHash, publicHex } from './validation.js';
import type { FinalizedBaseline } from './chain.js';

export interface AsOfStateReader {
  readContractState(address: string, baseline: FinalizedBaseline): Promise<PublicContractState | null>;
}
// Contract.actions is deliberately omitted: its recent-action list is NOT offset-anchored.
const query = `query GuestlistFinalizedState($address: HexEncoded!, $hash: HexEncoded!) {
  anchor: block(offset: {hash: $hash}) { hash height }
  contract(address: $address, offset: {hash: $hash}) { address state }
}`;
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new GateError('verification-failed', 503);
  return value as Record<string, unknown>;
}
/** Fixed public-only query against an owner-configured indexer; never falls back
 * to unpinned latest state or scans a bounded window of old contract actions. */
export class ReadOnlyAsOfIndexer implements AsOfStateReader {
  #url: URL;
  constructor(uri: string, readonly timeoutMs = 15_000, readonly fetchImpl: typeof fetch = fetch) {
    this.#url = new URL(uri);
    if (!['https:', 'http:'].includes(this.#url.protocol) || this.#url.username || this.#url.password || this.#url.search || this.#url.hash ||
      this.#url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(this.#url.hostname)) throw new Error('Public TLS or loopback indexer URL required');
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000) throw new Error('Invalid bounded indexer timeout');
  }
  async readContractState(address: string, baseline: FinalizedBaseline): Promise<PublicContractState | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response | undefined;
    try {
      const hash = blockHash(baseline.hash);
      if (!Number.isSafeInteger(baseline.height) || baseline.height < 0) throw new Error('Invalid anchor height');
      response = await this.fetchImpl(this.#url.href, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ query, variables: { address: publicHex(address), hash } }), signal: controller.signal,
        credentials: 'omit', redirect: 'error', cache: 'no-store' });
      if (!response.ok || !response.headers.get('content-type')?.match(/^application\/(?:json|graphql-response\+json)(?:;|$)/i) || !response.body) throw new Error('Indexer response unavailable');
      const length = response.headers.get('content-length');
      if (length && (!/^\d+$/.test(length) || Number(length) > MAX_RESPONSE_BYTES)) throw new Error('Indexer response too large');
      const reader = response.body.getReader();
      const cancel = () => { void reader.cancel().catch(() => {}); };
      controller.signal.addEventListener('abort', cancel, { once: true });
      const chunks: Uint8Array[] = []; let size = 0;
      try {
        while (true) {
          controller.signal.throwIfAborted();
          const { done, value } = await reader.read();
          controller.signal.throwIfAborted(); if (done) break;
          size += value.byteLength;
          if (size > MAX_RESPONSE_BYTES) throw new Error('Indexer response too large');
          chunks.push(value);
        }
      } finally { controller.signal.removeEventListener('abort', cancel); await reader.cancel().catch(() => {}); reader.releaseLock(); }
      const bytes = new Uint8Array(size); let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      const result = object(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
      if ('errors' in result && (!Array.isArray(result.errors) || result.errors.length !== 0)) throw new Error('Indexer GraphQL error');
      const data = object(result.data), anchor = object(data.anchor);
      // Ensures an indexer that has not reached the pinned node head cannot use an older state.
      if (blockHash(anchor.hash) !== hash || anchor.height !== baseline.height) throw new Error('Indexer anchor mismatch');
      if (data.contract === null) return null;
      const contract = object(data.contract);
      if (contract.address !== address || typeof contract.state !== 'string') throw new Error('Wrong contract state');
      return deserializePublicContractState(contract.state);
    } catch { throw new GateError('verification-failed', 503); }
    finally { clearTimeout(timer); controller.abort(); await response?.body?.cancel().catch(() => {}); }
  }
}
/** Read only the three build-pinned public verifier assets from this checkout.
 * The synthetic URL is an integrity-provider namespace, never a network request. */
export function localPinnedStateVerifier(): (state: PublicContractState) => Promise<void> {
  const base = 'https://guestlist-local-assets.invalid/';
  const assets = new BrowserZkConfigProvider(base, async input => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    if (url.origin !== new URL(base).origin || !/^\/keys\/(issue|redeem|revoke)\.verifier$/.test(url.pathname)) throw new Error('Only pinned verifier keys can be read');
    return new Response(Uint8Array.from(await readFile(new URL(`../../browser-integration/public/midnight/event-pass${url.pathname}`, import.meta.url))));
  });
  return createPinnedStateVerifier(assets);
}
