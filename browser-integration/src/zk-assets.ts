import { FetchZkConfigProvider } from '@midnight-ntwrk/midnight-js-fetch-zk-config-provider';
import type { EventPassCircuit } from './contract.js';
import { assetManifest } from './generated/asset-manifest.js';
import { publicHex } from './bytes.js';

/** Genuine SDK browser asset provider with build-pinned integrity and no filesystem imports. */
export class BrowserZkConfigProvider extends FetchZkConfigProvider<EventPassCircuit> {
  constructor(baseUrl: string, fetchImpl: typeof fetch = globalThis.fetch, cryptoImpl: Crypto = globalThis.crypto) {
    const base = new URL(baseUrl);
    if (!base.pathname.endsWith('/') || base.search || base.hash || base.username || base.password) throw new Error('Provide a clean absolute compiled-assets URL ending in /');
    if (base.protocol !== 'https:' && !(base.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname))) throw new Error('Compiled assets require HTTPS or local loopback development');
    const appOrigin = globalThis.location?.origin;
    const approved = new Map(assetManifest.files.map(file => [new URL(file.path, base).href, file]));
    const integrityFetch: typeof fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const expected = approved.get(new URL(url, base).href);
      if (!expected) throw new Error('Unknown circuit asset; use only this compiled event-pass artifact set');
      // Existing same-origin app sign-in may protect public compiler assets.
      // Never send those cookies to an external asset origin or follow redirects.
      const credentials: RequestCredentials = appOrigin === new URL(url, base).origin ? 'same-origin' : 'omit';
      const response = await fetchImpl(url, { ...init, credentials, redirect: 'error', signal: AbortSignal.timeout(30_000) });
      if (!response.ok) throw new Error(`Compiled circuit asset unavailable (${response.status}; ${expected.path})`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      const digest = publicHex(new Uint8Array(await cryptoImpl.subtle.digest('SHA-256', bytes)));
      if (bytes.length !== expected.bytes || digest !== expected.sha256) throw new Error('Compiled circuit asset integrity mismatch; regenerate the whole artifact set');
      return new Response(bytes, { status: 200, headers: { 'Content-Type': 'application/octet-stream' } });
    };
    super(base.href.replace(/\/$/, ''), integrityFetch);
  }
}
export { assetManifest };
